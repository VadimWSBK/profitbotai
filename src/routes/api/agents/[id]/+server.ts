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
		const webhookTriggers = Array.isArray(data.webhook_triggers) ? data.webhook_triggers : [];
		const agent = {
			id: data.id,
			name: data.name,
			description: data.description ?? '',
			systemPrompt: data.system_prompt ?? '',
			allowedTools: allowedTools as string[],
			chatBackend: (data.chat_backend as string) ?? 'direct',
			n8nWebhookUrl: (data.n8n_webhook_url as string) ?? '',
			llmProvider: (data.llm_provider as string) ?? '',
			llmModel: (data.llm_model as string) ?? '',
			llmFallbackProvider: (data.llm_fallback_provider as string) ?? '',
			llmFallbackModel: (data.llm_fallback_model as string) ?? '',
			webhookTriggers: webhookTriggers as { id: string; name: string; description: string; webhookUrl: string; enabled: boolean }[],
			botRole: (data.bot_role as string) ?? '',
			botTone: (data.bot_tone as string) ?? '',
			botInstructions: (data.bot_instructions as string) ?? '',
			agentTakeoverTimeoutMinutes: typeof data.agent_takeover_timeout_minutes === 'number' ? data.agent_takeover_timeout_minutes : 5,
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
		if (body.chatBackend === 'n8n' || body.chatBackend === 'direct') updates.chat_backend = body.chatBackend;
		if (typeof body.n8nWebhookUrl === 'string') updates.n8n_webhook_url = body.n8nWebhookUrl;
		if (typeof body.llmProvider === 'string') updates.llm_provider = body.llmProvider;
		if (typeof body.llmModel === 'string') updates.llm_model = body.llmModel;
		if (typeof body.llmFallbackProvider === 'string') updates.llm_fallback_provider = body.llmFallbackProvider;
		if (typeof body.llmFallbackModel === 'string') updates.llm_fallback_model = body.llmFallbackModel;
		if (Array.isArray(body.webhookTriggers)) updates.webhook_triggers = body.webhookTriggers;
		if (typeof body.botRole === 'string') updates.bot_role = body.botRole;
		if (typeof body.botTone === 'string') updates.bot_tone = body.botTone;
		if (typeof body.botInstructions === 'string') updates.bot_instructions = body.botInstructions;
		if (typeof body.agentTakeoverTimeoutMinutes === 'number') updates.agent_takeover_timeout_minutes = body.agentTakeoverTimeoutMinutes;

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
