import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { getProductPricingForUser } from '$lib/product-pricing.server';

/**
 * GET /api/settings/product-pricing – list current user's product pricing.
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const supabase = getSupabaseClient(event);
	const products = await getProductPricingForUser(supabase, event.locals.user.id);
	return json({ products });
};

/**
 * PUT /api/settings/product-pricing – replace all products for current user.
 * Body: { products: Array<{ name, sizeLitres, price, currency, coverageSqm, imageUrl?, shopifyProductId?, shopifyVariantId? }> }
 */
export const PUT: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	let body: { products?: Array<{
		id?: string;
		name?: string;
		sizeLitres?: number;
		price?: number;
		currency?: string;
		coverageSqm?: number;
		imageUrl?: string | null;
		shopifyProductId?: number | null;
		shopifyVariantId?: number | null;
		sortOrder?: number;
	}> };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const raw = Array.isArray(body?.products) ? body.products : [];
	if (raw.length === 0) return json({ error: 'At least one product is required' }, { status: 400 });

	const supabase = getSupabaseClient(event);
	const userId = event.locals.user.id;

	// Delete existing and insert new (simple replace)
	const { error: delErr } = await supabase
		.from('product_pricing')
		.delete()
		.eq('created_by', userId);
	if (delErr) {
		console.error('product_pricing delete:', delErr);
		return json({ error: delErr.message }, { status: 500 });
	}

	const rows = raw.map((p, i) => ({
		created_by: userId,
		name: String(p.name ?? '').trim() || `Product ${i + 1}`,
		size_litres: Math.max(1, Math.min(999, Number(p.sizeLitres) || 1)),
		price: Math.max(0, Number(p.price) ?? 0),
		currency: String(p.currency ?? 'AUD').trim() || 'AUD',
		coverage_sqm: Math.max(0, Number(p.coverageSqm) ?? 0),
		image_url: p.imageUrl && String(p.imageUrl).trim() ? String(p.imageUrl).trim() : null,
		shopify_product_id: p.shopifyProductId != null && Number.isFinite(Number(p.shopifyProductId)) ? Number(p.shopifyProductId) : null,
		shopify_variant_id: p.shopifyVariantId != null && Number.isFinite(Number(p.shopifyVariantId)) ? Number(p.shopifyVariantId) : null,
		sort_order: i
	}));

	const { error: insErr } = await supabase.from('product_pricing').insert(rows);
	if (insErr) {
		console.error('product_pricing insert:', insErr);
		return json({ error: insErr.message }, { status: 500 });
	}
	return json({ ok: true });
};
