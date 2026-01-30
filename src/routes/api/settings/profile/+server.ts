import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/settings/profile – current user's profile (display_name, avatar_url).
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		const supabase = getSupabaseClient(event);
		const { data, error } = await supabase
			.from('profiles')
			.select('display_name, avatar_url')
			.eq('user_id', event.locals.user.id)
			.single();
		if (error || !data) return json({ displayName: '', avatarUrl: '' });
		return json({
			displayName: data.display_name ?? '',
			avatarUrl: data.avatar_url ?? ''
		});
	} catch {
		return json({ displayName: '', avatarUrl: '' });
	}
};

/**
 * PATCH /api/settings/profile – update display_name and avatar_url.
 * Body: { displayName?: string, avatarUrl?: string }
 */
export const PATCH: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		const body = (await event.request.json().catch(() => ({}))) as {
			displayName?: string;
			avatarUrl?: string;
		};
		const supabase = getSupabaseClient(event);
		const updates: Record<string, unknown> = {};
		if (typeof body.displayName === 'string') updates.display_name = body.displayName.trim();
		if (typeof body.avatarUrl === 'string') updates.avatar_url = body.avatarUrl.trim() || null;
		if (Object.keys(updates).length === 0) return json({ ok: true });
		const { error } = await supabase
			.from('profiles')
			.update(updates)
			.eq('user_id', event.locals.user.id);
		if (error) return json({ error: error.message }, { status: 500 });
		return json({ ok: true });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
	}
};
