import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateText, stepCountIs } from 'ai';
import { getSupabase, getSupabaseAdmin } from '$lib/supabase.server';
import { createAgentTools } from '$lib/agent-tools.server';
import { getAISdkModel } from '$lib/ai-sdk-model.server';
import { getConversationContextForLlm } from '$lib/conversation-context.server';
import { getTriggerResultIfAny } from '$lib/trigger-webhook.server';
import { extractContactFromMessage } from '$lib/extract-contact.server';
import { generateQuoteForConversation } from '$lib/quote-pdf.server';
import { getQuoteWorkflowForWidget, runQuoteWorkflow } from '$lib/run-workflow.server';
import { getRelevantRulesForAgent } from '$lib/agent-rules.server';
import { getProductPricingForOwner, formatProductPricingForAgent, getProductImageUrlsBySize } from '$lib/product-pricing.server';
import { env } from '$env/dynamic/private';
import { getShopifyConfigForUser, getDiyProductImages } from '$lib/shopify.server';
import type { WebhookTrigger } from '$lib/widget-config';
import { getPrimaryEmail } from '$lib/contact-email-jsonb';

/** Extract roof size (sqm) from conversation history so DIY trigger works when user says "DIY" after earlier "400 sqm". */
function roofSizeFromHistory(turns: { role: string; content: string }[]): number | null {
	const roofRe =
		/(?:about|approximately|approx\.?)\s*(\d+(?:\.\d+)?)\s*(?:sqm|m2|m²|sq\s*m|square\s*metre[s]?|sq\.?\s*metre[s]?|sq\.?\s*m\.?)/i;
	const roofRe2 = /(\d+(?:\.\d+)?)\s*(?:sqm|m2|m²|sq\s*m|square\s*metre[s]?|sq\.?\s*metre[s]?|sq\.?\s*m\.?)/i;
	const roofRe3 = /roof\s*(?:is|size)?\s*:?\s*(?:about|approximately|approx\.?)?\s*(\d+(?:\.\d+)?)/i;
	const roofRe4 = /(?:size|area)\s*(?:is|of)?\s*(?:about|approximately|approx\.?)?\s*(\d+(?:\.\d+)?)/i;
	for (let i = turns.length - 1; i >= 0; i--) {
		const content = turns[i]?.content ?? '';
		const m =
			roofRe.exec(content) ??
			roofRe2.exec(content) ??
			roofRe3.exec(content) ??
			roofRe4.exec(content);
		if (m?.[1]) {
			const n = Number.parseFloat(m[1]);
			if (n >= 1) return n;
		}
	}
	return null;
}

/**
 * POST /api/widgets/[id]/chat – Direct LLM chat (no n8n).
 * Body: { message: string, sessionId?: string }
 * Persists messages to widget_conversations / widget_conversation_messages.
 * If operator took over (is_ai_active = false): no in-chat message; if live agent hasn't replied
 * within agentTakeoverTimeoutMinutes, switches back to AI and replies with an apology + answer.
 */
export const POST: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	if (!widgetId) return json({ error: 'Missing widget id' }, { status: 400 });

	let body: { message?: string; sessionId?: string };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const message = typeof body?.message === 'string' ? body.message.trim() : '';
	if (!message) return json({ error: 'Missing message' }, { status: 400 });
	const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim()
		? body.sessionId.trim()
		: `anon-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

	// Set session cookie so GET /messages can restore session after refresh (cookie sent with credentials)
	const sessionCookieName = 'pb_sid_' + (widgetId || '').replace(/[^a-z0-9-]/gi, '_');
	const isSecure = event.url.protocol === 'https:';
	event.cookies.set(sessionCookieName, sessionId, {
		path: '/',
		maxAge: 31536000,
		sameSite: isSecure ? 'none' : 'lax',
		secure: isSecure
	});

	let conversationIdForTyping: string | null = null;
	try {
		const supabase = getSupabase();
		const { data: widget, error: widgetError } = await supabase
			.from('widgets')
			.select('config, created_by')
			.eq('id', widgetId)
			.single();
		if (widgetError || !widget) return json({ error: 'Widget not found' }, { status: 404 });

		const config = (widget.config as Record<string, unknown>) ?? {};
		const agentId = typeof config.agentId === 'string' ? config.agentId.trim() : '';
		const admin = getSupabaseAdmin();

		// When widget has an agent, use agent's connect + bot config; otherwise use widget config.
		type EffectiveConfig = {
			chatBackend: string;
			llmProvider: string;
			llmModel: string;
			llmFallbackProvider?: string;
			llmFallbackModel?: string;
			agentTakeoverTimeoutMinutes: number;
			webhookTriggers: WebhookTrigger[];
			bot: { role?: string; tone?: string; instructions?: string };
			agentAutonomy: boolean;
			agentAllowedTools?: string[] | null;
			keyOwnerId: string | null; // user id to resolve LLM key (widget or agent owner)
		};
		let effectiveConfig: EffectiveConfig;

		if (agentId) {
			const { data: agentRow, error: agentErr } = await admin
				.from('agents')
				.select('chat_backend, llm_provider, llm_model, llm_fallback_provider, llm_fallback_model, agent_takeover_timeout_minutes, webhook_triggers, bot_role, bot_tone, bot_instructions, allowed_tools, created_by')
				.eq('id', agentId)
				.single();
			if (agentErr || !agentRow) return json({ error: 'Agent not found' }, { status: 404 });
			if ((agentRow.chat_backend as string) !== 'direct') return json({ error: 'Agent is configured for n8n; use n8n webhook for chat' }, { status: 400 });
			effectiveConfig = {
				chatBackend: 'direct',
				llmProvider: (agentRow.llm_provider as string) ?? '',
				llmModel: (agentRow.llm_model as string) ?? '',
				llmFallbackProvider: (agentRow.llm_fallback_provider as string) || undefined,
				llmFallbackModel: (agentRow.llm_fallback_model as string) || undefined,
				agentTakeoverTimeoutMinutes: typeof agentRow.agent_takeover_timeout_minutes === 'number' ? agentRow.agent_takeover_timeout_minutes : 5,
				webhookTriggers: (Array.isArray(agentRow.webhook_triggers) ? agentRow.webhook_triggers : []) as WebhookTrigger[],
				bot: {
					role: (agentRow.bot_role as string) ?? '',
					tone: (agentRow.bot_tone as string) ?? '',
					instructions: (agentRow.bot_instructions as string) ?? ''
				},
				// Default to true when using an agent so DIY/tools run and checkout table is shown
				agentAutonomy: config.agentAutonomy !== false,
				agentAllowedTools: Array.isArray(agentRow.allowed_tools) ? (agentRow.allowed_tools as string[]) : null,
				keyOwnerId: agentRow.created_by as string | null
			};
		} else {
			const chatBackend = config.chatBackend as string | undefined;
			if (chatBackend !== 'direct') return json({ error: 'Widget is not configured for Direct LLM' }, { status: 400 });
			effectiveConfig = {
				chatBackend: 'direct',
				llmProvider: (config.llmProvider as string) ?? '',
				llmModel: (config.llmModel as string) ?? '',
				llmFallbackProvider: (config.llmFallbackProvider as string) || undefined,
				llmFallbackModel: (config.llmFallbackModel as string) || undefined,
				agentTakeoverTimeoutMinutes: Math.max(1, Math.min(120, Number((config.agentTakeoverTimeoutMinutes as number) ?? 5))),
				webhookTriggers: (config.webhookTriggers as WebhookTrigger[] | undefined) ?? [],
				bot: (config.bot as { role?: string; tone?: string; instructions?: string }) ?? {},
				agentAutonomy: Boolean(config.agentAutonomy),
				agentAllowedTools: null,
				keyOwnerId: widget.created_by as string | null
			};
		}

		// Get or create conversation
		let { data: conv, error: convErr } = await supabase
			.from('widget_conversations')
			.select('id, is_ai_active')
			.eq('widget_id', widgetId)
			.eq('session_id', sessionId)
			.single();
		if (convErr && convErr.code !== 'PGRST116') {
			console.error('widget_conversations select:', convErr);
			return json({ error: 'Failed to load conversation' }, { status: 500 });
		}
		if (!conv) {
			const { data: inserted, error: insertErr } = await supabase
				.from('widget_conversations')
				.insert({ widget_id: widgetId, session_id: sessionId, is_ai_active: true })
				.select('id, is_ai_active')
				.single();
			if (insertErr || !inserted) return json({ error: 'Failed to create conversation' }, { status: 500 });
			conv = inserted;
		}

		// Ensure a contact exists for this conversation (created on first message, updated as we learn more)
		await supabase
			.from('contacts')
			.upsert(
				{ conversation_id: conv.id, widget_id: widgetId },
				{ onConflict: 'conversation_id', ignoreDuplicates: true }
			);

		// Persist user message first so it is included when we load history
		const { error: userMsgErr } = await supabase
			.from('widget_conversation_messages')
			.insert({ conversation_id: conv.id, role: 'user', content: message });
		if (userMsgErr) return json({ error: 'Failed to save message' }, { status: 500 });

		let resumingAfterAgentTimeout = false;
		// If human took over: no in-chat notice. If live agent hasn't replied in timeout, switch back to AI.
		if (!conv.is_ai_active) {
			const timeoutMinutes = effectiveConfig.agentTakeoverTimeoutMinutes;
			const { data: lastAgent } = await supabase
				.from('widget_conversation_messages')
				.select('created_at')
				.eq('conversation_id', conv.id)
				.eq('role', 'human_agent')
				.order('created_at', { ascending: false })
				.limit(1)
				.maybeSingle();
			const lastAgentAt = lastAgent?.created_at ? new Date(lastAgent.created_at).getTime() : 0;
			const elapsedMs = Date.now() - lastAgentAt;
			if (lastAgentAt === 0 || elapsedMs < timeoutMinutes * 60 * 1000) {
				// Live agent active and within timeout: no bot message
				return json({ output: '', liveAgentActive: true });
			}
			// Timeout elapsed: switch back to AI and continue below (with apology in system prompt)
			resumingAfterAgentTimeout = true;
			const { error: switchErr } = await supabase.rpc('switch_conversation_back_to_ai', {
				p_conv_id: conv.id
			});
			if (switchErr) {
				console.error('switch_conversation_back_to_ai:', switchErr);
				return json({ output: '', liveAgentActive: true });
			}
			conv = { ...conv, is_ai_active: true };
		}

		const llmProvider = effectiveConfig.llmProvider;
		const llmModel = effectiveConfig.llmModel;
		const llmFallbackProvider = effectiveConfig.llmFallbackProvider;
		const llmFallbackModel = effectiveConfig.llmFallbackModel;
		if (!llmProvider) return json({ error: 'No primary LLM selected' }, { status: 400 });

		const ownerId = widget.created_by as string | null;
		if (!ownerId) return json({ error: 'Widget has no owner' }, { status: 400 });

		// Signal "AI is generating" so the client can show typing and poll until done (no artificial timeout).
		conversationIdForTyping = conv.id;
		const adminSupabaseForTyping = getSupabaseAdmin();
		const typingUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min max
		await adminSupabaseForTyping
			.from('widget_conversations')
			.update({ agent_typing_until: typingUntil, agent_typing_by: null })
			.eq('id', conv.id);

		let apiKey: string | null = null;
		if (agentId && effectiveConfig.keyOwnerId) {
			const { data: keyRow } = await admin
				.from('user_llm_keys')
				.select('api_key')
				.eq('user_id', effectiveConfig.keyOwnerId)
				.eq('provider', llmProvider)
				.single();
			apiKey = keyRow?.api_key ?? null;
		} else {
			const { data: keyData, error: keyError } = await supabase.rpc('get_owner_llm_key_for_chat', {
				p_widget_id: widgetId,
				p_provider: llmProvider
			});
			if (!keyError && keyData) apiKey = keyData;
		}
		if (!apiKey) return json({ error: 'Owner has no API key for this provider' }, { status: 400 });

		// Use stored chat from Supabase as the only source of context (includes the message we just saved)
		const llmHistory = await getConversationContextForLlm(supabase, conv.id, {
			maxMessages: 30,
			maxChars: 24_000
		});

		// Load contact (name, email, roof_size_sqm, pdf_quotes) for context – bot can reference stored info and quote links
		const { data: contact } = await supabase
			.from('contacts')
			.select('name, email, phone, address, roof_size_sqm, pdf_quotes')
			.eq('conversation_id', conv.id)
			.maybeSingle();

		// 1. Extract contact info + roof size first (so we have it for webhook triggers)
		const extractedContact = await extractContactFromMessage(message, {
			llmProvider,
			llmModel,
			apiKey,
			conversationContext: llmHistory
		});

		// Update contact if we extracted name, email, phone, address, or roof size from the message
		// Skip email if another contact already has it (contacts_email_unique constraint)
		const hasExtractedFields =
			extractedContact.name ||
			extractedContact.email ||
			extractedContact.phone ||
			extractedContact.address ||
			extractedContact.roofSize != null;
		if (hasExtractedFields) {
			const updates: Record<string, string | number | string[]> = {};
			if (extractedContact.name) updates.name = extractedContact.name;
			if (extractedContact.phone) updates.phone = extractedContact.phone;
			if (extractedContact.address) updates.address = extractedContact.address;
			if (extractedContact.roofSize != null && Number(extractedContact.roofSize) >= 0)
				updates.roof_size_sqm = Number(extractedContact.roofSize);
			if (extractedContact.email) {
				const norm = extractedContact.email.trim().toLowerCase();
				const { data: existing } = await supabase
					.from('contacts')
					.select('id')
					.contains('email', [norm])
					.neq('conversation_id', conv.id)
					.limit(1)
					.maybeSingle();
				if (!existing) updates.email = [norm];
			}
			if (Object.keys(updates).length > 0) {
				const { error: contactErr } = await supabase
					.from('contacts')
					.update(updates)
					.eq('conversation_id', conv.id)
					.eq('widget_id', widgetId);
				if (contactErr) console.error('contact update from extraction:', contactErr);
			}
		}

		// Merge extracted fields into contact (for system prompt + webhook payload).
		// Use conversation history for roof size when user said "400 sqm" earlier and now says "DIY".
		const fromExtracted =
			extractedContact.roofSize == null ? undefined : Number(extractedContact.roofSize);
		const fromContact =
			contact?.roof_size_sqm == null ? undefined : Number(contact.roof_size_sqm);
		const fromHistory = roofSizeFromHistory(llmHistory);
		const effectiveRoofSize = fromExtracted ?? fromContact ?? (fromHistory != null ? fromHistory : undefined);
		// Persist history-derived roof size to contact so DIY fallback and future turns have it
		if (effectiveRoofSize != null && fromHistory != null && (fromExtracted == null && fromContact == null) && contact) {
			await admin
				.from('contacts')
				.update({ roof_size_sqm: effectiveRoofSize })
				.eq('conversation_id', conv.id)
				.eq('widget_id', widgetId);
		}
		const contactForPrompt = contact
			? {
					...contact,
					...(extractedContact.name && { name: extractedContact.name }),
					...(extractedContact.email && { email: extractedContact.email }),
					...(extractedContact.phone && { phone: extractedContact.phone }),
					...(extractedContact.address && { address: extractedContact.address }),
					...(effectiveRoofSize != null && { roof_size_sqm: effectiveRoofSize })
				}
			: null;

		// 2. Run intent classification: built-in quote (no n8n) + optional webhook triggers
		const webhookTriggers = effectiveConfig.webhookTriggers;
		const builtInQuoteTrigger: WebhookTrigger = {
			id: 'quote',
			name: 'Quote',
			description: 'User asks for a roof quote, cost estimate, or price by area (e.g. sqm).',
			webhookUrl: '',
			enabled: true
		};
		const triggersForClassification = [builtInQuoteTrigger, ...webhookTriggers];
		let quoteEmailSent: boolean | null = null; // set when we generate + send quote
		let triggerResult =
			apiKey && triggersForClassification.length > 0
				? await getTriggerResultIfAny(triggersForClassification, message, {
						llmProvider,
						llmModel,
						apiKey,
						sessionId,
						conversationId: conv.id,
						widgetId,
						conversationContext: llmHistory,
						contact: contactForPrompt,
						extracted:
							extractedContact.roofSize == null
								? null
								: { roofSize: extractedContact.roofSize }
					})
				: null;

		// Fallback: if classifier missed it but we have all required fields for a quote
		const QUOTE_KEYWORDS = /quote|cost|price|estimate|sqm|m2|m²|square\s*metres?|sq\.?\s*metres?|roof\s*size|area\s*is|square\s*foot/i; // NOSONAR - intentional keyword set
		const hasQuoteKeyword = QUOTE_KEYWORDS.test(message);
		const fallbackHasRoofSize = extractedContact.roofSize != null;
		const fallbackHasEmail = !!(contactForPrompt?.email ?? extractedContact.email);
		const fallbackHasName = !!(contactForPrompt?.name ?? extractedContact.name);
		// Multi-turn fallback: assistant recently asked for quote info (name/email/roof) and user is providing it
		const lastAssistantMsg = llmHistory.findLast((t) => t.role === 'assistant')?.content ?? '';
		const assistantAskedForQuote = /quote|name|email|roof|sqm|square\s*metre|cost|estimate|price/i.test(lastAssistantMsg);
		if (triggerResult === null && fallbackHasRoofSize && fallbackHasEmail && fallbackHasName) {
			if (hasQuoteKeyword || assistantAskedForQuote) {
				triggerResult = {
					triggerId: 'quote',
					triggerName: 'Quote',
					webhookResult: ''
				};
				console.log('[chat/quote] fallback: treating as quote intent', {
					hasQuoteKeyword,
					assistantAskedForQuote
				});
			}
		}

		if (triggerResult) {
			console.log('[chat/quote] trigger matched', { triggerId: triggerResult.triggerId, triggerName: triggerResult.triggerName });
		} else {
			console.log('[chat/quote] no trigger matched for message (intent classification returned none)');
		}

		// When quote intent matches: run widget's "Message in the chat" / "Customer requests quote" workflow instead of hardcoded generate+email
		const quoteTriggerIds = new Set(['quote', 'roof_quote']);
		const isQuoteIntent =
			triggerResult &&
			(quoteTriggerIds.has(triggerResult.triggerId.toLowerCase()) ||
				/quote|roof.*quote|cost.*(area|sqm|square\s*metre)/i.test(
					triggerResult.triggerId + ' ' + (triggerResult.triggerName ?? '')
				));
		if (isQuoteIntent) {
			const contact = contactForPrompt ?? { name: null, email: null, phone: null, address: null };
			const hasName = !!(contact.name ?? extractedContact.name);
			const hasEmail = !!(contact.email ?? extractedContact.email);
			const hasRoofSize =
			(extractedContact.roofSize != null && Number(extractedContact.roofSize) >= 0) ||
			('roof_size_sqm' in contact && contact.roof_size_sqm != null && Number(contact.roof_size_sqm) >= 0);

			// DIY vs Done For You: only generate PDF when user wants us to do the work
			const msg = message.toLowerCase();
			const wantsDoneForYou = /\b(you do it|you coat|professional|install|done for me|get you to|have you do|you guys|your team|someone to do)\b|done for you/i.test(msg);
			const wantsDiy = /\b(myself|diy|do it myself|buy the product|supply only|product only)\b/i.test(msg);

			console.log('[chat/quote] intent=quote', {
				hasName,
				hasEmail,
				hasRoofSize,
				wantsDoneForYou,
				wantsDiy,
				extractedRoofSize: extractedContact.roofSize
			});

			if (hasName && hasEmail && hasRoofSize) {
				// If DIY: use checkout tool when Shopify connected so widget shows table + button; else calculate in chat
				if (wantsDiy) {
					const adminSupabaseForQuote = getSupabaseAdmin();
					const shopifyConfig = ownerId ? await getShopifyConfigForUser(adminSupabaseForQuote, ownerId) : null;
					const shopifyConnected = Boolean(shopifyConfig);
					const roofSqm = effectiveRoofSize == null ? null : Math.round(Number(effectiveRoofSize) * 10) / 10;
					if (shopifyConnected && roofSqm !== null && roofSqm >= 1) {
						triggerResult = {
							triggerId: triggerResult!.triggerId,
							triggerName: triggerResult!.triggerName,
							webhookResult: `The customer wants DIY and we have their roof size (${roofSqm} m²). Call calculate_bucket_breakdown(roof_size_sqm: ${roofSqm})—it returns breakdown and checkout link. Include both: 1) Short intro with bucket breakdown and total. 2) The full checkout preview block from the tool (Items, Shipping, Subtotal, TOTAL, GST included, GO TO CHECKOUT). Use for both discounted and non-discounted. Do NOT use generate_quote or create a PDF for DIY.`
						};
					} else {
						triggerResult = {
							triggerId: triggerResult!.triggerId,
							triggerName: triggerResult!.triggerName,
							webhookResult:
								'The customer wants DIY. Calculate litres (roof size ÷ 2), buckets (15L $389.99, 10L $285.99, 5L $149.99), and total cost in chat. Do NOT use generate_quote or create a PDF.'
						};
					}
				} else if (wantsDoneForYou === false && wantsDiy === false) {
					// Ambiguous: ask DIY vs Done For You before generating
					triggerResult = {
						triggerId: triggerResult!.triggerId,
						triggerName: triggerResult!.triggerName,
						webhookResult:
							'We have name, email, and roof size. Ask: "Do you plan to do it yourself (DIY) or would you like us to coat the roof for you?" For DIY, use calculate_bucket_breakdown (returns breakdown + checkout link) so the chat shows the product table and checkout button. For Done For You, they will confirm and you can use generate_quote.'
					};
				} else {
					// wantsDoneForYou: generate the PDF
				const adminSupabase = getSupabaseAdmin();
				const quoteWorkflow = await getQuoteWorkflowForWidget(adminSupabase, widgetId);
				if (quoteWorkflow) {
					try {
						const runResult = await runQuoteWorkflow(adminSupabase, quoteWorkflow, {
							conversationId: conv.id,
							widgetId,
							ownerId: ownerId ?? '',
							contact,
							extractedRoofSize:
								effectiveRoofSize ?? undefined,
							origin: event.url.origin
						});
						quoteEmailSent = runResult.quoteEmailSent;
						triggerResult = {
							triggerId: runResult.triggerId,
							triggerName: runResult.triggerName,
							webhookResult: runResult.webhookResult + (triggerResult?.webhookResult ?? '')
						};
						console.log('[chat/quote] Workflow ran', { workflowId: quoteWorkflow.id, quoteEmailSent });
					} catch (e) {
						console.error('[chat/quote] runQuoteWorkflow threw:', e);
						triggerResult = {
							triggerId: triggerResult!.triggerId,
							triggerName: triggerResult!.triggerName,
							webhookResult: `(Workflow failed: ${e instanceof Error ? e.message : 'Unknown error'}. ${triggerResult?.webhookResult ?? ''})`
						};
					}
				} else {
					// No live quote workflow: generate quote directly so the agent can share the link
					try {
						const gen = await generateQuoteForConversation(
							adminSupabase,
							conv.id,
							widgetId,
							contact,
							effectiveRoofSize == null ? null : { roofSize: effectiveRoofSize },
							ownerId ?? undefined
						);
						if (gen.signedUrl && gen.storagePath) {
							await adminSupabase.rpc('append_pdf_quote_to_contact', {
								p_conversation_id: conv.id,
								p_widget_id: widgetId,
								p_pdf_url: gen.storagePath,
								p_total: gen.total ?? null
							});
							quoteEmailSent = false; // no workflow email
							// Use the short /api/quote/download redirect so the link never expires
							// (it generates a fresh signed URL on each click)
							const downloadUrl = `${event.url.origin}/api/quote/download?path=${encodeURIComponent(gen.storagePath)}`;
							triggerResult = {
								triggerId: triggerResult!.triggerId,
								triggerName: triggerResult!.triggerName,
								webhookResult: `Quote generated successfully. You MUST include this exact clickable link in your reply on a single line: [Download PDF Quote](${downloadUrl}). Confirm the quote is ready and share the link.`
							};
							console.log('[chat/quote] Generated quote directly (no workflow)');
						} else {
							triggerResult = {
								triggerId: triggerResult!.triggerId,
								triggerName: triggerResult!.triggerName,
								webhookResult: `Quote could not be generated: ${gen.error ?? 'Unknown error'}. Apologise and offer to have a specialist follow up.`
							};
						}
					} catch (e) {
						console.error('[chat/quote] generateQuoteForConversation threw:', e);
						triggerResult = {
							triggerId: triggerResult!.triggerId,
							triggerName: triggerResult!.triggerName,
							webhookResult: `Quote generation failed: ${e instanceof Error ? e.message : 'Unknown error'}. Apologise and offer to have a specialist follow up.`
						};
					}
				}
			}
			} else {
				// Missing name/email but may have roof size. If user is asking for a price (e.g. "how much to coat 777 sqm"),
				// use the DIY calculator so they get the bucket breakdown and the widget shows the table.
				const missing: string[] = [];
				if (!hasName) missing.push('name');
				if (!hasEmail) missing.push('email');
				if (!hasRoofSize) missing.push('roof size in square metres');
				const roofSqmForDiy =
					effectiveRoofSize != null && Number(effectiveRoofSize) >= 1
						? Math.round(Number(effectiveRoofSize) * 10) / 10
						: null;
				const isPriceRequest =
					/\b(how much|price|cost|quote|estimate)\b|coat\s+.*\d+|\d+\s*(sqm|m2|m²)/i.test(message);
				if (
					hasRoofSize &&
					roofSqmForDiy !== null &&
					isPriceRequest &&
					!wantsDoneForYou &&
					ownerId
				) {
					const adminSupabaseForDiy = getSupabaseAdmin();
					const shopifyConnected = Boolean(
						await getShopifyConfigForUser(adminSupabaseForDiy, ownerId)
					);
					if (shopifyConnected) {
						triggerResult = {
							triggerId: triggerResult!.triggerId,
							triggerName: triggerResult!.triggerName,
							webhookResult: `The customer is asking for a price and we have their roof size (${roofSqmForDiy} m²). Call calculate_bucket_breakdown(roof_size_sqm: ${roofSqmForDiy})—it returns breakdown and checkout link. Include both: 1) Short intro with bucket breakdown and total. 2) The full checkout preview block from the tool. Use for both discounted and non-discounted. Do NOT use generate_quote or create a PDF. If they want to proceed to checkout, ask for their name and email.`
						};
						console.log(
							'[chat/quote] Roof size only + price request: forcing DIY calculator',
							{ roofSqm: roofSqmForDiy }
						);
					}
				}
				if (
					!triggerResult?.webhookResult?.includes('shopify_create_diy_checkout_link') &&
					!triggerResult?.webhookResult?.includes('calculate_bucket_breakdown')
				) {
					console.log('[chat/quote] Workflow not run: missing', missing.join(', '));
					const instruction = `The user wants a quote but we need the following before we can help: ${missing.join(', ')}. Politely ask for only the missing information. Once we have name, email, and roof size, we will ask whether they want DIY (we calculate in chat) or Done For You (we coat the roof for them—PDF quote).`;
					triggerResult = {
						triggerId: triggerResult!.triggerId,
						triggerName: triggerResult!.triggerName,
						webhookResult: instruction
					};
				}
			}
		}

		// Fallback: user replied "yes DIY" / "as i said DIY" but quote intent wasn't triggered (short message).
		// Force the DIY checkout tool so the widget gets checkoutPreview and shows the table + button.
		const msgLower = message.toLowerCase();
		const wantsDiyFallback = /\b(myself|diy|do it myself|buy the product|supply only|product only)\b/i.test(msgLower);
		const hasRoofForDiy =
			effectiveRoofSize != null && Number(effectiveRoofSize) >= 1 ||
			(extractedContact.roofSize != null && Number(extractedContact.roofSize) >= 0) ||
			(contactForPrompt?.roof_size_sqm != null && Number(contactForPrompt.roof_size_sqm) >= 0);
		const hasNameForDiy = !!(contactForPrompt?.name ?? extractedContact.name);
		const hasEmailForDiy = !!(contactForPrompt?.email ?? extractedContact.email);
		const alreadyHasDiyInstruction =
			triggerResult?.webhookResult?.includes('shopify_create_diy_checkout_link') ||
			triggerResult?.webhookResult?.includes('calculate_bucket_breakdown');
		if (
			wantsDiyFallback &&
			hasRoofForDiy &&
			hasNameForDiy &&
			hasEmailForDiy &&
			!alreadyHasDiyInstruction &&
			ownerId
		) {
			const adminSupabaseForDiy = getSupabaseAdmin();
			const shopifyConnected = Boolean(await getShopifyConfigForUser(adminSupabaseForDiy, ownerId));
			const roofSqm = effectiveRoofSize == null ? null : Math.round(Number(effectiveRoofSize) * 10) / 10;
			if (shopifyConnected && roofSqm !== null && roofSqm >= 1) {
				triggerResult = {
					triggerId: 'quote',
					triggerName: 'Quote',
					webhookResult: `The customer wants DIY and we have their roof size (${roofSqm} m²). Call calculate_bucket_breakdown(roof_size_sqm: ${roofSqm})—it returns breakdown and checkout link. Include both: 1) Short intro with bucket breakdown and total. 2) The full checkout preview block from the tool (Items, Shipping, Subtotal, TOTAL, GST included, GO TO CHECKOUT). Use for both discounted and non-discounted. Do NOT use generate_quote or create a PDF for DIY.`
				};
				console.log('[chat/quote] DIY fallback: forcing tool call so widget shows table + button');
			}
		}

		const agentAutonomy = effectiveConfig.agentAutonomy;
		let agentAllowedTools = effectiveConfig.agentAllowedTools ?? null;
		// Ensure DIY checkout tool is available when Shopify is connected so the chat can show the product table
		if (agentAutonomy && ownerId) {
			try {
				const shopify = await getShopifyConfigForUser(adminSupabaseForTyping, ownerId);
				if (shopify) {
					const base = Array.isArray(agentAllowedTools) ? agentAllowedTools : [];
					if (!base.includes('shopify_create_diy_checkout_link') && !base.includes('calculate_bucket_breakdown')) {
						agentAllowedTools = [...base, 'calculate_bucket_breakdown', 'shopify_create_diy_checkout_link'];
					}
				}
			} catch {
				// ignore
			}
		}
		const bot = effectiveConfig.bot;

		// ── System prompt: Role + Tone (identity) ──────────────────────────
		// Everything else (formatting rules, tool usage, quote flow, etc.)
		// belongs in the agent's RAG knowledge base, not hardcoded here.
		const parts: string[] = [];
		if (bot.role?.trim()) parts.push(bot.role.trim());
		if (bot.tone?.trim()) parts.push(`Tone: ${bot.tone.trim()}`);
		if (bot.instructions?.trim()) parts.push(bot.instructions.trim());

		// ── RAG: retrieve relevant rules (limit 3, 280 chars each to save tokens) ──
		const RAG_RULE_LIMIT = 3;
		const RAG_RULE_MAX_CHARS = 280;
		if (agentId && message) {
			try {
				const relevantRules = await getRelevantRulesForAgent(agentId, message, RAG_RULE_LIMIT);
				if (relevantRules.length > 0) {
					const ruleTexts = relevantRules.map((r) => {
						const c = r.content.trim();
						return c.length > RAG_RULE_MAX_CHARS ? c.slice(0, RAG_RULE_MAX_CHARS) + '…' : c;
					});
					parts.push(`Rules (follow these):\n${ruleTexts.join('\n\n')}`);
				}
			} catch (e) {
				console.error('[chat] getRelevantRulesForAgent:', e);
			}
		}

		// ── Dynamic context: product pricing ───────────────────────────────
		if (ownerId) {
			const products = await getProductPricingForOwner(ownerId);
			if (products.length > 0) {
				parts.push(`Current product pricing: ${formatProductPricingForAgent(products)}`);
			}
		}

		// ── Dynamic context: contact data ──────────────────────────────────
		const currentContact = contactForPrompt;
		const contactLines: string[] = [];
		if (currentContact && (currentContact.name || currentContact.email || currentContact.phone || currentContact.address || currentContact.roof_size_sqm != null || (Array.isArray(currentContact.pdf_quotes) && currentContact.pdf_quotes.length > 0))) {
			contactLines.push('Contact on file:');
			if (currentContact.name) contactLines.push(`- Name: ${currentContact.name}`);
			if (currentContact.email) contactLines.push(`- Email: ${currentContact.email}`);
			if (currentContact.phone) contactLines.push(`- Phone: ${currentContact.phone}`);
			if (currentContact.roof_size_sqm != null) contactLines.push(`- Roof size: ${currentContact.roof_size_sqm} m²`);
			if (currentContact.address) contactLines.push(`- Address: ${currentContact.address}`);
			if (Array.isArray(currentContact.pdf_quotes) && currentContact.pdf_quotes.length > 0) {
				const baseUrl = `${event.url.origin}/api/quote/download`;
				const shortLinks: string[] = [];
				for (const q of currentContact.pdf_quotes) {
					const stored = typeof q === 'object' && q !== null && 'url' in q ? (q as { url: string }).url : String(q);
					const pathMatch = /roof_quotes\/(.+)$/.exec(stored);
					const filePath = pathMatch?.[1] ?? stored.replace(/^roof_quotes\//, '').trim();
					if (!filePath || !/^[a-f0-9-]+\/quote_[^/]+\.pdf$/i.test(filePath)) continue;
					shortLinks.push(`[Download PDF Quote](${baseUrl}?path=${encodeURIComponent(filePath)})`);
				}
				if (shortLinks.length > 0) {
					contactLines.push(`- PDF quotes: ${shortLinks.join(', ')}`);
				}
			}
		}
		// If user message contains an email, search contacts for this widget
		const emailInMessage = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.exec(message);
		if (emailInMessage) {
			const searchEmail = emailInMessage[0].toLowerCase();
			const currentEmail = (currentContact ? getPrimaryEmail(currentContact.email) : null)?.toLowerCase();
			if (currentEmail !== searchEmail) {
				const { data: found } = await supabase
					.from('contacts')
					.select('name, email, phone, address, pdf_quotes')
					.eq('widget_id', widgetId)
					.contains('email', [searchEmail])
					.limit(1)
					.maybeSingle();
				const foundPrimaryEmail = found ? getPrimaryEmail(found.email) : null;
				if (found && (found.name || foundPrimaryEmail || found.phone || found.address || (Array.isArray(found.pdf_quotes) && found.pdf_quotes.length > 0))) {
					contactLines.push(`Contact lookup for ${searchEmail}:`);
					if (found.name) contactLines.push(`- Name: ${found.name}`);
					if (foundPrimaryEmail) contactLines.push(`- Email: ${foundPrimaryEmail}`);
					if (found.phone) contactLines.push(`- Phone: ${found.phone}`);
					if (found.address) contactLines.push(`- Address: ${found.address}`);
					if (Array.isArray(found.pdf_quotes) && found.pdf_quotes.length > 0) {
						const baseUrl = `${event.url.origin}/api/quote/download`;
						const shortLinks: string[] = [];
						for (const q of found.pdf_quotes) {
							const stored = typeof q === 'object' && q !== null && 'url' in q ? (q as { url: string }).url : String(q);
							const pathMatch = /roof_quotes\/(.+)$/.exec(stored);
							const filePath = pathMatch?.[1] ?? stored.replace(/^roof_quotes\//, '').trim();
							if (!filePath || !/^[a-f0-9-]+\/quote_[^/]+\.pdf$/i.test(filePath)) continue;
							shortLinks.push(`[Download PDF Quote](${baseUrl}?path=${encodeURIComponent(filePath)})`);
						}
						if (shortLinks.length > 0)
							contactLines.push(`- PDF quotes: ${shortLinks.join(', ')}`);
					}
				}
			}
		}
		if (contactLines.length > 0) parts.push(contactLines.join('\n'));

		// ── Situational context (only when relevant) ───────────────────────
		if (resumingAfterAgentTimeout) {
			parts.push(
				'The customer was waiting for a human agent who did not respond in time. Briefly apologize for the delay, then answer their question.'
			);
		}
		if (triggerResult?.webhookResult) {
			const isQuote = quoteTriggerIds.has(triggerResult.triggerId.toLowerCase());
			const quoteHasLink = isQuote && triggerResult.webhookResult.includes('[Download Quote]');
			let instruction: string;
			if (quoteHasLink) {
				const emailNote = quoteEmailSent === true ? ' They will also receive it by email.' : '';
				instruction = `A quote was generated.${emailNote} Include this download link in your reply as a clickable markdown link: [Download Quote](url).`;
			} else if (isQuote) {
				instruction = 'The user wants a quote but information is missing. Ask only for what is missing.';
			} else {
				instruction = 'Use this data to answer the customer naturally.';
			}
			parts.push(`${instruction}\n\n${triggerResult.webhookResult}`);
		}

		// Instruct the model to act on the user's last message instead of re-asking or repeating options
		parts.push(
			"Respond directly to the user's latest message. If they have already stated what they want (e.g. a DIY quote, a done-for-you quote, or specific info), proceed with that—do not reintroduce yourself or re-ask the same options."
		);

		const systemPrompt = parts.length > 0 ? parts.join('\n\n') : 'You are a helpful assistant.';

		const modelMessages = llmHistory.map((m) => ({
			role: m.role as 'user' | 'assistant' | 'system',
			content: m.content
		}));

		// Optional: log what we send to the LLM (set CHAT_DEBUG=1 in env to verify role, tone, history)
		if (env.CHAT_DEBUG === '1' || env.CHAT_DEBUG === 'true') {
			const lastUser = [...modelMessages].reverse().find((m) => m.role === 'user');
			console.debug('[chat] LLM input:', {
				systemPromptChars: systemPrompt.length,
				systemPromptPreview: systemPrompt.slice(0, 300) + (systemPrompt.length > 300 ? '...' : ''),
				messageCount: modelMessages.length,
				lastUserMessage: lastUser?.content?.slice(0, 200) ?? null
			});
		}

		const agentContext = agentAutonomy
			? {
					conversationId: conv.id,
					widgetId,
					ownerId: ownerId ?? '',
					contact: contactForPrompt ?? null,
					extractedRoofSize: effectiveRoofSize ?? undefined,
					origin: event.url.origin
				}
			: null;

		async function clearAiTyping() {
			if (!conv) return;
			await adminSupabaseForTyping
				.from('widget_conversations')
				.update({ agent_typing_until: null, agent_typing_by: null })
				.eq('id', conv.id);
		}

		type CheckoutPreview = {
			lineItemsUI: unknown[];
			summary: Record<string, unknown>;
			checkoutUrl: string;
			styleOverrides?: { checkoutButtonColor?: string; qtyBadgeBackgroundColor?: string };
		};
		type GenerateOut = { text: string; lastDiyToolResult?: CheckoutPreview };
		async function runGenerate(provider: string, model: string, key: string): Promise<GenerateOut> {
			const modelInstance = getAISdkModel(provider, model, key);
			const baseOptions = {
				model: modelInstance,
				system: systemPrompt,
				messages: modelMessages,
				maxOutputTokens: 1024
			};
			let result: Awaited<ReturnType<typeof generateText>>;
			if (agentAutonomy && agentContext) {
				const tools = createAgentTools(adminSupabaseForTyping, agentAllowedTools ?? undefined);
				result = await generateText({
					...baseOptions,
					tools,
					stopWhen: stepCountIs(5),
					experimental_context: agentContext
				});
			} else {
				result = await generateText(baseOptions);
			}
			const text = result.text ?? '';
			// Extract checkout preview from DIY tool result if present (fallback when DB link is missing)
			let lastDiyToolResult: GenerateOut['lastDiyToolResult'] | undefined;
			const pickDiy = (tr: Array<{ toolName?: string; output?: unknown; result?: unknown }> | undefined) => {
				if (!Array.isArray(tr)) return;
				// Prefer calculate_bucket_breakdown (now includes checkout), then shopify_create_diy_checkout_link
				const diy =
					tr.find((r) => r.toolName === 'calculate_bucket_breakdown') ??
					tr.find((r) => r.toolName === 'shopify_create_diy_checkout_link');
				if (!diy || typeof diy !== 'object') return;
				const out = (diy as { output?: unknown }).output ?? (diy as { result?: unknown }).result;
				if (!out || typeof out !== 'object') return;
				const r = out as { lineItemsUI?: unknown[]; summary?: Record<string, unknown>; checkoutUrl?: string; styleOverrides?: { checkoutButtonColor?: string; qtyBadgeBackgroundColor?: string } };
				if (
					Array.isArray(r.lineItemsUI) &&
					r.summary != null &&
					typeof r.summary === 'object' &&
					typeof r.checkoutUrl === 'string' &&
					r.checkoutUrl.trim()
				) {
					return {
						lineItemsUI: r.lineItemsUI,
						summary: r.summary,
						checkoutUrl: r.checkoutUrl.trim(),
						styleOverrides: r.styleOverrides
					};
				}
			};
			const raw = result as {
				steps?: Array<{ toolResults?: Array<{ toolName?: string; output?: unknown; result?: unknown }> }>;
				toolResults?: Array<{ toolName?: string; output?: unknown; result?: unknown }>;
			};
			lastDiyToolResult = pickDiy(raw.toolResults);
			if (!lastDiyToolResult && Array.isArray(raw.steps)) {
				for (let i = raw.steps.length - 1; i >= 0; i--) {
					lastDiyToolResult = pickDiy(raw.steps[i].toolResults);
					if (lastDiyToolResult) break;
				}
			}
			return { text, lastDiyToolResult };
		}

		try {
			const { text, lastDiyToolResult } = await runGenerate(llmProvider, llmModel, apiKey);
			await clearAiTyping();
			let checkoutPreview: CheckoutPreview | null = null;
			let insertedMessageId: string | null = null;
			// Persist assistant message
			if (text) {
				const { data: inserted, error: insertErr } = await supabase
					.from('widget_conversation_messages')
					.insert({ conversation_id: conv.id, role: 'assistant', content: text })
					.select('id')
					.single();
				if (insertErr) console.error('Failed to persist assistant message:', insertErr);
				if (inserted?.id) insertedMessageId = inserted.id;
				// Link latest checkout preview to this message and return it so embed shows product breakdown immediately
				if (inserted?.id) {
					const { data: previewRow } = await adminSupabaseForTyping
						.from('widget_checkout_previews')
						.select('id')
						.eq('conversation_id', conv.id)
						.is('message_id', null)
						.order('created_at', { ascending: false })
						.limit(1)
						.maybeSingle();
					if (previewRow?.id) {
						await adminSupabaseForTyping
							.from('widget_checkout_previews')
							.update({ message_id: inserted.id })
							.eq('id', previewRow.id);
						const { data: preview } = await adminSupabaseForTyping
							.from('widget_checkout_previews')
							.select('line_items_ui, summary, checkout_url, style_overrides')
							.eq('message_id', inserted.id)
							.single();
						if (
							preview &&
							typeof preview.checkout_url === 'string' &&
							preview.checkout_url.trim()
						) {
							const raw = Array.isArray(preview.line_items_ui) ? preview.line_items_ui : [];
							const so = preview.style_overrides && typeof preview.style_overrides === 'object' ? (preview.style_overrides as Record<string, unknown>) : {};
							const soObj =
								so.checkout_button_color || so.qty_badge_background_color
									? { checkoutButtonColor: so.checkout_button_color as string, qtyBadgeBackgroundColor: so.qty_badge_background_color as string }
									: undefined;
							checkoutPreview = {
								lineItemsUI: raw.map((it: unknown) => {
									const item = (it != null && typeof it === 'object' && it !== null) ? it as Record<string, unknown> : {};
									return { ...item, imageUrl: (item?.imageUrl ?? item?.image_url ?? null) as string | null };
								}),
								summary: preview.summary != null && typeof preview.summary === 'object' ? preview.summary : {},
								checkoutUrl: preview.checkout_url.trim(),
								...(soObj && { styleOverrides: soObj })
							};
						}
					}
				}
			}
			// Use DIY tool result when DB did not yield a preview (e.g. link not yet committed)
			if (!checkoutPreview && lastDiyToolResult) {
				const raw = lastDiyToolResult.lineItemsUI ?? [];
				checkoutPreview = {
					lineItemsUI: raw.map((it: unknown) => {
						const item = (it != null && typeof it === 'object' && it !== null) ? it as Record<string, unknown> : {};
						return { ...item, imageUrl: (item?.imageUrl ?? item?.image_url ?? null) as string | null };
					}),
					summary: lastDiyToolResult.summary ?? {},
					checkoutUrl: lastDiyToolResult.checkoutUrl,
					styleOverrides: lastDiyToolResult.styleOverrides
				};
			}
			// Enrich missing product images from product_pricing first (one Supabase query), then Shopify/env
			if (checkoutPreview && ownerId && checkoutPreview.lineItemsUI?.length) {
				try {
					let imageBySize = await getProductImageUrlsBySize(ownerId);
					const missing = [15, 10, 5].filter((s) => !imageBySize[s]);
					if (missing.length > 0) {
						const config = await getShopifyConfigForUser(adminSupabaseForTyping, ownerId);
						if (config) {
							const sizeRe = /\b(15|10|5)\s*L\b/i;
							const bucketConfig: Array<{ size: number; price: string; title: string; product_handle?: string | null }> = [];
							for (const it of checkoutPreview.lineItemsUI) {
								const item = (it != null && typeof it === 'object' && it !== null) ? it as Record<string, unknown> : {};
								const hasImage = (item?.imageUrl ?? item?.image_url) && String(item?.imageUrl ?? item?.image_url).trim();
								if (hasImage) continue;
								const title = (item?.title ?? '') as string;
								const m = title.match(sizeRe);
								if (m) {
									const size = Number.parseInt(m[1], 10);
									const price = (item?.unitPrice ?? item?.unit_price ?? '0') as string;
									const product_handle = (item?.product_handle ?? item?.productHandle) as string | null | undefined;
									if (!bucketConfig.some((b) => b.size === size && b.price === price && (b.product_handle ?? '') === (product_handle ?? ''))) bucketConfig.push({ size, price, title, product_handle });
								}
							}
							if (bucketConfig.length > 0) {
								const fromShopify = await getDiyProductImages(config, bucketConfig);
								for (const s of [15, 10, 5] as const) {
									if (!imageBySize[s] && fromShopify[s]) imageBySize = { ...imageBySize, [s]: fromShopify[s] };
								}
							}
						}
						const envImageBySize: Record<15 | 10 | 5, string | undefined> = {
							15: env.DIY_PRODUCT_IMAGE_15L,
							10: env.DIY_PRODUCT_IMAGE_10L,
							5: env.DIY_PRODUCT_IMAGE_5L
						};
						for (const s of [15, 10, 5] as const) {
							const envUrl = envImageBySize[s]?.trim();
							if (!imageBySize[s] && envUrl) imageBySize = { ...imageBySize, [s]: envUrl };
						}
					}
					const sizeFromTitle = (t: string) => {
						const m = (typeof t === 'string' ? t : '').match(/\b(15|10|5)\s*L\b/i);
						return m ? Number.parseInt(m[1], 10) : null;
					};
					checkoutPreview = {
						...checkoutPreview,
						lineItemsUI: checkoutPreview.lineItemsUI.map((it: unknown) => {
							const item = (it != null && typeof it === 'object' && it !== null) ? it as Record<string, unknown> : {};
							let imageUrl = (item?.imageUrl ?? item?.image_url ?? null) as string | null;
							if (!imageUrl || !String(imageUrl).trim()) {
								const size = sizeFromTitle((item?.title ?? '') as string);
								if (size != null && imageBySize[size]) imageUrl = imageBySize[size];
							}
							const url = imageUrl?.trim() || null;
							// Persist both keys so reload and any consumer get the image
							return { ...item, imageUrl: url, image_url: url };
						})
					};
					// Persist enriched line_items_ui (with imageUrl + image_url) so after refresh the embed loads images from DB
					if (insertedMessageId && checkoutPreview.lineItemsUI?.length) {
						const toPersist = checkoutPreview.lineItemsUI.map((it: unknown) => {
							const item = (it != null && typeof it === 'object' ? it : {}) as Record<string, unknown>;
							const url = (item?.imageUrl ?? item?.image_url ?? null) as string | null;
							const u = url?.trim() || null;
							return { ...item, imageUrl: u, image_url: u };
						});
						const { error: updateErr } = await adminSupabaseForTyping
							.from('widget_checkout_previews')
							.update({ line_items_ui: toPersist })
							.eq('message_id', insertedMessageId);
						if (updateErr) console.error('Failed to persist checkout preview images:', updateErr);
					}
				} catch {
					// ignore
				}
			}
			// Use the real Shopify checkout URL (from DIY tool) so the button goes directly to the store
			const checkoutPayload =
				checkoutPreview && insertedMessageId
					? { ...checkoutPreview, checkoutUrl: checkoutPreview.checkoutUrl?.trim() || '' }
					: checkoutPreview;
			// Persist full checkout result on the message row so it survives refresh (no join needed)
			if (insertedMessageId && checkoutPayload && checkoutPayload.lineItemsUI?.length) {
				const { error: msgUpdateErr } = await adminSupabaseForTyping
					.from('widget_conversation_messages')
					.update({
						checkout_preview: {
							checkoutUrl: checkoutPayload.checkoutUrl,
							lineItemsUI: checkoutPayload.lineItemsUI,
							summary: checkoutPayload.summary ?? {},
							...(checkoutPayload.styleOverrides && { styleOverrides: checkoutPayload.styleOverrides })
						}
					})
					.eq('id', insertedMessageId);
				if (msgUpdateErr) console.error('Failed to persist message checkout_preview:', msgUpdateErr);
			}
			// Clear typing again right before response so any poll (e.g. silentSync) sees agent done
			await clearAiTyping();
			return json({
				message: text,
				output: text,
				...(checkoutPayload && { checkoutPreview: checkoutPayload })
			});
		} catch (error_) {
			if (llmFallbackProvider && llmFallbackModel) {
				let fallbackKey: string | null = null;
				if (agentId && effectiveConfig.keyOwnerId) {
					const { data: keyRow } = await admin
						.from('user_llm_keys')
						.select('api_key')
						.eq('user_id', effectiveConfig.keyOwnerId)
						.eq('provider', llmFallbackProvider)
						.single();
					fallbackKey = keyRow?.api_key ?? null;
				} else {
					const { data: keyData } = await supabase.rpc('get_owner_llm_key_for_chat', {
						p_widget_id: widgetId,
						p_provider: llmFallbackProvider
					});
					fallbackKey = keyData ?? null;
				}
				if (fallbackKey) {
					try {
						const { text: fallbackText } = await runGenerate(llmFallbackProvider, llmFallbackModel, fallbackKey);
						await clearAiTyping();
						if (fallbackText) {
							await supabase
								.from('widget_conversation_messages')
								.insert({ conversation_id: conv.id, role: 'assistant', content: fallbackText });
						}
						return json({ message: fallbackText, output: fallbackText });
					} catch {
						// fallthrough to error response
					}
				}
			}
			const reply = (error_ instanceof Error ? error_.message : 'Sorry, I could not respond.') as string;
			await clearAiTyping();
			return json({ error: reply, output: reply }, { status: 500 });
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Chat failed';
		console.error('POST /api/widgets/[id]/chat:', e);
		if (conversationIdForTyping) {
			try {
				await getSupabaseAdmin()
					.from('widget_conversations')
					.update({ agent_typing_until: null, agent_typing_by: null })
					.eq('id', conversationIdForTyping);
			} catch {
				// ignore
			}
		}
		return json({ error: msg }, { status: 500 });
	}
};
