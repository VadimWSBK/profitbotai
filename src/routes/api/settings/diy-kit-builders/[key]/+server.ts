import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';
import {
	getDiyKitBuilderConfig,
	saveDiyKitBuilderConfig,
	deleteDiyKitBuilderConfig,
	type DiyKitBuilderProductEntry
} from '$lib/diy-kit-builder.server';
import { ROOF_KIT_ROLES } from '$lib/roof-kit-calculator.server';

const SLUG_REGEX = /^[a-z0-9-]+$/;

/**
 * GET /api/settings/diy-kit-builders/[key] – get one kit builder.
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const key = event.params.key;
	if (!key || !SLUG_REGEX.test(key)) return json({ error: 'Invalid key' }, { status: 400 });
	const admin = getSupabaseAdmin();
	const cfg = await getDiyKitBuilderConfig(admin, event.locals.user.id, key);
	if (!cfg) return json({ error: 'Not found' }, { status: 404 });
	return json({ kitBuilder: cfg });
};

/**
 * PUT /api/settings/diy-kit-builders/[key] – create or update a kit builder.
 * Body: { name: string, product_entries: DiyKitBuilderProductEntry[] }
 */
export const PUT: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const key = event.params.key;
	if (!key || !SLUG_REGEX.test(key)) return json({ error: 'Invalid key' }, { status: 400 });
	let body: { name?: string; product_entries?: DiyKitBuilderProductEntry[]; checkout_button_color?: string | null; qty_badge_background_color?: string | null };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const product_entries = Array.isArray(body?.product_entries)
		? body.product_entries.filter((e): e is DiyKitBuilderProductEntry => {
				if (!e || typeof e !== 'object') return false;
				const h = (e as DiyKitBuilderProductEntry).product_handle;
				const r = (e as DiyKitBuilderProductEntry).role;
				return typeof h === 'string' && typeof r === 'string' && ROOF_KIT_ROLES.includes(r as (typeof ROOF_KIT_ROLES)[number]);
			})
		: [];
	const admin = getSupabaseAdmin();
	const { error } = await saveDiyKitBuilderConfig(admin, event.locals.user.id, key, {
		name: typeof body.name === 'string' ? body.name.trim() || key : key,
		product_entries,
		checkout_button_color: typeof body.checkout_button_color === 'string' ? body.checkout_button_color.trim() || null : null,
		qty_badge_background_color: typeof body.qty_badge_background_color === 'string' ? body.qty_badge_background_color.trim() || null : null
	});
	if (error) return json({ error }, { status: 400 });
	return json({ ok: true });
};

/**
 * DELETE /api/settings/diy-kit-builders/[key] – delete a kit builder.
 */
export const DELETE: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const key = event.params.key;
	if (!key || !SLUG_REGEX.test(key)) return json({ error: 'Invalid key' }, { status: 400 });
	const admin = getSupabaseAdmin();
	const { error } = await deleteDiyKitBuilderConfig(admin, event.locals.user.id, key);
	if (error) return json({ error }, { status: 400 });
	return json({ ok: true });
};
