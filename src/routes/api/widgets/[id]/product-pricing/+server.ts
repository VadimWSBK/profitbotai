import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';
import { getProductPricingForOwner } from '$lib/product-pricing.server';

/**
 * GET /api/widgets/[id]/product-pricing
 * Returns DIY product pricing (buckets, prices, coverage) for the widget owner.
 * For n8n "Get product pricing" tool so the AI can quote accurately.
 * Auth: session or X-API-Key.
 */
export const GET: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	if (!widgetId) return json({ error: 'Missing widget id' }, { status: 400 });
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const admin = getSupabaseAdmin();
		const { data: widget, error: widgetErr } = await admin
			.from('widgets')
			.select('created_by')
			.eq('id', widgetId)
			.single();
		if (widgetErr || !widget?.created_by) {
			return json({ error: 'Widget not found' }, { status: 404 });
		}
		const products = await getProductPricingForOwner(widget.created_by as string);
		return json({
			products: products.map((p) => ({
				id: p.id,
				name: p.name,
				sizeLitres: p.sizeLitres,
				price: p.price,
				currency: p.currency,
				coverageSqmPerLitre: p.coverageSqm,
				totalCoverageSqm: p.coverageSqm * p.sizeLitres,
				imageUrl: p.imageUrl,
				description: p.description,
				colors: p.colors,
				shopifyProductId: p.shopifyProductId,
				shopifyVariantId: p.shopifyVariantId,
				sortOrder: p.sortOrder
			}))
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to get product pricing';
		console.error('GET /api/widgets/[id]/product-pricing:', e);
		return json({ error: msg }, { status: 500 });
	}
};
