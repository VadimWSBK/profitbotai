import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/contacts/tags
 * Returns distinct tag values from contacts the user can see (RLS applies).
 */
export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const supabase = getSupabaseClient(event);
	const { data: rows, error } = await supabase.rpc('get_distinct_contact_tags');
	if (error) {
		console.error('GET /api/contacts/tags:', error);
		return json({ error: error.message, tags: [] }, { status: 500 });
	}
	// RPC returns setof text: rows can be array of strings or array of { tag: string }
	const raw = rows ?? [];
	const tags = raw
		.map((r: string | { tag?: string }) => (typeof r === 'string' ? r : r?.tag))
		.filter((t: unknown): t is string => typeof t === 'string');
	return json({ tags });
};
