import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';
import { createDiyCheckoutForOwner } from '$lib/diy-checkout.server';

/**
 * POST /api/widgets/[id]/diy-checkout
 * Create a DIY checkout (Shopify draft order) and return structured preview for the widget.
 * For n8n: call this as a tool, then return { output: "intro text", checkoutPreview: { lineItemsUI, summary, checkoutUrl } }
 * so the chat widget shows the table with product images and GO TO CHECKOUT button.
 *
 * Body: {
 *   conversationId?: string,  // optional; used to pre-fill contact email
 *   roof_size_sqm?: number,
 *   count_15l?: number, count_10l?: number, count_5l?: number,
 *   discount_percent?: number, email?: string
 * }
 * Auth: session or X-API-Key (same as other widget APIs).
 */
export const POST: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	if (!widgetId) return json({ error: 'Missing widget id' }, { status: 400 });
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: {
		conversationId?: string;
		roof_size_sqm?: number;
		count_15l?: number;
		count_10l?: number;
		count_5l?: number;
		discount_percent?: number;
		email?: string;
	};
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const roof_size_sqm =
		typeof body?.roof_size_sqm === 'number' && body.roof_size_sqm >= 1 ? body.roof_size_sqm : undefined;
	const count_15l = typeof body?.count_15l === 'number' && body.count_15l >= 0 ? body.count_15l : undefined;
	const count_10l = typeof body?.count_10l === 'number' && body.count_10l >= 0 ? body.count_10l : undefined;
	const count_5l = typeof body?.count_5l === 'number' && body.count_5l >= 0 ? body.count_5l : undefined;
	const discount_percent =
		typeof body?.discount_percent === 'number' &&
		body.discount_percent >= 1 &&
		body.discount_percent <= 20
			? body.discount_percent
			: undefined;
	const email = typeof body?.email === 'string' ? body.email.trim() || undefined : undefined;
	const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() : undefined;

	if (
		roof_size_sqm == null &&
		(count_15l ?? 0) === 0 &&
		(count_10l ?? 0) === 0 &&
		(count_5l ?? 0) === 0
	) {
		return json(
			{ error: 'Provide roof_size_sqm or at least one of count_15l, count_10l, count_5l.' },
			{ status: 400 }
		);
	}

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
		const ownerId = widget.created_by as string;

		let contactEmail = email;
		if (!contactEmail && conversationId) {
			const { data: contact } = await admin
				.from('contacts')
				.select('email')
				.eq('conversation_id', conversationId)
				.eq('widget_id', widgetId)
				.maybeSingle();
			if (contact?.email) contactEmail = contact.email as string;
		}

		const result = await createDiyCheckoutForOwner(admin, ownerId, {
			roof_size_sqm,
			count_15l,
			count_10l,
			count_5l,
			discount_percent,
			email: contactEmail
		});

		if (!result.ok) {
			return json({ error: result.error }, { status: 400 });
		}

		return json({
			checkoutUrl: result.data.checkoutUrl,
			lineItemsUI: result.data.lineItemsUI,
			summary: result.data.summary
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to create checkout';
		console.error('POST /api/widgets/[id]/diy-checkout:', e);
		return json({ error: msg }, { status: 500 });
	}
};
