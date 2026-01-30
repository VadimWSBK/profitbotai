import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/conversations?widget_id= – list conversations for widgets the user owns.
 * Optional widget_id to filter. Returns id, widget_id, widget_name, session_id, is_ai_active, updated_at, unread_count.
 */
export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const widgetId = event.url.searchParams.get('widget_id') ?? undefined;

	const supabase = getSupabaseClient(event);
	let query = supabase
		.from('widget_conversations')
		.select(`
			id,
			widget_id,
			session_id,
			is_ai_active,
			created_at,
			updated_at,
			widgets!inner(id, name)
		`)
		.order('updated_at', { ascending: false });

	if (widgetId) query = query.eq('widget_id', widgetId);
	const { data: rows, error } = await query;
	if (error) {
		console.error('GET /api/conversations:', error);
		return json({ error: error.message, conversations: [] }, { status: 500 });
	}

	// Get unread count per conversation (user messages with read_at null)
	const convIds = (rows ?? []).map((r: { id: string }) => r.id);
	const { data: unreadRows } = await supabase
		.from('widget_conversation_messages')
		.select('conversation_id')
		.in('conversation_id', convIds)
		.eq('role', 'user')
		.is('read_at', null);
	const unreadByConv: Record<string, number> = {};
	for (const r of unreadRows ?? []) {
		const cid = (r as { conversation_id: string }).conversation_id;
		unreadByConv[cid] = (unreadByConv[cid] ?? 0) + 1;
	}

	const conversations = (rows ?? []).map((r: { id: string; widget_id: string; widgets: { name: string } | { name: string }[]; session_id: string; is_ai_active: boolean; created_at: string; updated_at: string }) => ({
		id: r.id,
		widgetId: r.widget_id,
		widgetName: Array.isArray(r.widgets) ? (r.widgets[0]?.name ?? '') : (r.widgets as { name: string })?.name ?? '',
		sessionId: r.session_id,
		isAiActive: r.is_ai_active,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		unreadCount: unreadByConv[r.id] ?? 0
	}));

	return json({ conversations });
};
