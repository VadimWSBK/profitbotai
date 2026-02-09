import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';
import { getProductPricingForOwner } from '$lib/product-pricing.server';

/**
 * GET /api/widgets/[id]/product-pricing
 * Returns DIY product pricing for the widget owner.
 * One product per entry with variants array (size × color, each with variant ID and image).
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
				description: p.description,
				colors: p.colors,
				shopifyProductId: p.shopifyProductId,
				productHandle: p.productHandle,
				sortOrder: p.sortOrder,
				variants: p.variants.map((v) => ({
					shopifyVariantId: v.shopifyVariantId,
					sizeLitres: v.sizeLitres,
					color: v.color,
					price: v.price,
					currency: v.currency,
					coverageSqm: v.coverageSqm,
					imageUrl: v.imageUrl,
					totalCoverageSqm: v.coverageSqm * v.sizeLitres
				}))
			}))
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to get product pricing';
		console.error('GET /api/widgets/[id]/product-pricing:', e);
		return json({ error: msg }, { status: 500 });
	}
};
