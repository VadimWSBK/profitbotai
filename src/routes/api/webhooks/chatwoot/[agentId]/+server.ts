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
import { getOrCreateAgentCache } from '$lib/gemini-cache.server';
import { generateWithCache } from '$lib/gemini-cached-generate.server';
import { getRelevantRulesForAgent } from '$lib/agent-rules.server';
import { getProductPricingForOwner, formatProductPricingForAgent } from '$lib/product-pricing.server';
import { getShopifyConfigForUser } from '$lib/shopify.server';
import { getDiyKitBuilderConfig } from '$lib/diy-kit-builder.server';
import { sendQuoteEmail } from '$lib/send-quote-email.server';
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
	return out.map((r) => ({
		role: r.role as 'user' | 'assistant',
		content: stripHtml(r.content ?? '')
	}));
}

/** Strip simple HTML from Chatwoot message content so we store and use plain text (extraction and LLM work correctly). */
function stripHtml(html: string): string {
	const t = html.trim();
	if (!t) return '';
	// Remove common tags (e.g. <p>, </p>, <br>, <div>) and decode basic entities
	return t
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>\s*<p>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.trim();
}

/** Extract name, email, phone, address from a message (e.g. "Vadim", "weisbekvadim@gmail.com", or "Vadim, weisbekvadim@gmail.com"). */
function extractContactFromText(text: string): { name?: string; email?: string; phone_number?: string; address?: string } {
	const out: { name?: string; email?: string; phone_number?: string; address?: string } = {};
	const t = text.trim();
	if (!t) return out;
	const emailMatch = t.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
	if (emailMatch) out.email = emailMatch[0].toLowerCase();
	const phoneMatch = t.match(/(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{0,4}/);
	if (phoneMatch) out.phone_number = phoneMatch[0].trim();
	const notNames = new Set(
		'how what when where why which can could would should may might will do does has have is are yes no ok okay the and for you try again common give quote done mail by now need want like get send'.split(
			' '
		)
	);
	const namePatterns = [
		/(?:my\s+name\s+is|i['']m|name\s+is|call\s+me|i\s+am)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
		/^([A-Za-z]+)\s*[,،]\s*[\w@.]/,
		/^([A-Za-z]+)\s+[\w@.]*@/,
		/(?:^|[\s,])([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/  // name at end (e.g. "... Vadim" or "Vadim Weisbek")
	];
	for (const re of namePatterns) {
		const m = t.match(re);
		if (m?.[1]?.trim()) {
			const name = m[1].trim();
			const words = name.toLowerCase().split(/\s+/);
			if (name.length >= 2 && name.length <= 50 && !words.some((w) => notNames.has(w))) {
				out.name = name;
				break;
			}
		}
	}
	// When the whole message is just a name (e.g. "Vadim" or "Vadim Weisbek") we might have missed it—reject if any word is a common word
	if (
		!out.name &&
		/^[A-Za-z][a-zA-Z\s-]{1,49}$/.test(t) &&
		t.length >= 2 &&
		!t.toLowerCase().split(/\s+/).some((w) => notNames.has(w))
	) {
		out.name = t.trim();
	}
	// Address: only from explicit "address is X", "I live at X", or street-style; do NOT use bare "at" (matches "quote at 242" / conversation text)
	const addressPatterns = [
		/(?:my\s+)?address\s*(?:is|:)\s*([^.?!\n]+?)(?=\s*(?:\.|$|,|email|phone|name)|$)/i,
		/(?:i\s+live\s+at|located\s+at)\s+([^.?!\n]+?)(?=\s*(?:\.|$|,)|$)/i,
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

/** Merge two contact extractions (prefer non-empty from either). */
function mergeContactExtractions(
	a: { name?: string; email?: string; phone_number?: string; address?: string },
	b: { name?: string; email?: string; phone_number?: string; address?: string }
): { name?: string; email?: string; phone_number?: string; address?: string } {
	return {
		name: (a.name?.trim() || b.name?.trim()) || undefined,
		email: (a.email?.trim() || b.email?.trim()) || undefined,
		phone_number: (a.phone_number?.trim() || b.phone_number?.trim()) || undefined,
		address: (a.address?.trim() || b.address?.trim()) || undefined
	};
}

/** Upsert our internal contact for this Chatwoot conversation. Each conversation gets one contact row: created on first incoming message, updated (name/email/phone/address/roof) as we extract more from later messages. Returns contact for LLM context. */
async function upsertChatwootInternalContact(
	admin: SupabaseClient,
	accountId: number,
	conversationId: number,
	agentId: string,
	allUserText: string,
	roofSizeSqm: number | null,
	existingChatwootContact?: { name?: string; email?: string; phone_number?: string },
	currentMessageContent?: string
): Promise<{ name?: string | null; email?: string | null; phone?: string | null; address?: string | null; roof_size_sqm?: number | null } | null> {
	// Extract from current message (e.g. "Vadim") and from full conversation; merge so we don't miss single-token replies
	const extracted = mergeContactExtractions(
		extractContactFromText(currentMessageContent ?? ''),
		extractContactFromText(allUserText)
	);
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
	const content = typeof contentRaw === 'string' ? stripHtml(contentRaw.trim()) : '';
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
		chatwootContactFromPayload,
		content
	);

	const contentLower = content.toLowerCase();
	const wantsDiyOrQuote =
		/\b(diy|do it myself|supply only|product only|quote|cost|price|how much|coat my roof)\b/i.test(contentLower) ||
		/\d+\s*(sqm|m2|m²)/i.test(content);

	// System prompt: ordered for Gemini implicit context caching (static first, dynamic last).
	// Implicit caching: Gemini 2.5 Flash caches ≥1024 tokens; static prefix = cache hits across requests.
	const role = (agentRow.bot_role as string) ?? '';
	const tone = (agentRow.bot_tone as string) ?? '';
	const instructions = (agentRow.bot_instructions as string) ?? '';
	const staticParts: string[] = [];
	const dynamicParts: string[] = [];

	// ---- STATIC (cached across requests) ----
	if (role.trim()) staticParts.push(role.trim());
	if (tone.trim()) staticParts.push(`Tone: ${tone.trim()}`);
	if (instructions.trim()) staticParts.push(instructions.trim());
	// Consolidated hardcoded rules (kept short to save tokens)
	staticParts.push(
		'Greeting: if user says hi/hello only, respond briefly (e.g. "Hi! How can I help?"). Do NOT launch into intro or pitch until they ask about quotes/pricing.'
	);
	staticParts.push(
		'Proceed with what the user already stated (DIY quote, Done For You, etc.)—do not reintroduce or re-ask options.'
	);
	staticParts.push(
		'Contact/quote: name, email, phone, address saved automatically. Do NOT announce "I\'ve saved your email" or similar. PDF quote is emailed automatically—say "I\'ve sent it to your email." Do NOT use send_email for Done For You quotes—we email it automatically. Do NOT include quote URL. Never say "technical issue"; if generate_quote errors, ask for the missing piece (e.g. email).'
	);
	staticParts.push(
		'Be positive when collecting details; thank the user. Do NOT apologize. Never ask for info already in "Current contact info we have". If we have name+email+roof, call generate_quote immediately. Ask only the one missing piece at a time.'
	);
	staticParts.push('Finish with a full sentence. For email requests: use send_email tool, include link in body, confirm in chat.');
	staticParts.push(
		'DIY: when roof size is known, call calculate_bucket_breakdown only—it returns breakdown and checkout link. Do NOT paste the raw URL—the chat shows a Proceed to checkout button.'
	);

	// ---- DYNAMIC (per request: RAG, pricing, DIY situational, contact) ----
	const RAG_RULE_LIMIT = 3;
	const RAG_RULE_MAX_CHARS = 280;
	try {
		const relevantRules = await getRelevantRulesForAgent(agentId, content, RAG_RULE_LIMIT);
		if (relevantRules.length > 0) {
			const ruleTexts = relevantRules.map((r) => {
				const c = r.content.trim();
				return c.length > RAG_RULE_MAX_CHARS ? c.slice(0, RAG_RULE_MAX_CHARS) + '…' : c;
			});
			dynamicParts.push(`Rules (follow these):\n${ruleTexts.join('\n\n')}`);
		}
	} catch (e) {
		console.error('[webhooks/chatwoot] getRelevantRulesForAgent:', e);
	}

	if (!wantsDiyOrQuote) {
		try {
			const products = await getProductPricingForOwner(ownerId);
			if (products.length > 0) {
				dynamicParts.push(`Current product pricing: ${formatProductPricingForAgent(products)}`);
			}
		} catch (e) {
			console.error('[webhooks/chatwoot] getProductPricingForOwner:', e);
		}
	}

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
				const names = [...new Set(roofKit.product_entries.map((e) => (e.display_name?.trim() || (DIY_ROLE_LABELS[e.role] ?? e.role))).filter(Boolean))];
				kitProductsLine = ` Kit: ${names.join(', ')}. Use ONLY tool result line items.`;
			}
		} catch (e) {
			console.error('[webhooks/chatwoot] getDiyKitBuilderConfig:', e);
		}
		if (extractedRoofSize != null && extractedRoofSize >= 1) {
			const roofSqm = Math.round(extractedRoofSize * 10) / 10;
			dynamicParts.push(
				`DIY: roof ${roofSqm} m². Call calculate_bucket_breakdown(roof_size_sqm:${roofSqm})—it returns breakdown and checkout link in one call. Include the link in your reply. Never calculate buckets yourself. Do NOT use generate_quote.${kitProductsLine || ''}`
			);
		} else {
			dynamicParts.push(
				`DIY: call calculate_bucket_breakdown (ask roof size if missing). It returns breakdown and checkout link together. Use tool result. Never calculate yourself. Do NOT use generate_quote.${kitProductsLine || ''}`
			);
		}
	}

	if (internalContact && (internalContact.name ?? internalContact.email ?? internalContact.phone ?? internalContact.address ?? internalContact.roof_size_sqm != null)) {
		const lines: string[] = ['Current contact info:'];
		if (internalContact.name) lines.push(`Name: ${internalContact.name}`);
		if (internalContact.email) lines.push(`Email: ${internalContact.email}`);
		if (internalContact.phone) lines.push(`Phone: ${internalContact.phone}`);
		if (internalContact.address) lines.push(`Address: ${internalContact.address}`);
		if (internalContact.roof_size_sqm != null) lines.push(`Roof: ${internalContact.roof_size_sqm} m²`);
		dynamicParts.push(lines.join(' '));
		if (internalContact.name && internalContact.email && internalContact.roof_size_sqm != null && !wantsDiyOrQuote) {
			dynamicParts.push('MANDATORY: Call generate_quote now. Do not ask to confirm.');
		} else if (internalContact.name && internalContact.email) {
			dynamicParts.push('We have name and email. Do NOT ask again. If roof size needed, ask once then generate_quote.');
		}
	}

	const staticSystemPrompt =
		staticParts.length > 0 ? staticParts.join('\n\n') : 'You are a helpful assistant.';
	const dynamicBlock = dynamicParts.length > 0 ? dynamicParts.join('\n\n') : '';
	const systemPrompt =
		[...staticParts, ...dynamicParts].length > 0
			? [...staticParts, ...dynamicParts].join('\n\n')
			: 'You are a helpful assistant.';

	if (env.CHATWOOT_DEBUG === '1' || env.CHATWOOT_DEBUG === 'true') {
		const dynamicLen = dynamicBlock.length;
		const staticLen = staticSystemPrompt.length;
		console.log(
			'[webhooks/chatwoot] promptSections',
			JSON.stringify({
				role: role.length,
				tone: tone.length,
				instructions: instructions.length,
				static: staticLen,
				dynamic: dynamicLen,
				total: systemPrompt.length,
				estTokens: Math.ceil(systemPrompt.length / 4)
			})
		);
	}

	// Tools: use agent's allowed_tools; ensure send_email, bucket calculator, and DIY checkout are available for Chatwoot
	let agentAllowedTools: string[] = Array.isArray(agentRow.allowed_tools) ? (agentRow.allowed_tools as string[]) : [];
	if (!agentAllowedTools.includes('send_email')) agentAllowedTools = [...agentAllowedTools, 'send_email'];
	if (wantsDiyOrQuote && !agentAllowedTools.includes('calculate_bucket_breakdown')) {
		agentAllowedTools = [...agentAllowedTools, 'calculate_bucket_breakdown'];
	}
	try {
		const shopifyConnected = Boolean(await getShopifyConfigForUser(admin, ownerId));
		if (shopifyConnected && !agentAllowedTools.includes('shopify_create_diy_checkout_link')) {
			agentAllowedTools = [...agentAllowedTools, 'shopify_create_diy_checkout_link'];
		}
	} catch {
		// ignore
	}

	// Truncate long assistant messages (e.g. DIY quotes with full checkout URLs) to reduce tokens while keeping context
	const MAX_ASSISTANT_CONTENT_CHARS = 600;
	let modelMessages = history.map((t) => {
		let content = t.content;
		if (t.role === 'assistant' && content.length > MAX_ASSISTANT_CONTENT_CHARS) {
			content = content.slice(0, MAX_ASSISTANT_CONTENT_CHARS) + ' [Full response with link/details was sent.]';
		}
		return { role: t.role as 'user' | 'assistant', content };
	});
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
			lastUserMessage: lastUser?.content?.slice(0, 150) ?? null,
			contactHasName: Boolean(internalContact?.name),
			contactHasEmail: Boolean(internalContact?.email),
			contactHasRoof: internalContact?.roof_size_sqm != null
		}));
	}

	let reply = '';
	let diyCheckoutUrl: string | null = null;
	let diyLineItemsSummary: string | null = null;
	let quoteDownloadUrl: string | null = null;
	/** True when the LLM already sent the quote via send_email tool—skip our automatic email to avoid duplicates. */
	let quoteEmailAlreadySentByTool = false;

	const tools = createAgentTools(admin, agentAllowedTools ?? undefined);
	const useExplicitCache = llmProvider?.toLowerCase() === 'google' && (apiKey?.trim?.() ?? '').length > 0;
	const modelForCache = llmModel?.trim() || 'gemini-2.5-flash';

	const extractFromToolResults = (
		toolResults: Array<{ toolName: string; output: unknown }>,
		name: string
	): unknown => {
		const t = toolResults.find((r) => r.toolName === name);
		return t?.output;
	};
	const sendEmailSucceeded = (toolResults: Array<{ toolName: string; output: unknown }>) => {
		const out = toolResults.find((r) => r.toolName === 'send_email')?.output;
		return out && typeof out === 'object' && out !== null && !('error' in out && (out as { error?: unknown }).error);
	};

	try {
		if (useExplicitCache) {
			const cacheName = await getOrCreateAgentCache({
				agentId,
				model: modelForCache,
				apiKey,
				staticSystemPrompt,
				tools,
				allowedToolNames: agentAllowedTools ?? []
			});

			if (cacheName) {
				// Prepend dynamic context to first user message (or insert if history starts with assistant)
				let messagesWithContext = modelMessages;
				if (dynamicBlock) {
					const first = modelMessages[0];
					if (first?.role === 'user') {
						messagesWithContext = [
							{ ...first, content: dynamicBlock + '\n\n---\n\n' + first.content },
							...modelMessages.slice(1)
						];
					} else {
						messagesWithContext = [{ role: 'user' as const, content: dynamicBlock }, ...modelMessages];
					}
				}

				const { text, toolResults } = await generateWithCache({
					cacheName,
					model: modelForCache,
					apiKey,
					messages: messagesWithContext,
					tools,
					agentContext,
					maxSteps: 5,
					maxOutputTokens: 2048
				});
				reply = text ?? '';

				// Check calculate_bucket_breakdown first (now includes checkout), then shopify_create_diy_checkout_link
				const diyOut =
					extractFromToolResults(toolResults, 'calculate_bucket_breakdown') ??
					extractFromToolResults(toolResults, 'shopify_create_diy_checkout_link');
				if (diyOut && typeof diyOut === 'object') {
					const r = diyOut as { lineItemsUI?: { quantity?: number; title?: string }[]; checkoutUrl?: string };
					if (typeof r.checkoutUrl === 'string' && r.checkoutUrl.trim()) {
						diyCheckoutUrl = r.checkoutUrl.trim();
						if (Array.isArray(r.lineItemsUI) && r.lineItemsUI.length > 0) {
							diyLineItemsSummary = r.lineItemsUI
								.map((li) => `${li.quantity ?? 0} x ${li.title ?? ''}`)
								.filter(Boolean)
								.join(', ');
						}
					}
				}
				const quoteOut = extractFromToolResults(toolResults, 'generate_quote');
				if (quoteOut && typeof quoteOut === 'object') {
					const r = quoteOut as { downloadUrl?: string };
					if (typeof r.downloadUrl === 'string' && r.downloadUrl.trim()) {
						quoteDownloadUrl = r.downloadUrl.trim();
					}
				}
				if (quoteDownloadUrl && sendEmailSucceeded(toolResults)) {
					quoteEmailAlreadySentByTool = true;
				}
			} else {
				// Cache creation failed, fallback to generateText
				const model = getAISdkModel(llmProvider, llmModel, apiKey);
				const result = await generateText({
					model,
					system: systemPrompt,
					messages: modelMessages,
					tools,
					stopWhen: stepCountIs(5),
					maxOutputTokens: 2048,
					experimental_context: agentContext
				});
				reply = result.text ?? '';
				const raw = result as {
					steps?: Array<{ toolResults?: Array<{ toolName?: string; output?: unknown }> }>;
					toolResults?: Array<{ toolName?: string; output?: unknown }>;
				};
				const searchToolResults = (name: string) => {
					let out = raw.toolResults?.find((r) => r.toolName === name)?.output;
					if (out) return out;
					for (let i = (raw.steps?.length ?? 0) - 1; i >= 0; i--) {
						out = raw.steps?.[i]?.toolResults?.find((r) => r.toolName === name)?.output;
						if (out) return out;
					}
				};
				const diyOut =
					searchToolResults('calculate_bucket_breakdown') ??
					searchToolResults('shopify_create_diy_checkout_link');
				if (diyOut && typeof diyOut === 'object') {
					const r = diyOut as { lineItemsUI?: { quantity?: number; title?: string }[]; checkoutUrl?: string };
					if (typeof r.checkoutUrl === 'string' && r.checkoutUrl.trim()) {
						diyCheckoutUrl = r.checkoutUrl.trim();
						if (Array.isArray(r.lineItemsUI) && r.lineItemsUI.length > 0) {
							diyLineItemsSummary = r.lineItemsUI
								.map((li) => `${li.quantity ?? 0} x ${li.title ?? ''}`)
								.filter(Boolean)
								.join(', ');
						}
					}
				}
				const quoteOut = searchToolResults('generate_quote');
				if (quoteOut && typeof quoteOut === 'object') {
					const r = quoteOut as { downloadUrl?: string };
					if (typeof r.downloadUrl === 'string' && r.downloadUrl.trim()) {
						quoteDownloadUrl = r.downloadUrl.trim();
					}
				}
				const sendEmailOut = searchToolResults('send_email');
				if (quoteDownloadUrl && sendEmailOut && typeof sendEmailOut === 'object' && sendEmailOut !== null && !('error' in sendEmailOut && (sendEmailOut as { error?: unknown }).error)) {
					quoteEmailAlreadySentByTool = true;
				}
			}
		} else {
			const model = getAISdkModel(llmProvider, llmModel, apiKey);
			const result = await generateText({
				model,
				system: systemPrompt,
				messages: modelMessages,
				tools,
				stopWhen: stepCountIs(5),
				maxOutputTokens: 2048,
				experimental_context: agentContext
			});
			reply = result.text ?? '';
			const raw = result as {
				steps?: Array<{ toolResults?: Array<{ toolName?: string; output?: unknown }> }>;
				toolResults?: Array<{ toolName?: string; output?: unknown }>;
			};
			const searchToolResults = (name: string) => {
				let out = raw.toolResults?.find((r) => r.toolName === name)?.output;
				if (out) return out;
				for (let i = (raw.steps?.length ?? 0) - 1; i >= 0; i--) {
					out = raw.steps?.[i]?.toolResults?.find((r) => r.toolName === name)?.output;
					if (out) return out;
				}
			};
			const diyOut =
				searchToolResults('calculate_bucket_breakdown') ??
				searchToolResults('shopify_create_diy_checkout_link');
			if (diyOut && typeof diyOut === 'object') {
				const r = diyOut as { lineItemsUI?: { quantity?: number; title?: string }[]; checkoutUrl?: string };
				if (typeof r.checkoutUrl === 'string' && r.checkoutUrl.trim()) {
					diyCheckoutUrl = r.checkoutUrl.trim();
					if (Array.isArray(r.lineItemsUI) && r.lineItemsUI.length > 0) {
						diyLineItemsSummary = r.lineItemsUI
							.map((li) => `${li.quantity ?? 0} x ${li.title ?? ''}`)
							.filter(Boolean)
							.join(', ');
					}
				}
			}
			const quoteOut = searchToolResults('generate_quote');
			if (quoteOut && typeof quoteOut === 'object') {
				const r = quoteOut as { downloadUrl?: string };
				if (typeof r.downloadUrl === 'string' && r.downloadUrl.trim()) {
					quoteDownloadUrl = r.downloadUrl.trim();
				}
			}
			const sendEmailOut = searchToolResults('send_email');
			if (quoteDownloadUrl && sendEmailOut && typeof sendEmailOut === 'object' && sendEmailOut !== null && !('error' in sendEmailOut && (sendEmailOut as { error?: unknown }).error)) {
				quoteEmailAlreadySentByTool = true;
			}
		}
	} catch (e) {
		console.error('[webhooks/chatwoot] LLM error:', e);
		reply = 'Sorry, I had trouble answering. Please try again.';
	}

	// Build what we'll store in our DB (full context including quote for next turn)
	let storedReply = reply;
	// Post only the text reply (no quote URL here—we send it as a separate article message like DIY)
	let contentToPost = reply;
	// When we have a DIY checkout link, strip raw URL from the message—the article card is the only link.
	if (diyCheckoutUrl) {
		// Strip raw checkout URLs (Shopify cart, checkout, invoice)
		const urlPattern = /https?:\/\/[^\s<>"')\]]*(?:cart|checkout|invoice|myshopify\.com\/cart)[^\s<>"')\]]*/gi;
		contentToPost = contentToPost.replace(urlPattern, '');
		// Strip markdown links to checkout: [text](url)
		contentToPost = contentToPost.replace(/\[([^\]]*)\]\((https?:\/\/[^)]*(?:cart|checkout|myshopify)[^)]*)\)/gi, '');
		contentToPost = contentToPost.replace(/\n{3,}/g, '\n\n').trim();
		// Remove redundant "link below" phrases—the card says "Proceed to checkout"
		contentToPost = contentToPost
			.replace(/\n*\s*(?:You can proceed to checkout using the link below|Click the link below to proceed to checkout)\.?\s*$/i, '')
			.trim();
	}

	const postUrl = `${baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
	const postHeaders = {
		'Content-Type': 'application/json',
		Accept: 'application/json',
		api_access_token: botToken
	};

	// 1) Send the conversational reply (text only)
	const postRes = await fetch(postUrl, {
		method: 'POST',
		headers: postHeaders,
		body: JSON.stringify({ content: contentToPost, message_type: 'outgoing' })
	});
	if (!postRes.ok) {
		const errText = await postRes.text();
		console.error('[webhooks/chatwoot] Chatwoot API error:', postRes.status, errText);
		return json({ error: 'Failed to send reply to Chatwoot' }, { status: 502 });
	}

	// 2) If we generated a Done For You quote, send a single article message with "Download your quote" link (like DIY checkout)
	if (quoteDownloadUrl) {
		const quoteArticleRes = await fetch(postUrl, {
			method: 'POST',
			headers: postHeaders,
			body: JSON.stringify({
				content: 'Your quote',
				message_type: 'outgoing',
				content_type: 'article',
				content_attributes: {
					items: [
						{
							title: 'Download your quote',
							description: 'Click to download your PDF quote.',
							link: quoteDownloadUrl
						}
					]
				}
			})
		});
		if (!quoteArticleRes.ok) {
			const errText = await quoteArticleRes.text();
			console.error('[webhooks/chatwoot] Chatwoot quote article error:', quoteArticleRes.status, errText);
		}
		storedReply = reply.trimEnd() + '\n\n[Download your quote](' + quoteDownloadUrl + ')';
	}

	// 3) If we have a DIY quote, send a card with a button-style "Proceed to checkout" link
	// Chatwoot accepts: article (title+link) or cards (title+description+actions with type link)
	// Cards with actions render as a proper button; article shows as a link card.
	if (diyCheckoutUrl) {
		const diyCardRes = await fetch(postUrl, {
			method: 'POST',
			headers: postHeaders,
			body: JSON.stringify({
				content: 'Your DIY quote is ready.',
				message_type: 'outgoing',
				content_type: 'cards',
				content_attributes: {
					items: [
						{
							title: 'Proceed to checkout',
							description: 'Click to complete your purchase.',
							actions: [
								{
									type: 'link',
									text: 'Proceed to checkout',
									uri: diyCheckoutUrl
								}
							]
						}
					]
				}
			})
		});
		if (!diyCardRes.ok) {
			// Fallback: try article format (some Chatwoot setups may prefer it)
			const diyArticleRes = await fetch(postUrl, {
				method: 'POST',
				headers: postHeaders,
				body: JSON.stringify({
					content: '',
					message_type: 'outgoing',
					content_type: 'article',
					content_attributes: {
						items: [
							{
								title: 'Proceed to checkout',
								description: 'Click the link below to proceed to checkout.',
								link: diyCheckoutUrl
							}
						]
					}
				})
			});
			if (!diyArticleRes.ok) {
				const errText = await diyArticleRes.text();
				console.error('[webhooks/chatwoot] Chatwoot DIY message error (cards+article fallback):', diyArticleRes.status, errText);
			}
		}
		// Keep stored context (reply includes full checkout preview block from LLM; no raw URL—card has the button)
		storedReply = contentToPost;
	}

	// 4) If we generated a Done For You quote, send the quote link by email when we have the contact's email (automatic; bot already said "I've sent it to your email")
	// Skip if the LLM already sent it via send_email tool to avoid duplicate emails.
	if (quoteDownloadUrl && internalContact?.email?.trim() && !quoteEmailAlreadySentByTool) {
		try {
			const emailResult = await sendQuoteEmail(admin, ownerId, {
				toEmail: internalContact.email.trim(),
				quoteDownloadUrl,
				customerName: internalContact.name ?? null,
				customSubject: 'Your Done For You quote',
				customBody: 'Your quote is ready. Download it using the link below.'
			});
			if (!emailResult.sent && env.CHATWOOT_DEBUG !== '1' && env.CHATWOOT_DEBUG !== 'true') {
				// Only log if not in debug to avoid noise (e.g. no Resend configured)
			} else if (!emailResult.sent) {
				console.warn('[webhooks/chatwoot] Quote email not sent:', emailResult.error);
			}
		} catch (e) {
			console.error('[webhooks/chatwoot] sendQuoteEmail:', e);
		}
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
	if (contactId == null && (env.CHATWOOT_DEBUG === '1' || env.CHATWOOT_DEBUG === 'true')) {
		console.warn('[webhooks/chatwoot] No Chatwoot contact id (body.contact.id or conversation meta.sender.id); cannot update Chatwoot contact');
	}
	if (contactId != null) {
		const allUserTextForContact = [content, ...history.filter((t) => t.role === 'user').map((t) => t.content)].join(' ');
		const extracted = mergeContactExtractions(
			extractContactFromText(content),
			extractContactFromText(allUserTextForContact)
		);
		const existing = body.contact as { name?: string; email?: string; phone_number?: string } | undefined;
		const updates = {
			name: (extracted.name?.trim() || existing?.name?.trim()) || undefined,
			email: (extracted.email?.trim() || existing?.email?.trim()) || undefined,
			phone_number: (extracted.phone_number?.trim() || existing?.phone_number?.trim()) || undefined,
			address: extracted.address?.trim() || undefined
		};
		// Only call API when we have at least one field to update (Chatwoot may reject empty PUT)
		if (updates.name || updates.email || updates.phone_number || updates.address) {
			const updated = await updateChatwootContact(baseUrl, botToken, accountId, contactId, updates);
			if (!updated && (env.CHATWOOT_DEBUG === '1' || env.CHATWOOT_DEBUG === 'true')) {
				console.warn('[webhooks/chatwoot] Chatwoot contact update failed or returned non-OK', { contactId, updates: !!updates.name });
			}
		}
	}

	if (env.CHATWOOT_DEBUG === '1' || env.CHATWOOT_DEBUG === 'true') {
		console.log('[webhooks/chatwoot] reply sent', reply?.slice(0, 150) ?? '');
	}

	return json({ received: true });
};
