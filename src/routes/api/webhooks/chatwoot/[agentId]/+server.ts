/**
 * POST /api/webhooks/chatwoot/[agentId]
 * Per-agent Chatwoot webhook. Use this URL in Chatwoot's Add Bot → Webhook URL
 * so that agent's role, tone, instructions, Train Bot rules, and LLM power the bot.
 * Uses the same tooled flow as the widget: generateText + createAgentTools so DIY checkout
 * and other tools work. Fetches conversation history from Chatwoot and injects rules + product pricing.
 *
 * Env: CHATWOOT_BOT_ACCESS_TOKEN, CHATWOOT_BASE_URL (no CHATWOOT_AGENT_ID needed).
 * Debug: CHATWOOT_DEBUG=1 logs incoming payload and how we process it (Vercel → Runtime Logs).
 *
 * Payload we receive from Chatwoot (typical):
 *   event, message_type ('incoming'|'outgoing'), content, conversation: { id }, account: { id }, sender, ...
 * We only process message_type === 'incoming' and use content + conversation.id + account.id.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateText, stepCountIs } from 'ai';
import { getSupabaseAdmin } from '$lib/supabase.server';
import { getAISdkModel } from '$lib/ai-sdk-model.server';
import { createAgentTools } from '$lib/agent-tools.server';
import { getRelevantRulesForAgent } from '$lib/agent-rules.server';
import { getProductPricingForOwner, formatProductPricingForAgent } from '$lib/product-pricing.server';
import { getShopifyConfigForUser } from '$lib/shopify.server';
import { env } from '$env/dynamic/private';

/** Use the last 5 messages (turns) for context so the bot stays focused on the recent exchange. */
const MAX_HISTORY_MESSAGES = 5;
const MAX_HISTORY_CHARS = 6_000;

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

function byCreatedAt(a: ChatwootMessage, b: ChatwootMessage): number {
	const t1 = a.created_at ? new Date(a.created_at).getTime() : 0;
	const t2 = b.created_at ? new Date(b.created_at).getTime() : 0;
	return t1 - t2;
}

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

	// Ensure chronological order (API may not guarantee it)
	const sorted = [...list].sort(byCreatedAt);

	const turns: { role: 'user' | 'assistant'; content: string }[] = [];
	for (const m of sorted) {
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

/** Extract roof size (sqm) from conversation history so DIY tool can be called with the right value. */
function roofSizeFromHistory(turns: { role: string; content: string }[]): number | null {
	const roofRe =
		/(?:about|approximately|approx\.?)\s*(\d+(?:\.\d+)?)\s*(?:sqm|m2|m²|sq\s*m|square\s*metre[s]?|sq\.?\s*metre[s]?|sq\.?\s*m\.?)/i;
	const roofRe2 = /(\d+(?:\.\d+)?)\s*(?:sqm|m2|m²|sq\s*m|square\s*metre[s]?|sq\.?\s*metre[s]?|sq\.?\s*m\.?)/i;
	const roofRe3 = /roof\s*(?:is|size)?\s*:?\s*(?:about|approximately|approx\.?)?\s*(\d+(?:\.\d+)?)/i;
	const roofRe4 = /(?:size|area)\s*(?:is|of)?\s*(?:about|approximately|approx\.?)?\s*(\d+(?:\.\d+)?)/i;
	for (let i = turns.length - 1; i >= 0; i--) {
		const text = turns[i]?.content ?? '';
		const m =
			roofRe.exec(text) ?? roofRe2.exec(text) ?? roofRe3.exec(text) ?? roofRe4.exec(text);
		if (m?.[1]) {
			const n = Number.parseFloat(m[1]);
			if (n >= 1) return n;
		}
	}
	return null;
}

export const POST: RequestHandler = async (event) => {
	const agentId = event.params.agentId?.trim() ?? '';
	const botToken = (env.CHATWOOT_BOT_ACCESS_TOKEN ?? '').trim();
	const baseUrl = (env.CHATWOOT_BASE_URL ?? '').trim().replace(/\/+$/, '');

	if (!agentId || !botToken || !baseUrl) {
		console.error('[webhooks/chatwoot] Missing agentId, CHATWOOT_BOT_ACCESS_TOKEN, or CHATWOOT_BASE_URL');
		return json({ error: 'Webhook not configured' }, { status: 500 });
	}

	let body: ChatwootPayload & Record<string, unknown>;
	try {
		body = (await event.request.json()) as ChatwootPayload & Record<string, unknown>;
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const messageType = body?.message_type ?? (body as Record<string, unknown>).message_type;
	const content = typeof body?.content === 'string' ? body.content.trim() : '';
	const conversationId = body?.conversation?.id ?? (body?.conversation as { id?: number } | undefined)?.id;
	const accountId = body?.account?.id ?? (body?.account as { id?: number } | undefined)?.id;

	// Optional: log raw payload and how we process it (set CHATWOOT_DEBUG=1 in env)
	if (env.CHATWOOT_DEBUG === '1' || env.CHATWOOT_DEBUG === 'true') {
		console.log('[webhooks/chatwoot] payload', JSON.stringify({
			event: body?.event,
			message_type: messageType,
			content: content?.slice(0, 200),
			conversation_id: conversationId,
			account_id: accountId,
			agentId
		}));
	}

	if (messageType !== 'incoming') return json({ received: true });
	if (!content) return json({ received: true });
	if (conversationId == null || accountId == null) {
		console.warn('[webhooks/chatwoot] Missing conversation or account id in payload');
		return json({ received: true });
	}

	const admin = getSupabaseAdmin();
	const { data: agentRow, error: agentErr } = await admin
		.from('agents')
		.select('chat_backend, llm_provider, llm_model, bot_role, bot_tone, bot_instructions, allowed_tools, created_by')
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

	// Fetch conversation history first (needed for roof size extraction and for messages)
	const history = await getChatwootConversationHistory(
		baseUrl,
		botToken,
		accountId,
		conversationId,
		content
	);
	const extractedRoofSize = roofSizeFromHistory(history);
	const contentLower = content.toLowerCase();
	const wantsDiyOrQuote =
		/\b(diy|do it myself|supply only|product only|quote|cost|price|how much|coat my roof)\b/i.test(contentLower) ||
		/\d+\s*(sqm|m2|m²)/i.test(content);

	// System prompt: role, tone, instructions (same as widget), RAG rules, product pricing, DIY instruction
	const role = (agentRow.bot_role as string) ?? '';
	const tone = (agentRow.bot_tone as string) ?? '';
	const instructions = (agentRow.bot_instructions as string) ?? '';
	const parts: string[] = [];
	if (role.trim()) parts.push(role.trim());
	if (tone.trim()) parts.push(`Tone: ${tone.trim()}`);
	if (instructions.trim()) parts.push(instructions.trim());

	try {
		const relevantRules = await getRelevantRulesForAgent(agentId, content, 5);
		if (relevantRules.length > 0) {
			parts.push(`Rules (follow these):\n${relevantRules.map((r) => r.content).join('\n\n')}`);
		}
	} catch (e) {
		console.error('[webhooks/chatwoot] getRelevantRulesForAgent:', e);
	}

	// Product pricing (same as widget) so the bot can answer product/price questions
	try {
		const products = await getProductPricingForOwner(ownerId);
		if (products.length > 0) {
			parts.push(`Current product pricing: ${formatProductPricingForAgent(products)}`);
		}
	} catch (e) {
		console.error('[webhooks/chatwoot] getProductPricingForOwner:', e);
	}

	// DIY checkout: when user asks for DIY quote and we have roof size, tell the model to call the tool
	if (wantsDiyOrQuote && extractedRoofSize != null && extractedRoofSize >= 1) {
		const roofSqm = Math.round(extractedRoofSize * 10) / 10;
		parts.push(
			`The customer is asking for a DIY quote and we have their roof size (${roofSqm} m²). You MUST call the shopify_create_diy_checkout_link tool with roof_size_sqm: ${roofSqm}. After calling it, reply with a short intro that INCLUDES the bucket breakdown (e.g. "Here is your DIY quote for ${roofSqm} m²: you need X x 15L and Y x 10L NetZero UltraTherm."). Use the exact quantities from the tool result. Do NOT paste the full Items/Subtotal/TOTAL block—summarise the product breakdown only. Do NOT use generate_quote or create a PDF for DIY.`
		);
	} else if (wantsDiyOrQuote) {
		parts.push(
			'When the customer asks for a DIY quote or to buy product themselves: if they provide a roof size (e.g. "400 sqm"), call shopify_create_diy_checkout_link with that roof_size_sqm. If they have not given roof size yet, ask for it once, then call the tool with the value they provide. Reply with a short intro that includes the bucket breakdown from the tool result. Do NOT use generate_quote for DIY requests.'
		);
	}

	parts.push(
		"Respond directly to the user's latest message. If they have already stated what they want (e.g. a DIY quote, a done-for-you quote, or specific info), proceed with that—do not reintroduce yourself or re-ask the same options."
	);
	const systemPrompt = parts.length > 0 ? parts.join('\n\n') : 'You are a helpful assistant.';

	// Tools: use agent's allowed_tools and ensure DIY is available when Shopify is connected
	let agentAllowedTools: string[] | null = Array.isArray(agentRow.allowed_tools) ? (agentRow.allowed_tools as string[]) : null;
	try {
		const shopifyConnected = Boolean(await getShopifyConfigForUser(admin, ownerId));
		if (shopifyConnected) {
			const base = agentAllowedTools ?? [];
			if (!base.includes('shopify_create_diy_checkout_link')) {
				agentAllowedTools = [...base, 'shopify_create_diy_checkout_link'];
			}
		}
	} catch {
		// ignore
	}

	const modelMessages = history.map((t) => ({ role: t.role as 'user' | 'assistant', content: t.content }));
	const origin = event.url.origin;
	const agentContext = {
		ownerId,
		conversationId: '',
		widgetId: '',
		contact: null as { name?: string | null; email?: string | null; phone?: string | null; address?: string | null; roof_size_sqm?: number | null } | null,
		extractedRoofSize: extractedRoofSize ?? undefined,
		origin
	};

	if (env.CHATWOOT_DEBUG === '1' || env.CHATWOOT_DEBUG === 'true') {
		const lastUser = [...history].reverse().find((t) => t.role === 'user');
		console.log('[webhooks/chatwoot] processed', JSON.stringify({
			historyTurns: history.length,
			systemPromptChars: systemPrompt.length,
			extractedRoofSize: extractedRoofSize ?? null,
			lastUserMessage: lastUser?.content?.slice(0, 150) ?? null
		}));
	}

	let reply: string;
	try {
		const model = getAISdkModel(llmProvider, llmModel, apiKey);
		const tools = createAgentTools(admin, agentAllowedTools ?? undefined);
		const result = await generateText({
			model,
			system: systemPrompt,
			messages: modelMessages,
			tools,
			stopWhen: stepCountIs(5),
			maxOutputTokens: 1024,
			experimental_context: agentContext
		});
		reply = result.text ?? '';
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

	if (env.CHATWOOT_DEBUG === '1' || env.CHATWOOT_DEBUG === 'true') {
		console.log('[webhooks/chatwoot] reply sent', reply?.slice(0, 150) ?? '');
	}

	return json({ received: true });
};
