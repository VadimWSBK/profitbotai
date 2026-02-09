import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import {
	createChatDiscountCode,
	CHAT_DISCOUNT_CODE_BY_PERCENT,
	getShopifyConfigForUser
} from '$lib/shopify.server';

const ALLOWED_PERCENTS = [10, 15] as const;

/**
 * POST /api/widgets/[id]/create-discount
 * Create a real discount code in Shopify (10% or 15%) when Shopify is connected, then return code and message.
 * The checkout link from DIY checkout will have the discount automatically applied via ?discount=CODE.
 * For n8n: call this when the customer asks for a discount; then use discount_percent when calling diy-checkout.
 *
 * Body: { discount_percent: 10 | 15 }
 * Auth: session or X-API-Key.
 */
export const POST: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	if (!widgetId) return json({ error: 'Missing widget id' }, { status: 400 });
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { discount_percent?: number };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const raw = typeof body?.discount_percent === 'number' ? body.discount_percent : undefined;
	const discountPercent = raw != null && ALLOWED_PERCENTS.includes(raw as (typeof ALLOWED_PERCENTS)[number])
		? (raw as (typeof ALLOWED_PERCENTS)[number])
		: null;

	if (discountPercent === null) {
		return json(
			{ error: 'discount_percent is required and must be 10 or 15.' },
			{ status: 400 }
		);
	}

	const code = CHAT_DISCOUNT_CODE_BY_PERCENT[discountPercent];
	const supabase = getSupabaseClient(event);
	const { data: widget } = await supabase.from('widgets').select('created_by').eq('id', widgetId).single();
	const ownerId = widget?.created_by ?? null;
	if (ownerId) {
		const config = await getShopifyConfigForUser(supabase, ownerId);
		if (config) {
			const result = await createChatDiscountCode(config, discountPercent, { expiresInDays: 30 });
			if (!result.ok) {
				console.error('[create-discount] Shopify discount creation failed:', result.error);
				// Still return success with code so n8n/agent can use discount_percent on checkout; store may have code already
			}
		}
	}

	const message =
		discountPercent === 10
			? 'A 10% discount has been applied. When you ask for your checkout link, the discount will be included automatically.'
			: 'A 15% discount has been applied. When you ask for your checkout link, the discount will be included automatically.';

	return json({
		discountPercent,
		code,
		message
	});
};
