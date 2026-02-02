import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/workflows – list workflows for the current user's widgets (RLS filters by widget ownership).
 */
export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const supabase = getSupabaseClient(event);
	const { data: workflows, error } = await supabase
		.from('workflows')
		.select('id, widget_id, name, updated_at')
		.order('updated_at', { ascending: false });
	if (error) return json({ error: error.message }, { status: 500 });
	return json({ workflows: workflows ?? [] });
};
