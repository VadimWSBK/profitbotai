import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { streamText, stepCountIs } from 'ai';
import { getSupabase, getSupabaseAdmin } from '$lib/supabase.server';
import { createAgentTools } from '$lib/agent-tools.server';
import { getAISdkModel } from '$lib/ai-sdk-model.server';
import { getConversationContextForLlm } from '$lib/conversation-context.server';
import { getTriggerResultIfAny } from '$lib/trigger-webhook.server';
import { extractContactFromMessage } from '$lib/extract-contact.server';
import { generateQuoteForConversation } from '$lib/quote-pdf.server';
import { getQuoteWorkflowForWidget, runQuoteWorkflow } from '$lib/run-workflow.server';
import type { WebhookTrigger } from '$lib/widget-config';

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
			agentSystemPrompt?: string;
			agentAllowedTools?: string[] | null;
			keyOwnerId: string | null; // user id to resolve LLM key (widget or agent owner)
		};
		let effectiveConfig: EffectiveConfig;

		if (agentId) {
			const { data: agentRow, error: agentErr } = await admin
				.from('agents')
				.select('chat_backend, llm_provider, llm_model, llm_fallback_provider, llm_fallback_model, agent_takeover_timeout_minutes, webhook_triggers, bot_role, bot_tone, bot_instructions, system_prompt, allowed_tools, created_by')
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
				agentAutonomy: Boolean(config.agentAutonomy),
				agentSystemPrompt: (agentRow.system_prompt as string) ?? '',
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
				agentSystemPrompt: undefined,
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
			const updates: Record<string, string | number> = {};
			if (extractedContact.name) updates.name = extractedContact.name;
			if (extractedContact.phone) updates.phone = extractedContact.phone;
			if (extractedContact.address) updates.address = extractedContact.address;
			if (extractedContact.roofSize != null && Number(extractedContact.roofSize) >= 0)
				updates.roof_size_sqm = Number(extractedContact.roofSize);
			if (extractedContact.email) {
				const { data: existing } = await supabase
					.from('contacts')
					.select('id')
					.eq('email', extractedContact.email)
					.neq('conversation_id', conv.id)
					.limit(1)
					.maybeSingle();
				if (!existing) updates.email = extractedContact.email;
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

		// Merge extracted fields into contact (for system prompt + webhook payload)
		const effectiveRoofSize =
			extractedContact.roofSize != null
				? Number(extractedContact.roofSize)
				: contact?.roof_size_sqm != null
					? Number(contact.roof_size_sqm)
					: undefined;
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
							extractedContact.roofSize != null
								? { roofSize: extractedContact.roofSize }
								: null
					})
				: null;

		// Fallback: if classifier missed it but we have all required fields for a quote
		const hasQuoteKeyword = /quote|cost|price|estimate|sqm|m2|m²|square\s*metre[s]?|sq\.?\s*metre[s]?|roof\s*size|area\s*is|square\s*foot/i.test(message);
		const fallbackHasRoofSize = extractedContact.roofSize != null;
		const fallbackHasEmail = !!(contactForPrompt?.email ?? extractedContact.email);
		const fallbackHasName = !!(contactForPrompt?.name ?? extractedContact.name);
		// Multi-turn fallback: assistant recently asked for quote info (name/email/roof) and user is providing it
		const lastAssistantMsg = llmHistory.findLast((t) => t.role === 'assistant')?.content ?? '';
		const assistantAskedForQuote = /quote|name|email|roof|sqm|square\s*metre|cost|estimate|price/i.test(lastAssistantMsg);
		if (!triggerResult && fallbackHasRoofSize && fallbackHasEmail && fallbackHasName) {
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

		if (!triggerResult) {
			console.log('[chat/quote] no trigger matched for message (intent classification returned none)');
		} else {
			console.log('[chat/quote] trigger matched', { triggerId: triggerResult.triggerId, triggerName: triggerResult.triggerName });
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
			(contact?.roof_size_sqm != null && Number(contact.roof_size_sqm) >= 0);

			console.log('[chat/quote] intent=quote', {
				hasName,
				hasEmail,
				hasRoofSize,
				extractedRoofSize: extractedContact.roofSize
			});

			if (hasName && hasEmail && hasRoofSize) {
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
								effectiveRoofSize ?? undefined
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
							...triggerResult,
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
							effectiveRoofSize != null ? { roofSize: effectiveRoofSize } : null,
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
							triggerResult = {
								...triggerResult,
								webhookResult: `Quote generated successfully. You MUST include this exact clickable link in your reply on a single line: [Download Quote](${gen.signedUrl}). Confirm the quote is ready and share the link.`
							};
							console.log('[chat/quote] Generated quote directly (no workflow)');
						} else {
							triggerResult = {
								...triggerResult,
								webhookResult: `Quote could not be generated: ${gen.error ?? 'Unknown error'}. Apologise and offer to have a specialist follow up.`
							};
						}
					} catch (e) {
						console.error('[chat/quote] generateQuoteForConversation threw:', e);
						triggerResult = {
							...triggerResult,
							webhookResult: `Quote generation failed: ${e instanceof Error ? e.message : 'Unknown error'}. Apologise and offer to have a specialist follow up.`
						};
					}
				}
			} else {
				// Missing required info: tell the bot to ask for it (do not run workflow yet)
				const missing: string[] = [];
				if (!hasName) missing.push('name');
				if (!hasEmail) missing.push('email');
				if (!hasRoofSize) missing.push('roof size in square metres');
				console.log('[chat/quote] Workflow not run: missing', missing.join(', '));
				const instruction = `The user wants a quote but we need the following before we can generate it: ${missing.join(', ')}. Politely ask for only the missing information (e.g. "What's your name?", "What's your email?", "What's your roof size in square metres?"). Do not say the quote is being generated or promise a quote until we have name, email, and roof size.`;
				triggerResult = { ...triggerResult, webhookResult: instruction };
			}
		}

		const agentAutonomy = effectiveConfig.agentAutonomy;
		const bot = effectiveConfig.bot;
		const parts: string[] = [
			'CRITICAL: Reply only with natural conversational text. Never output technical strings, commands, codes, or syntax (e.g. workflow_start, contacts_query, or similar). Speak like a human to a human. Your entire reply must be readable by the customer with no internal jargon.',
			'For quotes: we only generate a quote once we have the customer\'s name, email, and roof size (square metres). If the user asks for a quote before we have all three, politely ask for the missing piece(s) only. Do not say the quote is being generated or will arrive by email until we actually have name, email, and roof size.'
		];
		if (agentAutonomy) {
			parts.push(
				'You have access to tools. Use them when appropriate: search_contacts to look up contacts by name or email; get_current_contact to see what we have on file for this chat; generate_quote to create a quote PDF (need name, email, roof size in sqm); send_email to send an email (e.g. with the quote link); shopify_check_orders to look up order status; shopify_create_draft_order to create a draft order and checkout link; shopify_cancel_order to cancel an order; shopify_refund_order to refund an order. Use the tools, then reply naturally to the customer. Do not mention "calling a tool" or technical names—just do the action and respond in plain language.'
			);
		}
		const agentAllowedTools = effectiveConfig.agentAllowedTools ?? null;
		if (effectiveConfig.agentSystemPrompt?.trim()) {
			parts.push(`Agent instructions:\n${effectiveConfig.agentSystemPrompt.trim()}`);
		}
		if (bot.role?.trim()) parts.push(bot.role.trim());
		if (bot.tone?.trim()) parts.push(`Tone: ${bot.tone.trim()}`);
		if (bot.instructions?.trim()) parts.push(bot.instructions.trim());
		// Contact data is ALREADY loaded below — use it directly, never output query syntax
		const contactLines: string[] = [
			'Contact data (already loaded from database): Use the info below when the user asks about their details, quote, or "what do you have on file?". If PDF links are listed, share them as clickable hyperlinks using markdown: [Download Quote](paste-the-url-here). The chat renders [text](url) as clickable links.'
		];
		const currentContact = contactForPrompt;
		if (currentContact && (currentContact.name || currentContact.email || currentContact.phone || currentContact.address || currentContact.roof_size_sqm != null || (Array.isArray(currentContact.pdf_quotes) && currentContact.pdf_quotes.length > 0))) {
			contactLines.push('Current conversation contact:');
			if (currentContact.name) contactLines.push(`- Name: ${currentContact.name}`);
			if (currentContact.email) contactLines.push(`- Email: ${currentContact.email}`);
			if (currentContact.phone) contactLines.push(`- Phone: ${currentContact.phone}`);
			if (currentContact.roof_size_sqm != null) contactLines.push(`- Roof size: ${currentContact.roof_size_sqm} m²`);
			if (currentContact.address) contactLines.push(`- Address: ${currentContact.address}`);
			if (Array.isArray(currentContact.pdf_quotes) && currentContact.pdf_quotes.length > 0) {
				const adminSupabase = getSupabaseAdmin();
				const signedUrls: string[] = [];
				for (const q of currentContact.pdf_quotes) {
					const stored = typeof q === 'object' && q !== null && 'url' in q ? (q as { url: string }).url : String(q);
					const filePath = stored.match(/roof_quotes\/(.+)$/)?.[1] ?? stored.trim();
					if (!filePath) continue;
					const { data } = await adminSupabase.storage.from('roof_quotes').createSignedUrl(filePath, 3600);
					if (data?.signedUrl) signedUrls.push(data.signedUrl);
				}
				if (signedUrls.length > 0) {
					contactLines.push(`- PDF quote links (when user asks for their quote, reply with: [Download Quote](URL) using one of these): ${signedUrls.join(', ')}`);
				}
			}
		} else {
			contactLines.push('Current conversation contact: (none stored yet)');
		}
		// If user message contains an email, search contacts for this widget and include any match
		const emailInMessage = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.exec(message);
		if (emailInMessage) {
			const searchEmail = emailInMessage[0].toLowerCase();
			const currentEmail = currentContact?.email?.toLowerCase();
			if (currentEmail !== searchEmail) {
				const { data: found } = await supabase
					.from('contacts')
					.select('name, email, phone, address, pdf_quotes')
					.eq('widget_id', widgetId)
					.eq('email', searchEmail)
					.limit(1)
					.maybeSingle();
				if (found && (found.name || found.email || found.phone || found.address || (Array.isArray(found.pdf_quotes) && found.pdf_quotes.length > 0))) {
					contactLines.push(`Contact lookup for ${searchEmail}:`);
					if (found.name) contactLines.push(`- Name: ${found.name}`);
					if (found.email) contactLines.push(`- Email: ${found.email}`);
					if (found.phone) contactLines.push(`- Phone: ${found.phone}`);
					if (found.address) contactLines.push(`- Address: ${found.address}`);
					if (Array.isArray(found.pdf_quotes) && found.pdf_quotes.length > 0) {
						const adminSupabase = getSupabaseAdmin();
						const signedUrls: string[] = [];
						for (const q of found.pdf_quotes) {
							const stored = typeof q === 'object' && q !== null && 'url' in q ? (q as { url: string }).url : String(q);
							const filePath = stored.match(/roof_quotes\/(.+)$/)?.[1] ?? stored.trim();
							if (!filePath) continue;
							const { data } = await adminSupabase.storage.from('roof_quotes').createSignedUrl(filePath, 3600);
							if (data?.signedUrl) signedUrls.push(data.signedUrl);
						}
						if (signedUrls.length > 0)
							contactLines.push(`- PDF quote links: ${signedUrls.join(', ')}`);
					}
				}
			}
		}
		parts.push(contactLines.join('\n'));
		// When AI takes over again after live-agent timeout, ask the model to apologize and answer
		if (resumingAfterAgentTimeout) {
			parts.push(
				'The customer was waiting for a human agent who did not respond in time. Start your reply with a brief apology for the delay, then answer their question helpfully.'
			);
		}
		// If we got data from a webhook trigger or built-in quote, tell the model to use it in the reply
		if (triggerResult?.webhookResult) {
			const isQuote = quoteTriggerIds.has(triggerResult.triggerId.toLowerCase());
			const quoteHasLink = isQuote && triggerResult.webhookResult.includes('[Download Quote]');
			const instruction = quoteHasLink
				? `A quote was just generated. In your reply you MUST: (1) Confirm the quote is ready${quoteEmailSent === true ? ', (2) Say they will receive it by email, AND (3)' : ', (2)'} Include the download link from the data below as a clickable markdown link. Copy the link exactly as given: [Download Quote](url) on one line with no newline between the brackets and the URL—so the customer only sees "Download Quote" as a link, not the long URL.`
				: isQuote
					? `The user asked for a quote but we need more information first. Follow the instruction below—ask only for what is missing. Do not say the quote is being generated until we have name, email, and roof size (square metres).`
					: `The following information was retrieved from an external system (trigger: ${triggerResult.triggerName}). Use it to answer the customer's question accurately and naturally. Do not say "according to our system" unless appropriate.`;
			parts.push(`${instruction}\n\nData to use in your reply:\n${triggerResult.webhookResult}`);
		}
		const systemPrompt = parts.length > 0 ? parts.join('\n\n') : 'You are a helpful assistant.';

		const modelMessages = llmHistory.map((m) => ({
			role: m.role as 'user' | 'assistant' | 'system',
			content: m.content
		}));

		const agentContext = agentAutonomy
			? {
					conversationId: conv.id,
					widgetId,
					ownerId: ownerId ?? '',
					contact: contactForPrompt ?? null,
					extractedRoofSize: effectiveRoofSize ?? undefined
				}
			: null;

		async function clearAiTyping() {
			await adminSupabaseForTyping
				.from('widget_conversations')
				.update({ agent_typing_until: null, agent_typing_by: null })
				.eq('id', conv.id);
		}

		async function runStream(provider: string, model: string, key: string) {
			const modelInstance = getAISdkModel(provider, model, key);
			const baseOptions = {
				model: modelInstance,
				system: systemPrompt,
				messages: modelMessages,
				maxOutputTokens: 1024,
				onFinish: async ({ text }: { text: string }) => {
					await clearAiTyping();
					if (text) {
						const { error: insertErr } = await supabase
							.from('widget_conversation_messages')
							.insert({ conversation_id: conv.id, role: 'assistant', content: text });
						if (insertErr) console.error('Failed to persist assistant message:', insertErr);
					}
				}
			};
			if (agentAutonomy && agentContext) {
				const tools = createAgentTools(adminSupabaseForTyping, agentAllowedTools ?? undefined);
				return streamText({
					...baseOptions,
					tools,
					stopWhen: stepCountIs(5),
					experimental_context: agentContext
				});
			}
			return streamText(baseOptions);
		}

		try {
			const result = await runStream(llmProvider, llmModel, apiKey);
			return result.toUIMessageStreamResponse();
		} catch (primaryErr) {
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
						const result = await runStream(llmFallbackProvider, llmFallbackModel, fallbackKey);
						return result.toUIMessageStreamResponse();
					} catch {
						// fallthrough to error response
					}
				}
			}
			const reply = (primaryErr instanceof Error ? primaryErr.message : 'Sorry, I could not respond.') as string;
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
