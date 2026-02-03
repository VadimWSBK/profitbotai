import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { isAgentTrainConfigured } from '$lib/train-bot.server';

/**
 * GET /api/agents/[id]/train – Train status and document count for this agent.
 */
export const GET: RequestHandler = async (event) => {
	const agentId = event.params.id;
	if (!agentId) return json({ error: 'Missing agent id' }, { status: 400 });
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const supabase = getSupabaseClient(event);
		const configured = await isAgentTrainConfigured(agentId);
		const { count, error } = await supabase
			.from('agent_documents')
			.select('*', { count: 'exact', head: true })
			.eq('agent_id', agentId);
		if (error) return json({ configured, documentCount: 0 });
		return json({ configured, documentCount: count ?? 0 });
	} catch {
		return json({ configured: false, documentCount: 0 });
	}
};
