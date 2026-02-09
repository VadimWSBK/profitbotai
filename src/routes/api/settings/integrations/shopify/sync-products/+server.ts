import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { getShopifyConfig, listProductsWithImages } from '$lib/shopify.server';

/** Strip HTML tags to plain text */
function stripHtml(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Extract litre size from a variant option value (e.g. "5L", "10 L", "15L"). Returns null if not a bucket size. */
function extractLitresFromOption(value: string | null | undefined): number | null {
	if (value == null || typeof value !== 'string') return null;
	const m = value.trim().match(/^(\d+)\s*L$/i);
	if (!m) return null;
	return parseInt(m[1], 10);
}

/** Check if a Shopify option name looks like a "Color" / "Colour" option */
function isColorOption(name: string): boolean {
	return /^colou?r$/i.test(name.trim());
}

/**
 * POST /api/settings/integrations/shopify/sync-products
 * Fetches ALL products from Shopify and syncs into product_pricing.
 * Products with size variants (5L, 10L, 15L etc.) are grouped under one product with each variant as a separate row.
 * Products without size variants are synced as a single row.
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

	const { products, error: fetchError } = await listProductsWithImages(config);
	if (fetchError || !products?.length) {
		return json(
			{ error: fetchError ?? 'No products returned from Shopify' },
			{ status: 400 }
		);
	}

	const rows: Array<{
		size_litres: number;
		name: string;
		price: number;
		image_url: string | null;
		shopify_product_id: number;
		shopify_variant_id: number;
		coverage_sqm: number;
		description: string | null;
		colors: string[] | null;
		sort_order: number;
	}> = [];

	for (const product of products) {
		const productTitle = product.title.trim() || 'Product';
		const description = product.bodyHtml ? stripHtml(product.bodyHtml) : null;

		// Extract colors from product options
		const colorOption = product.options.find((o) => isColorOption(o.name));
		const colors = colorOption?.values?.length ? colorOption.values : null;

		// Check if this product has size variants (bucket sizes)
		let hasSizeVariants = false;
		for (const variant of product.variants) {
			const optionValues = [variant.option1, variant.option2, variant.option3];
			for (const opt of optionValues) {
				if (extractLitresFromOption(opt) != null) {
					hasSizeVariants = true;
					break;
				}
			}
			if (hasSizeVariants) break;
		}

		if (hasSizeVariants) {
			// Group variants by size - take the first variant for each size
			const seenSizes = new Set<number>();
			for (const variant of product.variants) {
				const optionValues = [variant.option1, variant.option2, variant.option3];
				for (const opt of optionValues) {
					const sizeLitres = extractLitresFromOption(opt);
					if (sizeLitres == null || seenSizes.has(sizeLitres)) continue;
					seenSizes.add(sizeLitres);
					const price = variant.price ? Number.parseFloat(variant.price) : 0;
					const optionLabel = (typeof opt === 'string' && opt.trim()) ? opt.trim() : `${sizeLitres}L`;
					rows.push({
						size_litres: sizeLitres,
						name: `${productTitle} ${optionLabel}`.trim(),
						price: Number.isFinite(price) ? price : 0,
						image_url: product.imageSrc ?? null,
						shopify_product_id: product.id,
						shopify_variant_id: variant.id,
						coverage_sqm: 2, // default 2 sqm/L
						description,
						colors,
						sort_order: rows.length
					});
					break;
				}
			}
		} else {
			// No size variants - sync as a single product
			// Use the first variant's price and ID
			const firstVariant = product.variants[0];
			const price = firstVariant?.price ? Number.parseFloat(firstVariant.price) : 0;

			// Try to extract size from product title (e.g. "Product Name 15L")
			const titleSizeMatch = productTitle.match(/(\d+)\s*L\b/i);
			const sizeLitres = titleSizeMatch ? parseInt(titleSizeMatch[1], 10) : 1;

			rows.push({
				size_litres: sizeLitres,
				name: productTitle,
				price: Number.isFinite(price) ? price : 0,
				image_url: product.imageSrc ?? null,
				shopify_product_id: product.id,
				shopify_variant_id: firstVariant?.id ?? 0,
				coverage_sqm: 2, // default 2 sqm/L
				description,
				colors,
				sort_order: rows.length
			});
		}
	}

	// Sort by size descending, then by name
	rows.sort((a, b) => b.size_litres - a.size_litres || a.name.localeCompare(b.name));
	rows.forEach((r, i) => { r.sort_order = i; });

	if (rows.length === 0) {
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

	const insertRows = rows.map((r) => ({
		created_by: user.id,
		name: r.name,
		size_litres: r.size_litres,
		price: r.price,
		currency: 'AUD',
		coverage_sqm: r.coverage_sqm,
		image_url: r.image_url,
		shopify_product_id: r.shopify_product_id,
		shopify_variant_id: r.shopify_variant_id,
		description: r.description,
		colors: r.colors,
		sort_order: r.sort_order
	}));

	const { error: insErr } = await supabase.from('product_pricing').insert(insertRows);
	if (insErr) {
		console.error('[sync-products] insert:', insErr);
		return json({ error: insErr.message }, { status: 500 });
	}

	return json({ ok: true, synced: rows.length });
};
