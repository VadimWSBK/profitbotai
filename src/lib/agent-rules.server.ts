/**
 * Agent rules: tagged rules with embeddings for RAG retrieval.
 * Rules are embedded on insert/update; at chat time we embed the user message and retrieve top-K relevant rules.
 */

import { getSupabaseAdmin } from '$lib/supabase.server';
import {
	getEmbeddingKeyForAgent,
	getEmbeddings,
	type EmbeddingKey
} from '$lib/train-bot.server';

const MATCH_COUNT = 5;

export type AgentRule = { id: string; content: string; tags: string[] };

/** Embed a single text (for rules, usually one chunk per rule). */
async function embedOne(text: string, key: EmbeddingKey): Promise<number[]> {
	const embeddings = await getEmbeddings([text], key);
	return embeddings[0] ?? [];
}

/** Insert or update a rule with embedding. */
export async function upsertAgentRule(
	agentId: string,
	content: string,
	tags: string[] = [],
	ruleId?: string
): Promise<{ id: string; error?: string }> {
	const trimmed = content.trim();
	if (!trimmed) return { id: '', error: 'Rule content is required' };

	const key = await getEmbeddingKeyForAgent(agentId);
	if (!key) return { id: '', error: 'No embedding API key configured for this agent' };

	const embedding = await embedOne(trimmed, key);
	const admin = getSupabaseAdmin();

	const row = {
		agent_id: agentId,
		content: trimmed,
		tags: tags.filter(Boolean).map((t) => t.trim().toLowerCase()),
		embedding,
		enabled: true
	};

	if (ruleId) {
		const { error } = await admin
			.from('agent_rules')
			.update({
				content: row.content,
				tags: row.tags,
				embedding: row.embedding,
				updated_at: new Date().toISOString()
			})
			.eq('id', ruleId)
			.eq('agent_id', agentId);
		if (error) return { id: ruleId, error: error.message };
		return { id: ruleId };
	}

	const { data, error } = await admin
		.from('agent_rules')
		.insert(row)
		.select('id')
		.single();
	if (error) return { id: '', error: error.message };
	return { id: (data as { id: string }).id };
}

/** Retrieve top-K relevant rules for a query (user message) via similarity search. */
export async function getRelevantRulesForAgent(
	agentId: string,
	queryText: string,
	limit: number = MATCH_COUNT
): Promise<AgentRule[]> {
	if (!queryText?.trim()) return [];

	const key = await getEmbeddingKeyForAgent(agentId);
	if (!key) return [];

	const embedding = await embedOne(queryText.trim(), key);
	const admin = getSupabaseAdmin();

	const { data: rows, error } = await admin.rpc('match_agent_rules', {
		p_agent_id: agentId,
		p_query_embedding: embedding,
		p_match_count: limit
	});

	if (error) {
		console.error('[agent-rules] match_agent_rules:', error);
		return [];
	}

	const raw = (rows ?? []) as { id: string; content: string; tags: string[] }[];
	return raw.map((r) => ({
		id: r.id,
		content: r.content,
		tags: Array.isArray(r.tags) ? r.tags : []
	}));
}
