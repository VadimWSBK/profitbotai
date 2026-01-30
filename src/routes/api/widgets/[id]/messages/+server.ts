import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';

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
		const supabase = getSupabaseAdmin();
		const { data: conv, error: convError } = await supabase
			.from('widget_conversations')
			.select('id')
			.eq('widget_id', widgetId)
			.eq('session_id', sessionId.trim())
			.single();
		if (convError || !conv) return json({ messages: [] });
		const { data: rows, error } = await supabase
			.from('widget_conversation_messages')
			.select('id, role, content, created_at')
			.eq('conversation_id', conv.id)
			.order('created_at', { ascending: true });
		if (error) return json({ error: error.message, messages: [] }, { status: 500 });
		const messages = (rows ?? []).map((r: { id: string; role: string; content: string; created_at: string }) => ({
			id: r.id,
			role: r.role === 'human_agent' ? 'bot' : r.role === 'assistant' ? 'bot' : 'user',
			content: r.content,
			createdAt: r.created_at
		}));
		return json({ messages });
	} catch (e) {
		console.error('GET /api/widgets/[id]/messages:', e);
		return json({ messages: [] }, { status: 500 });
	}
};
