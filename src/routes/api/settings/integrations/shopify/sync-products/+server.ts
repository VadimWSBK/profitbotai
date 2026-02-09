import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { getShopifyConfig, listProductsWithImages } from '$lib/shopify.server';
import type { ProductVariant } from '$lib/product-pricing.server';

/** Strip HTML tags to plain text */
function stripHtml(html: string): string {
	return html
		.replaceAll(/<br\s*\/?>/gi, '\n')
		.replaceAll(/<\/p>/gi, '\n')
		.replaceAll(/<[^>]+>/g, '')
		.replaceAll('&nbsp;', ' ')
		.replaceAll('&amp;', '&')
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll(/\n{3,}/g, '\n\n')
		.trim();
}

/** Extract litre size from a variant option value (e.g. "5L", "10 L", "15L"). Returns null if not a bucket size. */
function extractLitresFromOption(value: string | null | undefined): number | null {
	if (value == null || typeof value !== 'string') return null;
	const m = /^(\d+)\s*L$/i.exec(value.trim());
	if (!m) return null;
	return Number.parseInt(m[1], 10);
}

/** Check if a Shopify option name looks like a "Color" / "Colour" option */
function isColorOption(name: string): boolean {
	return /^colou?r$/i.test(name.trim());
}

/**
 * POST /api/settings/integrations/shopify/sync-products
 * Fetches ALL products from Shopify and syncs into product_pricing.
 * One row per product; all variants (size × color, each with variant ID and image URL) stored in variants jsonb.
 */
export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user || user.id === 'api-key') {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const config = await getShopifyConfig(event);
	if (!config) {
		return json({ error: 'Shopify is not connected. Connect your store first.' }, { status: 400 });
	}

	const { products: shopifyProducts, error: fetchError } = await listProductsWithImages(config);
	if (fetchError || !shopifyProducts?.length) {
		return json(
			{ error: fetchError ?? 'No products returned from Shopify' },
			{ status: 400 }
		);
	}

	const productRows: Array<{
		name: string;
		description: string | null;
		colors: string[] | null;
		shopify_product_id: number;
		sort_order: number;
		product_handle: string | null;
		variants: ProductVariant[];
	}> = [];
	let totalVariants = 0;

	for (const product of shopifyProducts) {
		const productTitle = product.title.trim() || 'Product';
		const productHandle = product.handle?.trim() ?? null;
		const description = product.bodyHtml ? stripHtml(product.bodyHtml) : null;

		const colorOptionIndex = product.options.findIndex((o) => isColorOption(o.name ?? ''));

		const colorOption = colorOptionIndex >= 0 ? product.options[colorOptionIndex] : null;
		const colors = colorOption?.values?.length ? colorOption.values : null;

		const variants: ProductVariant[] = [];
		for (const v of product.variants) {
			const optionValues = [v.option1, v.option2, v.option3];
			let sizeLitres = 0;
			for (const opt of optionValues) {
				const lit = extractLitresFromOption(opt);
				if (lit != null) {
					sizeLitres = lit;
					break;
				}
			}
			// If no size in options, try first option as size (e.g. "15L") or use 1
			if (sizeLitres === 0 && optionValues[0]) {
				const lit = extractLitresFromOption(optionValues[0]);
				if (lit != null) sizeLitres = lit;
			}
			if (sizeLitres === 0 && product.variants.length === 1) sizeLitres = 1;

			const colorValue =
				colorOptionIndex >= 0 && optionValues[colorOptionIndex]
					? String(optionValues[colorOptionIndex]).trim()
					: null;

			const price = v.price ? Number.parseFloat(v.price) : 0;
			// Resolve variant image: variant.image_id -> product.images[id], else product featured image
			let imageUrl: string | null = null;
			if (v.image_id && product.images?.length) {
				const img = product.images.find((i) => i.id === v.image_id);
				if (img?.src) imageUrl = img.src;
			}
			if (!imageUrl && product.imageSrc) imageUrl = product.imageSrc;

			variants.push({
				shopifyVariantId: v.id,
				sizeLitres,
				color: colorValue,
				price: Number.isFinite(price) ? price : 0,
				currency: 'AUD',
				coverageSqm: 2,
				imageUrl
			});
		}

		if (variants.length === 0) continue;

		totalVariants += variants.length;
		productRows.push({
			name: productTitle,
			description,
			colors,
			shopify_product_id: product.id,
			sort_order: productRows.length,
			product_handle: productHandle,
			variants
		});
	}

	if (productRows.length === 0) {
		return json(
			{ error: 'No products found in your Shopify store' },
			{ status: 400 }
		);
	}

	const supabase = getSupabaseClient(event);
	const { error: delErr } = await supabase
		.from('product_pricing')
		.delete()
		.eq('created_by', user.id);
	if (delErr) {
		console.error('[sync-products] delete:', delErr);
		return json({ error: delErr.message }, { status: 500 });
	}

	const insertRows = productRows.map((r) => ({
		created_by: user.id,
		name: r.name,
		size_litres: null,
		price: null,
		currency: null,
		coverage_sqm: null,
		image_url: null,
		shopify_variant_id: null,
		description: r.description,
		colors: r.colors,
		shopify_product_id: r.shopify_product_id,
		sort_order: r.sort_order,
		product_handle: r.product_handle,
		variants: r.variants
	}));

	const { error: insErr } = await supabase.from('product_pricing').insert(insertRows);
	if (insErr) {
		console.error('[sync-products] insert:', insErr);
		return json({ error: insErr.message }, { status: 500 });
	}

	return json({ ok: true, synced: totalVariants, products: productRows.length });
};
