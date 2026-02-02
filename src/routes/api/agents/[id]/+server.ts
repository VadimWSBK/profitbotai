import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/agents/[id] – fetch one agent (full for editor).
 */
export const GET: RequestHandler = async (event) => {
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });

	try {
		const supabase = getSupabaseClient(event);
		const { data, error } = await supabase.from('agents').select('*').eq('id', id).single();

		if (error) {
			if (error.code === 'PGRST116') return json({ error: 'Not found' }, { status: 404 });
			console.error('Supabase agent get error:', error);
			return json({ error: error.message }, { status: 500 });
		}

		const allowedTools = Array.isArray(data.allowed_tools) ? data.allowed_tools : [];
		const agent = {
			id: data.id,
			name: data.name,
			description: data.description ?? '',
			systemPrompt: data.system_prompt ?? '',
			allowedTools: allowedTools as string[],
			createdBy: data.created_by,
			createdAt: data.created_at,
			updatedAt: data.updated_at
		};
		return json(agent);
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to get agent';
		console.error('GET /api/agents/[id]:', e);
		return json({ error: msg }, { status: 500 });
	}
};

/**
 * PATCH /api/agents/[id] – update agent.
 * Body: { name?, description?, system_prompt? }
 */
export const PATCH: RequestHandler = async (event) => {
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const supabase = getSupabaseClient(event);
		const body = await event.request.json().catch(() => ({}));
		const updates: Record<string, unknown> = {};

		if (typeof body.name === 'string') updates.name = body.name;
		if (typeof body.description === 'string') updates.description = body.description;
		if (typeof body.system_prompt === 'string') updates.system_prompt = body.system_prompt;
		if (Array.isArray(body.allowed_tools)) updates.allowed_tools = body.allowed_tools;

		if (Object.keys(updates).length === 0) {
			return json({ error: 'No fields to update' }, { status: 400 });
		}

		const { data, error } = await supabase
			.from('agents')
			.update(updates)
			.eq('id', id)
			.select()
			.single();

		if (error) {
			if (error.code === 'PGRST116') return json({ error: 'Not found' }, { status: 404 });
			console.error('Supabase agent update error:', error);
			return json({ error: error.message }, { status: 500 });
		}

		return json({ agent: data });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to update agent';
		console.error('PATCH /api/agents/[id]:', e);
		return json({ error: msg }, { status: 500 });
	}
};

/**
 * DELETE /api/agents/[id] – delete agent (and agent_documents via FK cascade).
 */
export const DELETE: RequestHandler = async (event) => {
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const supabase = getSupabaseClient(event);
		const { error } = await supabase.from('agents').delete().eq('id', id);

		if (error) {
			if (error.code === 'PGRST116') return json({ error: 'Not found' }, { status: 404 });
			console.error('Supabase agent delete error:', error);
			return json({ error: error.message }, { status: 500 });
		}

		return new Response(null, { status: 204 });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to delete agent';
		console.error('DELETE /api/agents/[id]:', e);
		return json({ error: msg }, { status: 500 });
	}
};
