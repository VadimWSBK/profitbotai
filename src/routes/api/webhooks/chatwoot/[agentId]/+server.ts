/**
 * POST /api/webhooks/chatwoot/[agentId]
 * Per-agent Chatwoot webhook. Use this URL in Chatwoot's Add Bot → Webhook URL
 * so that agent's role, tone, instructions, Train Bot rules, and LLM power the bot.
 * Uses the same tooled flow as the widget: generateText + createAgentTools so DIY checkout
 * and other tools work.
 *
 * CONTEXT: Chatwoot sends only the ONE new message in the payload. We store every incoming
 * message and our reply in public.chatwoot_conversation_messages (by account_id + conversation_id).
 * For each request we load the last 5 messages (up to ~6k chars) from our DB so the LLM has
 * context without calling Chatwoot's API. Flow: store incoming → load history from DB →
 * run LLM → post reply to Chatwoot → store our reply in DB.
 *
 * Env: CHATWOOT_BOT_ACCESS_TOKEN, CHATWOOT_BASE_URL (no CHATWOOT_AGENT_ID needed).
 * Debug: CHATWOOT_DEBUG=1 logs incoming payload and how we process it (Vercel → Runtime Logs).
 *
 * Payload we receive from Chatwoot (typical):
 *   event, message_type ('incoming'|'outgoing'), content, conversation: { id }, account: { id }, sender, contact, ...
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
import { getDiyKitBuilderConfig } from '$lib/diy-kit-builder.server';
import { env } from '$env/dynamic/private';
import { emailsToJsonb, mergeEmailIntoList, getPrimaryEmail } from '$lib/contact-email-jsonb';
import { phonesToJsonb, mergePhoneIntoList, getPrimaryPhone } from '$lib/contact-phone-jsonb';

/** Use the last 5 messages (turns) for context so the bot stays focused on the recent exchange. */
const MAX_HISTORY_MESSAGES = 5;
const MAX_HISTORY_CHARS = 6_000;

type ChatwootPayload = {
	event?: string;
	message_type?: string;
	content?: string;
	/** Chatwoot message id – we use this for idempotency (skip if we already processed this message) */
	id?: number;
	conversation?: { id: number };
	account?: { id: number };
	sender?: { id: string | number };
	/** Contact (customer) - id is required for updating contact via API */
	contact?: { id: number; name?: string; email?: string; phone_number?: string };
};

type SupabaseClient = import('@supabase/supabase-js').SupabaseClient;

/** Load conversation history from our DB (chatwoot_conversation_messages). Same truncation as before: last N messages, char budget. */
async function getChatwootHistoryFromDb(
	admin: SupabaseClient,
	accountId: number,
	conversationId: number
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
	const { data: rows, error } = await admin
		.from('chatwoot_conversation_messages')
		.select('role, content')
		.eq('account_id', accountId)
		.eq('conversation_id', conversationId)
		.order('created_at', { ascending: true });
	if (error) return [];
	const turns = (rows ?? []) as { role: string; content: string }[];
	let out = turns.slice(-MAX_HISTORY_MESSAGES);
	if (MAX_HISTORY_CHARS > 0) {
		let total = 0;
		let start = out.length;
		for (let i = out.length - 1; i >= 0; i--) {
			total += (out[i]?.content ?? '').length;
			if (total > MAX_HISTORY_CHARS) {
				start = i + 1;
				break;
			}
			start = i;
		}
		out = out.slice(start);
	}
	return out.map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content ?? '' }));
}

/** Extract name, email, phone, address from a message (e.g. "Vadim, weisbekvadim@gmail.com" or "address is 123 Main St"). */
function extractContactFromText(text: string): { name?: string; email?: string; phone_number?: string; address?: string } {
	const out: { name?: string; email?: string; phone_number?: string; address?: string } = {};
	const t = text.trim();
	if (!t) return out;
	const emailMatch = t.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
	if (emailMatch) out.email = emailMatch[0].toLowerCase();
	const phoneMatch = t.match(/(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{0,4}/);
	if (phoneMatch) out.phone_number = phoneMatch[0].trim();
	const notNames = new Set('how what when where why which can could would should may might will do does has have is are'.split(' '));
	const namePatterns = [
		/(?:my\s+name\s+is|i['']m|name\s+is|call\s+me|i\s+am)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
		/^([A-Za-z]+)\s*[,،]\s*[\w@.]/,
		/^([A-Za-z]+)\s+[\w@.]*@/
	];
	for (const re of namePatterns) {
		const m = t.match(re);
		if (m?.[1]?.trim()) {
			const name = m[1].trim();
			if (name.length >= 2 && !notNames.has(name.toLowerCase())) {
				out.name = name;
				break;
			}
		}
	}
	// Address: "address is X", "my address is X", "I live at X", "address: X", or line with number + street words
	const addressPatterns = [
		/(?:my\s+)?address\s*(?:is|:)\s*([^.?!\n]+?)(?=\s*(?:\.|$|,|email|phone|name)|$)/i,
		/(?:i\s+live\s+at|located\s+at|at)\s+([^.?!\n]+?)(?=\s*(?:\.|$|,)|$)/i,
		/\b(\d+[\s\w.,'-]+(?:street|st|road|rd|ave|avenue|drive|dr|lane|ln|way|place|pl|court|ct|parade|pde|blvd)[\s\w.,'-]*)/i
	];
	for (const re of addressPatterns) {
		const m = t.match(re);
		if (m?.[1]?.trim()) {
			const addr = m[1].trim();
			if (addr.length >= 5 && addr.length <= 200) {
				out.address = addr;
				break;
			}
		}
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

/** Get contact id for this conversation (from payload or by fetching conversation details). */
async function getChatwootContactId(
	baseUrl: string,
	botToken: string,
	accountId: number,
	conversationId: number,
	payloadContact?: { id?: number }
): Promise<number | null> {
	if (payloadContact?.id != null) return Number(payloadContact.id);
	const url = `${baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}`;
	const res = await fetch(url, { headers: { Accept: 'application/json', api_access_token: botToken } });
	if (!res.ok) return null;
	try {
		const data = (await res.json()) as { meta?: { sender?: { id?: number } } };
		const id = data?.meta?.sender?.id;
		return id != null ? Number(id) : null;
	} catch {
		return null;
	}
}

/** Update Chatwoot contact (name, email, phone_number, address). Only sends provided, non-empty fields. Address goes in additional_attributes. */
async function updateChatwootContact(
	baseUrl: string,
	botToken: string,
	accountId: number,
	contactId: number,
	updates: { name?: string; email?: string; phone_number?: string; address?: string }
): Promise<boolean> {
	const body: Record<string, string | Record<string, string>> = {};
	if (updates.name?.trim()) body.name = updates.name.trim();
	if (updates.email?.trim()) body.email = updates.email.trim();
	if (updates.phone_number?.trim()) body.phone_number = updates.phone_number.trim();
	if (updates.address?.trim()) body.additional_attributes = { address: updates.address.trim() };
	if (Object.keys(body).length === 0) return false;
	const url = `${baseUrl}/api/v1/accounts/${accountId}/contacts/${contactId}`;
	const res = await fetch(url, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json', api_access_token: botToken },
		body: JSON.stringify(body)
	});
	return res.ok;
}

/** Upsert our internal contact for this Chatwoot conversation so the LLM can see what we already have. Returns contact for context. */
async function upsertChatwootInternalContact(
	admin: SupabaseClient,
	accountId: number,
	conversationId: number,
	agentId: string,
	allUserText: string,
	roofSizeSqm: number | null,
	existingChatwootContact?: { name?: string; email?: string; phone_number?: string }
): Promise<{ name?: string | null; email?: string | null; phone?: string | null; address?: string | null; roof_size_sqm?: number | null } | null> {
	const extracted = extractContactFromText(allUserText);
	const { data: existing } = await admin
		.from('contacts')
		.select('id, name, email, phone, address, roof_size_sqm')
		.eq('chatwoot_account_id', accountId)
		.eq('chatwoot_conversation_id', conversationId)
		.maybeSingle();

	const updates: Record<string, unknown> = {
		chatwoot_account_id: accountId,
		chatwoot_conversation_id: conversationId,
		agent_id: agentId,
		conversation_id: null,
		widget_id: null
	};
	const name = extracted.name?.trim() ?? existingChatwootContact?.name?.trim() ?? (existing as { name?: string } | null)?.name?.trim();
	if (name) updates.name = name;
	const emailMerged = existing
		? mergeEmailIntoList((existing as { email?: unknown }).email, extracted.email ?? existingChatwootContact?.email)
		: emailsToJsonb(extracted.email ?? existingChatwootContact?.email);
	if (emailMerged.length > 0) updates.email = emailMerged;
	const phoneMerged = existing
		? mergePhoneIntoList((existing as { phone?: unknown }).phone, extracted.phone_number ?? existingChatwootContact?.phone_number)
		: phonesToJsonb(extracted.phone_number ?? existingChatwootContact?.phone_number);
	if (phoneMerged.length > 0) updates.phone = phoneMerged;
	const address = extracted.address?.trim() ?? (existing as { address?: string } | null)?.address?.trim();
	if (address) updates.address = address;
	const roof = roofSizeSqm != null && roofSizeSqm >= 0 ? roofSizeSqm : (existing as { roof_size_sqm?: number } | null)?.roof_size_sqm;
	if (roof != null) updates.roof_size_sqm = roof;

	const { error: upsertErr } = await admin.from('contacts').upsert(
		updates as Record<string, string | number | null>,
		{ onConflict: 'chatwoot_account_id,chatwoot_conversation_id', ignoreDuplicates: false }
	);
	if (upsertErr) {
		console.error('[webhooks/chatwoot] Failed to upsert internal contact:', upsertErr);
		return existing ? { name: (existing as { name?: string }).name, email: getPrimaryEmail((existing as { email?: unknown }).email), phone: getPrimaryPhone((existing as { phone?: unknown }).phone), address: (existing as { address?: string }).address, roof_size_sqm: (existing as { roof_size_sqm?: number }).roof_size_sqm } : null;
	}
	const { data: row } = await admin
		.from('contacts')
		.select('name, email, phone, address, roof_size_sqm')
		.eq('chatwoot_account_id', accountId)
		.eq('chatwoot_conversation_id', conversationId)
		.single();
	if (!row) return null;
	return {
		name: (row as { name?: string | null }).name ?? null,
		email: getPrimaryEmail((row as { email?: unknown }).email) ?? null,
		phone: getPrimaryPhone((row as { phone?: unknown }).phone) ?? null,
		address: (row as { address?: string | null }).address ?? null,
		roof_size_sqm: (row as { roof_size_sqm?: number | null }).roof_size_sqm ?? null
	};
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
		const raw = (await event.request.json()) as Record<string, unknown>;
		// Some Chatwoot configs send { payload: { ... } }; use inner object so rest of code works
		body = (raw?.payload != null && typeof raw.payload === 'object' ? raw.payload : raw) as ChatwootPayload & Record<string, unknown>;
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	// Support flat (content, message_type at top), nested (message.content), and message id in body.id or message.id
	const messageObj = body?.message as Record<string, unknown> | undefined;
	const messageType =
		body?.message_type ?? (body as Record<string, unknown>).message_type
		?? messageObj?.message_type;
	const contentRaw = body?.content ?? messageObj?.content;
	const content = typeof contentRaw === 'string' ? contentRaw.trim() : '';
	const conversationId = body?.conversation?.id ?? (body?.conversation as { id?: number } | undefined)?.id ?? (messageObj?.conversation as { id?: number } | undefined)?.id;
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
	// Idempotency: Chatwoot sometimes sends the same webhook twice; skip if we already processed this message id
	const rawMessageId = body?.id ?? messageObj?.id;
	const messageId = rawMessageId != null ? Number(rawMessageId) : null;
	if (messageId != null) {
		const { data: existing } = await admin
			.from('chatwoot_conversation_messages')
			.select('id')
			.eq('chatwoot_message_id', messageId)
			.limit(1)
			.maybeSingle();
		if (existing) return json({ received: true });
	}
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

	// Store incoming message in our DB, then load conversation history from our DB (no Chatwoot API call)
	try {
		const { error: insertErr } = await admin.from('chatwoot_conversation_messages').insert({
			account_id: accountId,
			conversation_id: conversationId,
			agent_id: agentId,
			role: 'user',
			content,
			...(messageId != null && { chatwoot_message_id: messageId })
		});
		if (insertErr) throw insertErr;
	} catch (e) {
		console.error('[webhooks/chatwoot] Failed to store user message:', e);
		// Continue so we still reply and store our reply; next turn may have gaps in history
	}
	const history = await getChatwootHistoryFromDb(admin, accountId, conversationId);
	const extractedRoofSize = roofSizeFromHistory(history);
	const allUserText = [content, ...history.filter((t) => t.role === 'user').map((t) => t.content)].join(' ');
	const chatwootContactFromPayload = body?.contact as { name?: string; email?: string; phone_number?: string } | undefined;
	const internalContact = await upsertChatwootInternalContact(
		admin,
		accountId,
		conversationId,
		agentId,
		allUserText,
		extractedRoofSize,
		chatwootContactFromPayload
	);

	const contentLower = content.toLowerCase();
	const wantsDiyOrQuote =
		/\b(diy|do it myself|supply only|product only|quote|cost|price|how much|coat my roof)\b/i.test(contentLower) ||
		/\d+\s*(sqm|m2|m²)/i.test(content);

	// System prompt: role, tone, instructions (same as widget), RAG rules, product pricing, DIY instruction, current contact
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

	// DIY checkout: when user asks for DIY quote, tell the model to call the tool and to describe only what's in the kit
	const DIY_ROLE_LABELS: Record<string, string> = {
		sealant: 'Sealant',
		thermal: 'Thermal coating',
		sealer: 'Sealer',
		geo: 'Geo-textile',
		rapidCure: 'Rapid-cure',
		brushRoller: 'Brush / Roller kit'
	};
	if (wantsDiyOrQuote) {
		let kitProductsLine = '';
		try {
			const roofKit = await getDiyKitBuilderConfig(admin, ownerId, 'roof-kit');
			if (roofKit?.product_entries?.length) {
				// Use "Name in checkout" (display_name) when set, so the bot uses the same names as checkout/breakdown
				const names = [...new Set(roofKit.product_entries.map((e) => (e.display_name?.trim() || (DIY_ROLE_LABELS[e.role] ?? e.role))).filter(Boolean))];
				kitProductsLine = ` This account's DIY kit contains only: ${names.join(', ')}. When describing what the quote includes, use these product names and ONLY the products in the tool result line items—do not add sealant, sealer, bonus kit, or other components unless they are in the breakdown.`;
			}
		} catch (e) {
			console.error('[webhooks/chatwoot] getDiyKitBuilderConfig:', e);
		}
		if (extractedRoofSize != null && extractedRoofSize >= 1) {
			const roofSqm = Math.round(extractedRoofSize * 10) / 10;
			parts.push(
				`The customer is asking for a DIY quote and we have their roof size (${roofSqm} m²). You MUST call the shopify_create_diy_checkout_link tool with roof_size_sqm: ${roofSqm}. After calling it, reply with a short intro that INCLUDES the bucket breakdown (e.g. "Here is your DIY quote for ${roofSqm} m²: you need X x 15L and Y x 10L NetZero UltraTherm."). Use the exact quantities from the tool result. Do NOT paste the full Items/Subtotal/TOTAL block—summarise the product breakdown only. Do NOT use generate_quote or create a PDF for DIY.${kitProductsLine || ' When describing what the quote includes, mention ONLY the products that appear in the tool result line items—do not add sealant, sealer, bonus kit, or other components unless they are in the breakdown.'}`
			);
		} else {
			parts.push(
				`When the customer asks for a DIY quote or to buy product themselves: if they provide a roof size (e.g. "400 sqm"), call shopify_create_diy_checkout_link with that roof_size_sqm. If they have not given roof size yet, ask for it once, then call the tool with the value they provide. Reply with a short intro that includes the bucket breakdown from the tool result. Do NOT use generate_quote for DIY requests.${kitProductsLine || ' When describing the quote, mention ONLY the products in the tool result—do not add sealant, sealer, bonus kit, or other components unless they appear in the breakdown.'}`
			);
		}
	}

	parts.push(
		"Respond directly to the user's latest message. If they have already stated what they want (e.g. a DIY quote, a done-for-you quote, or specific info), proceed with that—do not reintroduce yourself or re-ask the same options."
	);
	// So the bot doesn't try to call contact tools and then say it can't update
	parts.push(
		'In this channel, contact details the user provides (name, email, phone, address) are saved automatically to their Chatwoot profile. Confirm you have received their details and proceed—do not say you are unable to update contact details.'
	);
	// So the LLM knows what we already have and can respond accordingly (e.g. skip asking for name/email if we have them)
	if (internalContact && (internalContact.name ?? internalContact.email ?? internalContact.phone ?? internalContact.address ?? internalContact.roof_size_sqm != null)) {
		const lines: string[] = ['Current contact info we have:'];
		if (internalContact.name) lines.push(`Name: ${internalContact.name}`);
		if (internalContact.email) lines.push(`Email: ${internalContact.email}`);
		if (internalContact.phone) lines.push(`Phone: ${internalContact.phone}`);
		if (internalContact.address) lines.push(`Address: ${internalContact.address}`);
		if (internalContact.roof_size_sqm != null) lines.push(`Roof size: ${internalContact.roof_size_sqm} m²`);
		parts.push(lines.join(' '));
	}
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

	let modelMessages = history.map((t) => ({ role: t.role as 'user' | 'assistant', content: t.content }));
	// generateText requires at least one message (AI SDK InvalidPromptError). If Chatwoot API returned
	// empty/unexpected format or the current message wasn't included, ensure we send the incoming message.
	if (modelMessages.length === 0) {
		modelMessages = [{ role: 'user' as const, content }];
	}
	const origin = event.url.origin;
	const agentContext = {
		ownerId,
		conversationId: '',
		widgetId: '',
		contact: internalContact ?? null,
		extractedRoofSize: extractedRoofSize ?? undefined,
		origin,
		chatwootAccountId: accountId,
		chatwootConversationId: conversationId,
		agentId
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
	let diyCheckoutUrl: string | null = null;
	let diyLineItemsSummary: string | null = null;
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
		// If DIY tool was used, get checkout URL and line items so we append them to the reply (Chatwoot has no widget UI)
		const pickDiy = (tr: Array<{ toolName?: string; output?: unknown; result?: unknown }> | undefined) => {
			if (!Array.isArray(tr)) return;
			const diy = tr.find((r) => r.toolName === 'shopify_create_diy_checkout_link');
			if (!diy || typeof diy !== 'object') return;
			const out = (diy as { output?: unknown }).output ?? (diy as { result?: unknown }).result;
			if (!out || typeof out !== 'object') return;
			const r = out as { lineItemsUI?: { quantity?: number; title?: string }[]; checkoutUrl?: string };
			if (typeof r.checkoutUrl === 'string' && r.checkoutUrl.trim()) {
				const parts: string[] = [];
				if (Array.isArray(r.lineItemsUI) && r.lineItemsUI.length > 0) {
					parts.push(r.lineItemsUI.map((li) => `${li.quantity ?? 0} x ${li.title ?? ''}`).filter(Boolean).join(', '));
				}
				return { checkoutUrl: r.checkoutUrl.trim(), lineSummary: parts.length > 0 ? parts.join(' ') : null };
			}
		};
		const raw = result as {
			steps?: Array<{ toolResults?: Array<{ toolName?: string; output?: unknown; result?: unknown }> }>;
			toolResults?: Array<{ toolName?: string; output?: unknown; result?: unknown }>;
		};
		let diyResult = pickDiy(raw.toolResults);
		if (!diyResult && Array.isArray(raw.steps)) {
			for (let i = raw.steps.length - 1; i >= 0; i--) {
				diyResult = pickDiy(raw.steps[i].toolResults);
				if (diyResult) break;
			}
		}
		if (diyResult) {
			diyCheckoutUrl = diyResult.checkoutUrl;
			diyLineItemsSummary = diyResult.lineSummary;
		}
	} catch (e) {
		console.error('[webhooks/chatwoot] LLM error:', e);
		reply = 'Sorry, I had trouble answering. Please try again.';
	}

	// Build what we'll store in our DB (full context including quote for next turn)
	let storedReply = reply;

	const postUrl = `${baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
	const postHeaders = {
		'Content-Type': 'application/json',
		Accept: 'application/json',
		api_access_token: botToken
	};

	// 1) Send the conversational reply (text)
	const postRes = await fetch(postUrl, {
		method: 'POST',
		headers: postHeaders,
		body: JSON.stringify({ content: reply, message_type: 'outgoing' })
	});
	if (!postRes.ok) {
		const errText = await postRes.text();
		console.error('[webhooks/chatwoot] Chatwoot API error:', postRes.status, errText);
		return json({ error: 'Failed to send reply to Chatwoot' }, { status: 502 });
	}

	// 2) If we have a DIY quote, send a structured article message (checkout link only; items already in the text reply above)
	if (diyCheckoutUrl) {
		const articleDescription = 'Click the link below to proceed to checkout.';
		const articleRes = await fetch(postUrl, {
			method: 'POST',
			headers: postHeaders,
			body: JSON.stringify({
				content: 'Your DIY quote',
				message_type: 'outgoing',
				content_type: 'article',
				content_attributes: {
					items: [
						{
							title: 'Proceed to checkout',
							description: articleDescription,
							link: diyCheckoutUrl
						}
					]
				}
			})
		});
		if (!articleRes.ok) {
			const errText = await articleRes.text();
			console.error('[webhooks/chatwoot] Chatwoot article message error:', articleRes.status, errText);
		}
		// Keep stored context so next turn knows we sent the quote and link
		storedReply = reply.trimEnd() + (diyLineItemsSummary ? '\n\n**Items:** ' + diyLineItemsSummary : '') + '\n\n**Proceed to checkout:** ' + diyCheckoutUrl;
	}

	// Store our reply in our DB so next message has context from here
	try {
		const { error: assistantErr } = await admin.from('chatwoot_conversation_messages').insert({
			account_id: accountId,
			conversation_id: conversationId,
			agent_id: agentId,
			role: 'assistant',
			content: storedReply
		});
		if (assistantErr) throw assistantErr;
	} catch (e) {
		console.error('[webhooks/chatwoot] Failed to store assistant message:', e);
	}

	// Update Chatwoot contact when user provides name/email/phone (so CRM stays in sync)
	const contactId = await getChatwootContactId(baseUrl, botToken, accountId, conversationId, body.contact);
	if (contactId != null) {
		const allUserText = [content, ...history.filter((t) => t.role === 'user').map((t) => t.content)].join(' ');
		const extracted = extractContactFromText(allUserText);
		const existing = body.contact;
		const updates = {
			name: extracted.name ?? existing?.name?.trim(),
			email: extracted.email ?? existing?.email?.trim(),
			phone_number: extracted.phone_number ?? existing?.phone_number?.trim(),
			address: extracted.address
		};
		const updated = await updateChatwootContact(baseUrl, botToken, accountId, contactId, updates);
		if (env.CHATWOOT_DEBUG === '1' && updated) {
			console.log('[webhooks/chatwoot] contact updated', { contactId, hasName: !!updates.name, hasEmail: !!updates.email, hasPhone: !!updates.phone_number });
		}
	}

	if (env.CHATWOOT_DEBUG === '1' || env.CHATWOOT_DEBUG === 'true') {
		console.log('[webhooks/chatwoot] reply sent', reply?.slice(0, 150) ?? '');
	}

	return json({ received: true });
};
