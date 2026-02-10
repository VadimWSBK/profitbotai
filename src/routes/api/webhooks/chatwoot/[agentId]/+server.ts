/**
 * POST /api/webhooks/chatwoot/[agentId]
 * Per-agent Chatwoot webhook. Use this URL in Chatwoot's Add Bot → Webhook URL
 * so that agent's role, tone, instructions, and LLM power the bot.
 *
 * Env: CHATWOOT_BOT_ACCESS_TOKEN, CHATWOOT_BASE_URL (no CHATWOOT_AGENT_ID needed).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';
import { chatWithLlm } from '$lib/chat-llm.server';
import { env } from '$env/dynamic/private';

type ChatwootPayload = {
	event?: string;
	message_type?: string;
	content?: string;
	conversation?: { id: number };
	account?: { id: number };
	sender?: { id: string | number };
};

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

	const role = (agentRow.bot_role as string) ?? '';
	const tone = (agentRow.bot_tone as string) ?? '';
	const instructions = (agentRow.bot_instructions as string) ?? '';
	const parts: string[] = [];
	if (role) parts.push(`Role: ${role}`);
	if (tone) parts.push(`Tone: ${tone}`);
	if (instructions) parts.push(instructions);
	const systemPrompt = parts.length > 0 ? parts.join('\n\n') : 'You are a helpful assistant.';

	const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content }
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
