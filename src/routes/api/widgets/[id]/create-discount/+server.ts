import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FIXED_DISCOUNT_CODE_BY_PERCENT } from '$lib/shopify.server';

const ALLOWED_PERCENTS = [10, 15, 20] as const;

/**
 * POST /api/widgets/[id]/create-discount
 * Return the fixed discount code (NZ10, NZ15, NZ20) for the given percent. Use when the customer asks for a discount;
 * then pass the same discount_percent when calling diy-checkout so the link includes ?discount=CODE.
 *
 * Body: { discount_percent: 10 | 15 | 20 }
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
			{ error: 'discount_percent is required and must be 10, 15, or 20.' },
			{ status: 400 }
		);
	}

	const code = FIXED_DISCOUNT_CODE_BY_PERCENT[discountPercent];
	const message = `A ${discountPercent}% discount (${code}) will be applied. When you ask for your checkout link, the discount will be included automatically.`;

	return json({
		discountPercent,
		code,
		message
	});
};
