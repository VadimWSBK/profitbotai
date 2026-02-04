import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { getShopifyConfig, listProductsWithImages } from '$lib/shopify.server';

/** Extract litre size from variant option value (e.g. "5L", "10 L", "15L" -> 5, 10, 15). Returns null if not a valid DIY size. */
function extractLitresFromOption(value: string | null | undefined): number | null {
	if (value == null || typeof value !== 'string') return null;
	const m = value.trim().match(/^(\d+)\s*L$/i);
	if (!m) return null;
	const n = parseInt(m[1], 10);
	return n === 5 || n === 10 || n === 15 ? n : null;
}

const DEFAULT_COVERAGE_SQM: Record<number, number> = {
	15: 30,
	10: 20,
	5: 10
};

/**
 * POST /api/settings/integrations/shopify/sync-products
 * Fetches products from Shopify and upserts into product_pricing for the current user.
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

	const { products, error: fetchError } = await listProductsWithImages(config, 100);
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
		sort_order: number;
	}> = [];
	const seenSizes = new Set<number>();
	for (const product of products) {
		const productTitle = product.title.trim() || 'Product';
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
					coverage_sqm: DEFAULT_COVERAGE_SQM[sizeLitres] ?? 10,
					sort_order: rows.length
				});
				break;
			}
		}
	}
	// Sort by size descending (15, 10, 5) for consistent order
	rows.sort((a, b) => b.size_litres - a.size_litres);
	rows.forEach((r, i) => { r.sort_order = i; });

	if (rows.length === 0) {
		return json(
			{ error: 'No matching DIY products (15L, 10L, 5L) found in your Shopify store' },
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
		sort_order: r.sort_order
	}));

	const { error: insErr } = await supabase.from('product_pricing').insert(insertRows);
	if (insErr) {
		console.error('[sync-products] insert:', insErr);
		return json({ error: insErr.message }, { status: 500 });
	}

	return json({ ok: true, synced: rows.length });
};
