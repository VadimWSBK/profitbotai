import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/supabase.server';

/**
 * GET /api/widgets/[id]/messages?session_id= – messages for this widget + session (for embed).
 * No auth; used by the chat widget to load history and poll for human agent replies.
 * When the widget uses n8n, history is loaded from n8n_chat_histories (Postgres Chat Memory).
 */
export const GET: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	const sessionId = event.url.searchParams.get('session_id');
	if (!widgetId || !sessionId?.trim()) {
		return json({ error: 'Missing widget id or session_id' }, { status: 400 });
	}
	try {
		const supabase = getSupabase();
		// Check if widget uses n8n – then load from n8n_chat_histories
		const { data: widget } = await supabase
			.from('widgets')
			.select('n8n_webhook_url')
			.eq('id', widgetId)
			.single();
		const useN8nHistory =
			widget?.n8n_webhook_url != null && String(widget.n8n_webhook_url).trim() !== '';
		if (useN8nHistory) {
			const { data: n8nRows, error: n8nErr } = await supabase
				.from('n8n_chat_histories')
				.select('id, message')
				.eq('session_id', sessionId.trim())
				.order('id', { ascending: true });
			if (n8nErr) {
				console.error('n8n_chat_histories select:', n8nErr);
				return json({ messages: [] });
			}
			type N8nMessage = { type?: string; content?: string };
			const raw = (n8nRows ?? []) as { id: number; message: N8nMessage }[];
			// Filter out system/tool messages - only show user and assistant messages
			const allowedTypes = new Set(['human', 'user', 'assistant', 'ai']);
			const messages = raw
				.filter((r) => {
					const msg = r.message ?? {};
					const msgType = (msg.type ?? '').toLowerCase();
					const content = typeof msg.content === 'string' ? msg.content : '';
					// Exclude system/tool types
					if (!allowedTypes.has(msgType)) return false;
					// Also exclude messages that look like tool calls/results (even if marked as assistant)
					if (
						msgType === 'assistant' ||
						msgType === 'ai' ||
						msgType === 'tool' ||
						msgType === 'system'
					) {
						// Filter out tool call patterns
						if (
							/^Calling\s+\w+\s+with\s+input:/i.test(content) ||
							/^Tool\s+call:/i.test(content) ||
							/^Function\s+call:/i.test(content) ||
							(content.startsWith('{') && content.includes('"id"') && content.includes('"name"'))
						) {
							return false;
						}
					}
					return true;
				})
				.map((r) => {
					const msg = r.message ?? {};
					const type = msg.type === 'human' || msg.type === 'user' ? 'user' : 'bot';
					const content = typeof msg.content === 'string' ? msg.content : '';
					return {
						id: String(r.id),
						role: type as 'user' | 'bot',
						content,
						createdAt: ''
					};
				});
			return json({ messages, agentTyping: false, agentAvatarUrl: null });
		}
		// Direct LLM path: load from widget_conversation_messages
		const { data: conv, error: convError } = await supabase
			.from('widget_conversations')
			.select('id, is_ai_active, agent_typing_until, agent_typing_by')
			.eq('widget_id', widgetId)
			.eq('session_id', sessionId.trim())
			.single();
		if (convError || !conv) return json({ messages: [] });
		const { data: rows, error } = await supabase.rpc('get_conversation_messages_for_embed', {
			p_conv_id: conv.id
		});
		if (error) return json({ error: error.message, messages: [] }, { status: 500 });
		type Row = {
			id: string;
			role: string;
			content: string;
			created_at: string;
			avatar_url: string | null;
			line_items_ui: unknown;
			summary: unknown;
			checkout_url: string | null;
		};
		const rawRows = (rows ?? []) as Row[];
		const messages = rawRows.map((r) => ({
			id: r.id,
			role: r.role === 'human_agent' ? 'bot' : r.role === 'assistant' ? 'bot' : 'user',
			content: r.content,
			createdAt: r.created_at,
			avatarUrl: r.role === 'human_agent' ? r.avatar_url : undefined,
			checkoutPreview:
				r.line_items_ui != null && r.checkout_url
					? {
							lineItemsUI: Array.isArray(r.line_items_ui) ? r.line_items_ui : [],
							summary: r.summary != null && typeof r.summary === 'object' ? r.summary : {},
							checkoutUrl: r.checkout_url
						}
					: undefined
		}));
		const now = new Date().toISOString();
		const agentTyping =
			conv.agent_typing_until &&
			conv.agent_typing_until > now &&
			(conv.agent_typing_by == null ? true : !conv.is_ai_active);
		let agentAvatarUrl: string | null = null;
		if (agentTyping && conv.agent_typing_by) {
			const { data: avatar } = await supabase.rpc('get_agent_avatar', {
				p_user_id: conv.agent_typing_by
			});
			agentAvatarUrl = avatar ?? null;
		}
		return json({ messages, agentTyping: !!agentTyping, agentAvatarUrl });
	} catch (e) {
		console.error('GET /api/widgets/[id]/messages:', e);
		return json({ messages: [] }, { status: 500 });
	}
};
