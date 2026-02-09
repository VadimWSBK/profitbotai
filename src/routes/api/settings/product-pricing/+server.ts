import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { getProductPricingForUser } from '$lib/product-pricing.server';
import type { ProductVariant } from '$lib/product-pricing.server';

/**
 * GET /api/settings/product-pricing – list current user's product pricing.
 * Returns one product per row with variants array (size × color, each with variant ID and image URL).
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const supabase = getSupabaseClient(event);
	const products = await getProductPricingForUser(supabase, event.locals.user.id);
	return json({ products });
};

type ProductInput = {
	name?: string;
	description?: string | null;
	colors?: string[] | null;
	shopifyProductId?: number | null;
	productHandle?: string | null;
	variants?: Array<{
		shopifyVariantId?: number | null;
		sizeLitres?: number;
		color?: string | null;
		price?: number;
		currency?: string;
		coverageSqm?: number;
		imageUrl?: string | null;
	}>;
};

/**
 * PUT /api/settings/product-pricing – replace all products for current user.
 * Body: { products: Array<{ name, description?, colors?, shopifyProductId?, productHandle?, variants: Array<{ shopifyVariantId, sizeLitres, color?, price, currency, coverageSqm, imageUrl? }> }> }
 * One row per product; variants stored in jsonb.
 */
export const PUT: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	let body: { products?: ProductInput[] };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const raw = Array.isArray(body?.products) ? body.products : [];
	if (raw.length === 0) return json({ error: 'At least one product is required' }, { status: 400 });

	const supabase = getSupabaseClient(event);
	const userId = event.locals.user.id;

	const { error: delErr } = await supabase
		.from('product_pricing')
		.delete()
		.eq('created_by', userId);
	if (delErr) {
		console.error('product_pricing delete:', delErr);
		return json({ error: delErr.message }, { status: 500 });
	}

	const rows = raw.map((p, i) => {
		const variants: ProductVariant[] = Array.isArray(p.variants)
			? p.variants.map((v) => {
					const sizeNum = Number(v?.sizeLitres);
					const priceNum = Number(v?.price);
					const coverageNum = Number(v?.coverageSqm);
					return {
						shopifyVariantId: v?.shopifyVariantId != null && Number.isFinite(Number(v.shopifyVariantId)) ? Number(v.shopifyVariantId) : null,
						sizeLitres: Math.max(0, Math.min(999, Number.isFinite(sizeNum) ? sizeNum : 0)),
						color: typeof v?.color === 'string' ? v.color.trim() || null : null,
						price: Math.max(0, Number.isFinite(priceNum) ? priceNum : 0),
						currency: String(v?.currency ?? 'AUD').trim() || 'AUD',
						coverageSqm: Math.max(0, Number.isFinite(coverageNum) ? coverageNum : 0),
						imageUrl: v?.imageUrl && String(v.imageUrl).trim() ? String(v.imageUrl).trim() : null
					};
				})
			: [];
		return {
			created_by: userId,
			name: String(p.name ?? '').trim() || `Product ${i + 1}`,
			size_litres: null,
			price: null,
			currency: null,
			coverage_sqm: null,
			image_url: null,
			shopify_variant_id: null,
			description: p.description && String(p.description).trim() ? String(p.description).trim() : null,
			colors: Array.isArray(p.colors) && p.colors.length > 0 ? p.colors : null,
			shopify_product_id: p.shopifyProductId != null && Number.isFinite(Number(p.shopifyProductId)) ? Number(p.shopifyProductId) : null,
			sort_order: i,
			product_handle: p.productHandle && String(p.productHandle).trim() ? String(p.productHandle).trim() : null,
			variants
		};
	});

	const { error: insErr } = await supabase.from('product_pricing').insert(rows);
	if (insErr) {
		console.error('product_pricing insert:', insErr);
		return json({ error: insErr.message }, { status: 500 });
	}
	return json({ ok: true });
};
