import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/supabase.server';

/**
 * GET /api/widgets/[id]/messages?session_id= – messages for this widget + session (for embed).
 * No auth; used by the chat widget to load history and poll for human agent replies.
 */
export const GET: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	const sessionId = event.url.searchParams.get('session_id');
	if (!widgetId || !sessionId?.trim()) {
		return json({ error: 'Missing widget id or session_id' }, { status: 400 });
	}
	try {
		const supabase = getSupabase();
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
		const rawRows = (rows ?? []) as { id: string; role: string; content: string; created_at: string; avatar_url: string | null }[];
		const messages = rawRows.map((r) => ({
			id: r.id,
			role: r.role === 'human_agent' ? 'bot' : r.role === 'assistant' ? 'bot' : 'user',
			content: r.content,
			createdAt: r.created_at,
			avatarUrl: r.role === 'human_agent' ? r.avatar_url : undefined
		}));
		const now = new Date().toISOString();
		const agentTyping =
			!conv.is_ai_active && conv.agent_typing_until && conv.agent_typing_until > now;
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
