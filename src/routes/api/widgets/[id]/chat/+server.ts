import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/supabase.server';
import { chatWithLlm } from '$lib/chat-llm.server';

const MAX_HISTORY_MESSAGES = 30;

/**
 * POST /api/widgets/[id]/chat – Direct LLM chat (no n8n).
 * Body: { message: string, sessionId?: string }
 * Persists messages to widget_conversations / widget_conversation_messages.
 * If operator took over (is_ai_active = false), does not call LLM and returns a short notice.
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

		// Persist user message
		const { error: userMsgErr } = await supabase
			.from('widget_conversation_messages')
			.insert({ conversation_id: conv.id, role: 'user', content: message });
		if (userMsgErr) return json({ error: 'Failed to save message' }, { status: 500 });

		// If human took over, do not call LLM
		if (!conv.is_ai_active) {
			const notice = 'A team member is helping you. They will reply here shortly.';
			return json({ output: notice, message: notice });
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

		// Load conversation history for context (user, assistant, human_agent -> assistant for LLM)
		const { data: historyRows } = await supabase
			.from('widget_conversation_messages')
			.select('role, content')
			.eq('conversation_id', conv.id)
			.order('created_at', { ascending: true });
		const history = (historyRows ?? []) as { role: string; content: string }[];
		const llmHistory = history
			.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'human_agent')
			.slice(-MAX_HISTORY_MESSAGES)
			.map((m) => ({
				role: (m.role === 'human_agent' ? 'assistant' : m.role) as 'user' | 'assistant',
				content: m.content
			}));

		const bot = (config.bot as Record<string, string> | undefined) ?? {};
		const parts: string[] = [];
		if (bot.role?.trim()) parts.push(bot.role.trim());
		if (bot.tone?.trim()) parts.push(`Tone: ${bot.tone.trim()}`);
		if (bot.instructions?.trim()) parts.push(bot.instructions.trim());
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
