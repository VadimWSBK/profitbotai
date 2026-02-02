import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/workflows/[id] – get one workflow (user must own the widget).
 */
export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = event.params.id;
	if (!id) return json({ error: 'Missing workflow id' }, { status: 400 });

	const supabase = getSupabaseClient(event);
	const { data: workflow, error } = await supabase
		.from('workflows')
		.select('id, widget_id, name, nodes, edges, status, updated_at')
		.eq('id', id)
		.single();
	if (error || !workflow) return json({ error: 'Workflow not found' }, { status: 404 });
	return json({ workflow });
};

/**
 * PUT /api/workflows/[id] – update workflow.
 * Body: { name?: string, nodes?: array, edges?: array }
 */
export const PUT: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = event.params.id;
	if (!id) return json({ error: 'Missing workflow id' }, { status: 400 });

	let body: { name?: string; nodes?: unknown[]; edges?: unknown[]; status?: string };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const supabase = getSupabaseClient(event);
	const updates: Record<string, unknown> = {};
	if (typeof body?.name === 'string') updates.name = body.name.trim() || 'Untitled workflow';
	if (Array.isArray(body?.nodes)) updates.nodes = body.nodes;
	if (Array.isArray(body?.edges)) updates.edges = body.edges;
	if (body?.status === 'draft' || body?.status === 'live') updates.status = body.status;
	if (Object.keys(updates).length === 0) return json({ error: 'No updates' }, { status: 400 });

	const { data: workflow, error } = await supabase
		.from('workflows')
		.update(updates)
		.eq('id', id)
		.select('id, widget_id, name, nodes, edges, status, updated_at')
		.single();
	if (error) return json({ error: error.message }, { status: 500 });
	return json({ workflow });
};

/**
 * DELETE /api/workflows/[id] – delete workflow (user must own the widget).
 */
export const DELETE: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = event.params.id;
	if (!id) return json({ error: 'Missing workflow id' }, { status: 400 });

	const supabase = getSupabaseClient(event);
	const { error } = await supabase.from('workflows').delete().eq('id', id);
	if (error) return json({ error: error.message }, { status: 500 });
	return new Response(null, { status: 204 });
};
