import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/templates/[id] – fetch one template.
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	const supabase = getSupabaseClient(event);
	const { data, error } = await supabase
		.from('email_templates')
		.select('id, name, subject, body, created_at, updated_at')
		.eq('id', id)
		.eq('user_id', event.locals.user.id)
		.single();

	if (error) {
		if (error.code === 'PGRST116') return json({ error: 'Template not found' }, { status: 404 });
		console.error('GET /api/templates/[id]:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json(data);
};

/**
 * PUT /api/templates/[id] – update template.
 */
export const PUT: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	let body: { name?: string; subject?: string; body?: string };
	try {
		body = await event.request.json().catch(() => ({}));
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const supabase = getSupabaseClient(event);
	const updates: Record<string, string> = {};
	if (typeof body?.name === 'string') updates.name = body.name.trim() || 'Untitled template';
	if (typeof body?.subject === 'string') updates.subject = body.subject;
	if (typeof body?.body === 'string') updates.body = body.body;

	if (Object.keys(updates).length === 0) {
		return json({ error: 'No fields to update' }, { status: 400 });
	}

	const { data, error } = await supabase
		.from('email_templates')
		.update(updates)
		.eq('id', id)
		.eq('user_id', event.locals.user.id)
		.select('id, name, subject, body, created_at, updated_at')
		.single();

	if (error) {
		if (error.code === 'PGRST116') return json({ error: 'Template not found' }, { status: 404 });
		console.error('PUT /api/templates/[id]:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json({ template: data });
};

/**
 * DELETE /api/templates/[id]
 */
export const DELETE: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	const supabase = getSupabaseClient(event);
	const { error } = await supabase
		.from('email_templates')
		.delete()
		.eq('id', id)
		.eq('user_id', event.locals.user.id);
	if (error) {
		if (error.code === 'PGRST116') return json({ error: 'Template not found' }, { status: 404 });
		console.error('DELETE /api/templates/[id]:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return new Response(null, { status: 204 });
};
