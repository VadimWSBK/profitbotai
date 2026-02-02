import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/widgets/[id]/workflows – list workflows for this widget (user must own widget).
 */
export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const widgetId = event.params.id;
	if (!widgetId) return json({ error: 'Missing widget id' }, { status: 400 });

	const supabase = getSupabaseClient(event);
	const { data: workflows, error } = await supabase
		.from('workflows')
		.select('id, name, nodes, edges, updated_at')
		.eq('widget_id', widgetId)
		.order('updated_at', { ascending: false });
	if (error) return json({ error: error.message }, { status: 500 });
	return json({ workflows: workflows ?? [] });
};

/**
 * POST /api/widgets/[id]/workflows – create a workflow for this widget.
 * Body: { name: string, nodes: array, edges: array }
 */
export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const widgetId = event.params.id;
	if (!widgetId) return json({ error: 'Missing widget id' }, { status: 400 });

	let body: { name?: string; nodes?: unknown[]; edges?: unknown[] };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const name = typeof body?.name === 'string' ? body.name.trim() || 'Untitled workflow' : 'Untitled workflow';
	const nodes = Array.isArray(body?.nodes) ? body.nodes : [];
	const edges = Array.isArray(body?.edges) ? body.edges : [];

	const status = (body as { status?: string })?.status === 'live' ? 'live' : 'draft';
	const supabase = getSupabaseClient(event);
	const { data: workflow, error } = await supabase
		.from('workflows')
		.insert({ widget_id: widgetId, name, nodes, edges, status })
		.select('id, name, nodes, edges, status, updated_at')
		.single();
	if (error) return json({ error: error.message }, { status: 500 });
	return json({ workflow }, { status: 201 });
};
