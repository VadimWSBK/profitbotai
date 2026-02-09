import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';
import { listDiyKitBuilders } from '$lib/diy-kit-builder.server';

/**
 * GET /api/settings/diy-kit-builders – list all DIY kit builders for the current user.
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const admin = getSupabaseAdmin();
	const list = await listDiyKitBuilders(admin, event.locals.user.id);
	return json({ kitBuilders: list });
};
