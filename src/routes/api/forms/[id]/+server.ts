import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase, getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/forms/[id] – fetch one form. Anonymous allowed for embed.
 */
export const GET: RequestHandler = async (event) => {
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	const supabase = event.locals.user ? getSupabaseClient(event) : getSupabase();
	const { data, error } = await supabase
		.from('quote_forms')
		.select('id, name, title, steps, colors, success_title, success_message, created_at, updated_at')
		.eq('id', id)
		.single();

	if (error) {
		if (error.code === 'PGRST116') return json({ error: 'Form not found' }, { status: 404 });
		console.error('GET /api/forms/[id]:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json(data);
};

/**
 * PUT /api/forms/[id] – update form. Auth required.
 */
export const PUT: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	let body: {
		name?: string;
		title?: string;
		steps?: unknown[];
		colors?: Record<string, string>;
		success_title?: string | null;
		success_message?: string | null;
	};
	try {
		body = await event.request.json().catch(() => ({}));
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const supabase = getSupabaseClient(event);
	const updates: Record<string, unknown> = {};
	if (typeof body?.name === 'string') updates.name = body.name.trim() || 'Quote form';
	if (typeof body?.title === 'string') updates.title = body.title.trim() || 'Get Your Quote';
	if (Array.isArray(body?.steps)) updates.steps = body.steps;
	if (body?.colors && typeof body.colors === 'object' && body.colors !== null) updates.colors = body.colors;
	if (body?.success_title !== undefined) updates.success_title = body.success_title === '' ? null : body.success_title;
	if (body?.success_message !== undefined) updates.success_message = body.success_message === '' ? null : body.success_message;

	if (Object.keys(updates).length === 0) {
		return json({ error: 'No fields to update' }, { status: 400 });
	}

	const { data, error } = await supabase
		.from('quote_forms')
		.update(updates)
		.eq('id', id)
		.eq('user_id', event.locals.user.id)
		.select('id, name, title, steps, colors, success_title, success_message, created_at, updated_at')
		.single();

	if (error) {
		if (error.code === 'PGRST116') return json({ error: 'Form not found' }, { status: 404 });
		console.error('PUT /api/forms/[id]:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json({ form: data });
};

/**
 * DELETE /api/forms/[id]
 */
export const DELETE: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	const supabase = getSupabaseClient(event);
	const { error } = await supabase.from('quote_forms').delete().eq('id', id).eq('user_id', event.locals.user.id);
	if (error) {
		if (error.code === 'PGRST116') return json({ error: 'Form not found' }, { status: 404 });
		console.error('DELETE /api/forms/[id]:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return new Response(null, { status: 204 });
};
