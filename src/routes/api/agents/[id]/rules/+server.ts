import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { upsertAgentRule } from '$lib/agent-rules.server';

/**
 * GET /api/agents/[id]/rules – list rules for an agent (no embedding, for UI).
 */
export const GET: RequestHandler = async (event) => {
	const agentId = event.params.id;
	if (!agentId) return json({ error: 'Missing agent id' }, { status: 400 });

	try {
		const supabase = getSupabaseClient(event);
		const { data: rows, error } = await supabase
			.from('agent_rules')
			.select('id, content, tags, enabled, created_at')
			.eq('agent_id', agentId)
			.order('priority', { ascending: false })
			.order('created_at', { ascending: true });

		if (error) {
			if (error.code === '42P01') return json({ rules: [] }); // table doesn't exist yet
			console.error('agent_rules list:', error);
			return json({ error: error.message }, { status: 500 });
		}

		const rules = (rows ?? []).map((r) => ({
			id: r.id,
			content: r.content,
			tags: Array.isArray(r.tags) ? r.tags : [],
			enabled: r.enabled ?? true,
			createdAt: r.created_at
		}));
		return json({ rules });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to list rules';
		console.error('GET /api/agents/[id]/rules:', e);
		return json({ error: msg }, { status: 500 });
	}
};

/**
 * POST /api/agents/[id]/rules – add a rule. Body: { content: string, tags?: string[] }
 * Embeds the content and stores in agent_rules.
 */
export const POST: RequestHandler = async (event) => {
	const agentId = event.params.id;
	if (!agentId) return json({ error: 'Missing agent id' }, { status: 400 });
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const body = await event.request.json().catch(() => ({}));
		const content = typeof body.content === 'string' ? body.content : '';
		const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];

		const { id, error } = await upsertAgentRule(agentId, content, tags);
		if (error) return json({ error }, { status: 400 });

		return json({ id, success: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to add rule';
		console.error('POST /api/agents/[id]/rules:', e);
		return json({ error: msg }, { status: 500 });
	}
};
