/**
 * POST /api/webhooks/chatwoot/[agentId]
 * Per-agent Chatwoot webhook. Use this URL in Chatwoot's Add Bot → Webhook URL
 * so that agent's role, tone, instructions, Train Bot rules, and LLM power the bot.
 * Fetches conversation history from Chatwoot and injects Profitbot agent rules (RAG) for context.
 *
 * Env: CHATWOOT_BOT_ACCESS_TOKEN, CHATWOOT_BASE_URL (no CHATWOOT_AGENT_ID needed).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';
import { chatWithLlm } from '$lib/chat-llm.server';
import { getRelevantRulesForAgent } from '$lib/agent-rules.server';
import { env } from '$env/dynamic/private';

const MAX_HISTORY_MESSAGES = 24;
const MAX_HISTORY_CHARS = 18_000;

type ChatwootPayload = {
	event?: string;
	message_type?: string;
	content?: string;
	conversation?: { id: number };
	account?: { id: number };
	sender?: { id: string | number };
};

type ChatwootMessage = {
	id?: number;
	content?: string | null;
	message_type?: string;
	created_at?: string;
};

/** Fetch conversation messages from Chatwoot API and return as LLM turns (user/assistant). */
async function getChatwootConversationHistory(
	baseUrl: string,
	botToken: string,
	accountId: number,
	conversationId: number,
	currentUserMessage: string
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
	const url = `${baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
	const res = await fetch(url, {
		headers: { Accept: 'application/json', api_access_token: botToken }
	});
	if (!res.ok) return [];

	let list: ChatwootMessage[];
	try {
		list = (await res.json()) as ChatwootMessage[];
	} catch {
		return [];
	}
	if (!Array.isArray(list)) return [];

	const turns: { role: 'user' | 'assistant'; content: string }[] = [];
	for (const m of list) {
		const type = (m.message_type ?? '').toLowerCase();
		const text = typeof m.content === 'string' ? m.content.trim() : '';
		if (!text) continue;
		if (type === 'incoming') turns.push({ role: 'user', content: text });
		else if (type === 'outgoing') turns.push({ role: 'assistant', content: text });
	}

	// Include the current message in history if not already last (Chatwoot may include it in the list)
	const lastIncoming = turns.findLast((t) => t.role === 'user');
	if (lastIncoming?.content !== currentUserMessage) {
		turns.push({ role: 'user', content: currentUserMessage });
	}

	// Keep last N messages and optionally trim by char budget (oldest first)
	let out = turns.slice(-MAX_HISTORY_MESSAGES);
	if (MAX_HISTORY_CHARS > 0) {
		let total = 0;
		let start = out.length;
		for (let i = out.length - 1; i >= 0; i--) {
			total += out[i].content.length;
			if (total > MAX_HISTORY_CHARS) {
				start = i + 1;
				break;
			}
			start = i;
		}
		out = out.slice(start);
	}
	return out;
}

export const POST: RequestHandler = async (event) => {
	const agentId = event.params.agentId?.trim() ?? '';
	const botToken = (env.CHATWOOT_BOT_ACCESS_TOKEN ?? '').trim();
	const baseUrl = (env.CHATWOOT_BASE_URL ?? '').trim().replace(/\/+$/, '');

	if (!agentId || !botToken || !baseUrl) {
		console.error('[webhooks/chatwoot] Missing agentId, CHATWOOT_BOT_ACCESS_TOKEN, or CHATWOOT_BASE_URL');
		return json({ error: 'Webhook not configured' }, { status: 500 });
	}

	let body: ChatwootPayload;
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const messageType = body?.message_type ?? (body as Record<string, unknown>).message_type;
	const content = typeof body?.content === 'string' ? body.content.trim() : '';
	const conversationId = body?.conversation?.id ?? (body?.conversation as { id?: number } | undefined)?.id;
	const accountId = body?.account?.id ?? (body?.account as { id?: number } | undefined)?.id;

	if (messageType !== 'incoming') return json({ received: true });
	if (!content) return json({ received: true });
	if (conversationId == null || accountId == null) {
		console.warn('[webhooks/chatwoot] Missing conversation or account id in payload');
		return json({ received: true });
	}

	const admin = getSupabaseAdmin();
	const { data: agentRow, error: agentErr } = await admin
		.from('agents')
		.select('chat_backend, llm_provider, llm_model, bot_role, bot_tone, bot_instructions, created_by')
		.eq('id', agentId)
		.single();

	if (agentErr || !agentRow) {
		console.error('[webhooks/chatwoot] Agent not found:', agentId, agentErr?.message);
		return json({ error: 'Agent not found' }, { status: 404 });
	}
	if ((agentRow.chat_backend as string) !== 'direct') {
		console.error('[webhooks/chatwoot] Agent is configured for n8n; Chatwoot webhook requires direct LLM');
		return json({ error: 'Agent must use direct LLM for Chatwoot' }, { status: 400 });
	}

	const llmProvider = (agentRow.llm_provider as string) ?? '';
	const llmModel = (agentRow.llm_model as string) ?? '';
	const ownerId = agentRow.created_by as string | null;
	if (!llmProvider || !ownerId) {
		console.error('[webhooks/chatwoot] Agent missing LLM config or owner');
		return json({ error: 'Agent not configured for direct chat' }, { status: 400 });
	}

	const { data: keyRow } = await admin
		.from('user_llm_keys')
		.select('api_key')
		.eq('user_id', ownerId)
		.eq('provider', llmProvider)
		.single();
	const apiKey = keyRow?.api_key ?? null;
	if (!apiKey) {
		console.error('[webhooks/chatwoot] No API key for agent owner/provider');
		return json({ error: 'No LLM key configured' }, { status: 400 });
	}

	// System prompt: role, tone, instructions + Profitbot Train Bot rules (RAG)
	const role = (agentRow.bot_role as string) ?? '';
	const tone = (agentRow.bot_tone as string) ?? '';
	const instructions = (agentRow.bot_instructions as string) ?? '';
	const parts: string[] = [];
	if (role) parts.push(`Role: ${role}`);
	if (tone) parts.push(`Tone: ${tone}`);
	if (instructions) parts.push(instructions);

	try {
		const relevantRules = await getRelevantRulesForAgent(agentId, content, 5);
		if (relevantRules.length > 0) {
			parts.push(`Rules (follow these):\n${relevantRules.map((r) => r.content).join('\n\n')}`);
		}
	} catch (e) {
		console.error('[webhooks/chatwoot] getRelevantRulesForAgent:', e);
	}
	const systemPrompt = parts.length > 0 ? parts.join('\n\n') : 'You are a helpful assistant.';

	// Conversation history from Chatwoot so the bot has context
	const history = await getChatwootConversationHistory(
		baseUrl,
		botToken,
		accountId,
		conversationId,
		content
	);

	const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
		{ role: 'system', content: systemPrompt },
		...history.map((t) => ({ role: t.role, content: t.content }))
	];

	let reply: string;
	try {
		reply = await chatWithLlm(llmProvider, llmModel, apiKey, messages);
	} catch (e) {
		console.error('[webhooks/chatwoot] LLM error:', e);
		reply = 'Sorry, I had trouble answering. Please try again.';
	}

	const postUrl = `${baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
	const postRes = await fetch(postUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			api_access_token: botToken
		},
		body: JSON.stringify({ content: reply })
	});

	if (!postRes.ok) {
		const errText = await postRes.text();
		console.error('[webhooks/chatwoot] Chatwoot API error:', postRes.status, errText);
		return json({ error: 'Failed to send reply to Chatwoot' }, { status: 502 });
	}

	return json({ received: true });
};
