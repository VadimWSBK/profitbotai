import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase, getSupabaseAdmin } from '$lib/supabase.server';
import { chatWithLlm } from '$lib/chat-llm.server';
import { getConversationContextForLlm } from '$lib/conversation-context.server';
import { getTriggerResultIfAny } from '$lib/trigger-webhook.server';
import { extractContactFromMessage } from '$lib/extract-contact.server';
import { generateQuoteForConversation } from '$lib/quote-pdf.server';
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

	try {
		const supabase = getSupabase();
		const { data: widget, error: widgetError } = await supabase
			.from('widgets')
			.select('config, created_by')
			.eq('id', widgetId)
			.single();
		if (widgetError || !widget) return json({ error: 'Widget not found' }, { status: 404 });

		const config = (widget.config as Record<string, unknown>) ?? {};
		const chatBackend = config.chatBackend as string | undefined;
		if (chatBackend !== 'direct') return json({ error: 'Widget is not configured for Direct LLM' }, { status: 400 });

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
			const timeoutMinutes = Math.max(1, Math.min(120, Number((config.agentTakeoverTimeoutMinutes as number) ?? 5)));
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

		const llmProvider = (config.llmProvider as string) ?? '';
		const llmModel = (config.llmModel as string) ?? '';
		const llmFallbackProvider = (config.llmFallbackProvider as string) | undefined;
		const llmFallbackModel = (config.llmFallbackModel as string) | undefined;
		if (!llmProvider) return json({ error: 'No primary LLM selected' }, { status: 400 });

		const ownerId = widget.created_by as string | null;
		if (!ownerId) return json({ error: 'Widget has no owner' }, { status: 400 });

		const { data: apiKey, error: keyError } = await supabase.rpc('get_owner_llm_key_for_chat', {
			p_widget_id: widgetId,
			p_provider: llmProvider
		});
		if (keyError || !apiKey) return json({ error: 'Owner has no API key for this provider' }, { status: 400 });

		// Use stored chat from Supabase as the only source of context (includes the message we just saved)
		const llmHistory = await getConversationContextForLlm(supabase, conv.id, {
			maxMessages: 30,
			maxChars: 24_000
		});

		// Load contact (name, email, pdf_quotes) for context – bot can reference stored info and quote links
		const { data: contact } = await supabase
			.from('contacts')
			.select('name, email, phone, address, pdf_quotes')
			.eq('conversation_id', conv.id)
			.maybeSingle();

		// 1. Extract contact info + roof size first (so we have it for webhook triggers)
		const extractedContact = await extractContactFromMessage(message, {
			llmProvider,
			llmModel,
			apiKey,
			conversationContext: llmHistory
		});

		// Update contact if we extracted name, email, phone, or address from the message
		if (
			extractedContact.name ||
			extractedContact.email ||
			extractedContact.phone ||
			extractedContact.address
		) {
			const updates: Record<string, string> = {};
			if (extractedContact.name) updates.name = extractedContact.name;
			if (extractedContact.email) updates.email = extractedContact.email;
			if (extractedContact.phone) updates.phone = extractedContact.phone;
			if (extractedContact.address) updates.address = extractedContact.address;
			const { error: contactErr } = await supabase
				.from('contacts')
				.update(updates)
				.eq('conversation_id', conv.id)
				.eq('widget_id', widgetId);
			if (contactErr) console.error('contact update from extraction:', contactErr);
		}

		// Merge extracted fields into contact (for system prompt + webhook payload)
		const contactForPrompt = contact
			? {
					...contact,
					...(extractedContact.name && { name: extractedContact.name }),
					...(extractedContact.email && { email: extractedContact.email }),
					...(extractedContact.phone && { phone: extractedContact.phone }),
					...(extractedContact.address && { address: extractedContact.address })
				}
			: null;

		// 2. Run intent classification: built-in quote (no n8n) + optional webhook triggers
		const webhookTriggers = (config.webhookTriggers as WebhookTrigger[] | undefined) ?? [];
		const builtInQuoteTrigger: WebhookTrigger = {
			id: 'quote',
			name: 'Quote',
			description: 'User asks for a roof quote, cost estimate, or price by area (e.g. sqm).',
			webhookUrl: '',
			enabled: true
		};
		const triggersForClassification = [builtInQuoteTrigger, ...webhookTriggers];
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

		// When quote intent matches (built-in, no n8n), generate PDF and attach to contact; inject link for LLM
		const quoteTriggerIds = ['quote', 'roof_quote'];
		if (triggerResult && quoteTriggerIds.includes(triggerResult.triggerId.toLowerCase())) {
			const adminSupabase = getSupabaseAdmin();
			const contact = contactForPrompt ?? { name: null, email: null, phone: null, address: null };
			const extracted = extractedContact.roofSize != null ? { roofSize: extractedContact.roofSize } : null;
			const gen = await generateQuoteForConversation(
				adminSupabase,
				conv.id,
				widgetId,
				contact,
				extracted
			);
			if (gen.signedUrl) {
				const quoteLine = `A quote PDF has been generated and attached to this contact. Share this link with the customer: [Download Quote](${gen.signedUrl}). `;
				triggerResult = {
					...triggerResult,
					webhookResult: quoteLine + (triggerResult.webhookResult || '')
				};
			} else if (gen.error) {
				triggerResult = { ...triggerResult, webhookResult: `(Quote PDF could not be generated: ${gen.error}. ${triggerResult.webhookResult || ''})` };
			}
		}

		const bot = (config.bot as Record<string, string> | undefined) ?? {};
		const parts: string[] = [
			'CRITICAL: Reply only with natural conversational text. Never output technical strings, commands, codes, or syntax (e.g. workflow_start, contacts_query, or similar). Speak like a human to a human. Your entire reply must be readable by the customer with no internal jargon.',
			'Quote generation is triggered automatically when the user asks for a quote; you do not trigger it—just confirm naturally.'
		];
		if (bot.role?.trim()) parts.push(bot.role.trim());
		if (bot.tone?.trim()) parts.push(`Tone: ${bot.tone.trim()}`);
		if (bot.instructions?.trim()) parts.push(bot.instructions.trim());
		// Contact data is ALREADY loaded below — use it directly, never output query syntax
		const contactLines: string[] = [
			'Contact data (already loaded from database): Use the info below when the user asks about their details, quote, or "what do you have on file?". If PDF links are listed, share them as clickable hyperlinks using markdown: [Download Quote](paste-the-url-here). The chat renders [text](url) as clickable links.'
		];
		const currentContact = contactForPrompt;
		if (currentContact && (currentContact.name || currentContact.email || currentContact.phone || currentContact.address || (Array.isArray(currentContact.pdf_quotes) && currentContact.pdf_quotes.length > 0))) {
			contactLines.push('Current conversation contact:');
			if (currentContact.name) contactLines.push(`- Name: ${currentContact.name}`);
			if (currentContact.email) contactLines.push(`- Email: ${currentContact.email}`);
			if (currentContact.phone) contactLines.push(`- Phone: ${currentContact.phone}`);
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
		// If we got data from a webhook trigger (e.g. n8n), tell the model to use it in the reply
		if (triggerResult?.webhookResult) {
			parts.push(
				`The following information was retrieved from an external system (trigger: ${triggerResult.triggerName}). Use it to answer the customer's question accurately and naturally. Do not say "according to our system" unless appropriate.\n\nExternal data:\n${triggerResult.webhookResult}`
			);
		}
		const systemPrompt = parts.length > 0 ? parts.join('\n\n') : 'You are a helpful assistant.';

		const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
			{ role: 'system', content: systemPrompt },
			...llmHistory
		];

		let reply: string;
		try {
			reply = await chatWithLlm(llmProvider, llmModel, apiKey, messages);
		} catch (primaryErr) {
			if (llmFallbackProvider && llmFallbackModel) {
				const { data: fallbackKey } = await supabase.rpc('get_owner_llm_key_for_chat', {
					p_widget_id: widgetId,
					p_provider: llmFallbackProvider
				});
				if (fallbackKey) {
					try {
						reply = await chatWithLlm(llmFallbackProvider, llmFallbackModel, fallbackKey, messages);
					} catch {
						reply = (primaryErr instanceof Error ? primaryErr.message : 'Sorry, I could not respond.') as string;
					}
				} else {
					reply = (primaryErr instanceof Error ? primaryErr.message : 'Sorry, I could not respond.') as string;
				}
			} else {
				reply = (primaryErr instanceof Error ? primaryErr.message : 'Sorry, I could not respond.') as string;
			}
		}

		const { error: insertErr } = await supabase
			.from('widget_conversation_messages')
			.insert({ conversation_id: conv.id, role: 'assistant', content: reply });
		if (insertErr) {
			console.error('Failed to persist assistant message:', insertErr);
			// Still return the reply to the user
		}

		return json({ output: reply, message: reply });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Chat failed';
		console.error('POST /api/widgets/[id]/chat:', e);
		return json({ error: msg }, { status: 500 });
	}
};
