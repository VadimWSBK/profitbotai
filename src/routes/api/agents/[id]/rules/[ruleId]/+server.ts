import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { upsertAgentRule } from '$lib/agent-rules.server';

/**
 * PATCH /api/agents/[id]/rules/[ruleId] – update a rule. Body: { content?: string, tags?: string[] }
 * Re-embeds if content changed.
 */
export const PATCH: RequestHandler = async (event) => {
	const agentId = event.params.id;
	const ruleId = event.params.ruleId;
	if (!agentId || !ruleId) return json({ error: 'Missing id' }, { status: 400 });
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const body = await event.request.json().catch(() => ({}));
		const content = typeof body.content === 'string' ? body.content : undefined;
		const tags = Array.isArray(body.tags) ? body.tags.map(String) : undefined;

		if (!content && tags === undefined) return json({ error: 'No fields to update' }, { status: 400 });

		const supabase = getSupabaseClient(event);
		const { data: existing } = await supabase
			.from('agent_rules')
			.select('content, tags')
			.eq('id', ruleId)
			.eq('agent_id', agentId)
			.single();

		if (!existing) return json({ error: 'Rule not found' }, { status: 404 });

		const newContent = content ?? existing.content;
		const newTags = tags ?? (Array.isArray(existing.tags) ? existing.tags : []);

		const { id, error } = await upsertAgentRule(agentId, newContent, newTags, ruleId);
		if (error) return json({ error }, { status: 400 });

		return json({ id, success: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to update rule';
		console.error('PATCH /api/agents/[id]/rules/[ruleId]:', e);
		return json({ error: msg }, { status: 500 });
	}
};

/**
 * DELETE /api/agents/[id]/rules/[ruleId] – delete a rule.
 */
export const DELETE: RequestHandler = async (event) => {
	const agentId = event.params.id;
	const ruleId = event.params.ruleId;
	if (!agentId || !ruleId) return json({ error: 'Missing id' }, { status: 400 });
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const supabase = getSupabaseClient(event);
		const { error } = await supabase
			.from('agent_rules')
			.delete()
			.eq('id', ruleId)
			.eq('agent_id', agentId);

		if (error) return json({ error: error.message }, { status: 500 });

		return new Response(null, { status: 204 });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to delete rule';
		console.error('DELETE /api/agents/[id]/rules/[ruleId]:', e);
		return json({ error: msg }, { status: 500 });
	}
};
