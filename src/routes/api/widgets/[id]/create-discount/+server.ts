import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const ALLOWED_PERCENTS = [10, 15] as const;
const CODE_BY_PERCENT: Record<number, string> = { 10: 'CHAT10', 15: 'CHAT15' };

/**
 * POST /api/widgets/[id]/create-discount
 * Create a discount (10% or 15%) for the customer. Returns a discount code label and message.
 * The discount is applied when you call the DIY checkout with the same discount_percent.
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

	const code = CODE_BY_PERCENT[discountPercent];
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
