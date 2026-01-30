/**
 * Build LLM context from Supabase-stored conversation.
 * Single source of truth: all chat history comes from widget_conversation_messages.
 * Uses smart truncation so we keep recent turns and stay within context limits.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type LlmTurn = { role: 'user' | 'assistant'; content: string };

export type GetContextOptions = {
	/** Max number of messages (user + assistant turns) to include. Default 30. */
	maxMessages?: number;
	/** Optional rough character budget for history (excludes current message). Keeps most recent. */
	maxChars?: number;
};

const DEFAULT_MAX_MESSAGES = 30;
const DEFAULT_MAX_CHARS = 24_000; // ~6k tokens rough; leaves room for system + response

/**
 * Load conversation history from Supabase and return it in LLM-ready form.
 * Call this after persisting the latest user message so the AI sees full context.
 * Truncates to maxMessages and optionally to maxChars (drops oldest first).
 */
export async function getConversationContextForLlm(
	supabase: SupabaseClient,
	conversationId: string,
	options: GetContextOptions = {}
): Promise<LlmTurn[]> {
	const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

	const { data: rows, error } = await supabase
		.from('widget_conversation_messages')
		.select('role, content')
		.eq('conversation_id', conversationId)
		.order('created_at', { ascending: true });

	if (error) throw new Error(error.message);

	const raw = (rows ?? []) as { role: string; content: string }[];
	const allowedRoles = new Set(['user', 'assistant', 'human_agent']);
	const turns: LlmTurn[] = raw
		.filter((m) => allowedRoles.has(m.role))
		.map((m) => ({
			role: (m.role === 'human_agent' ? 'assistant' : m.role) as 'user' | 'assistant',
			content: m.content
		}));

	// Keep last N messages (most recent context)
	let out = turns.slice(-maxMessages);

	// Optionally trim by character budget from the start so we stay within context window
	if (maxChars > 0) {
		let total = 0;
		let start = out.length;
		for (let i = out.length - 1; i >= 0; i--) {
			total += out[i].content.length;
			if (total > maxChars) {
				start = i + 1; // keep from this index to end
				break;
			}
			start = i;
		}
		out = out.slice(start);
	}

	return out;
}
