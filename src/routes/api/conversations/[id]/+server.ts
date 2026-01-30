import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

const MESSAGES_PAGE_SIZE = 20;

/**
 * GET /api/conversations/[id] – get one conversation with messages. Marks user messages as read.
 * Query: limit (default 20), before (ISO date – load older messages), since (ISO date – new messages for polling).
 * Returns: conversation, messages (asc order), hasMore (true if more older messages exist).
 */
export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = event.params.id;
	if (!id) return json({ error: 'Missing conversation id' }, { status: 400 });

	const limit = Math.min(Math.max(1, Number.parseInt(event.url.searchParams.get('limit') ?? String(MESSAGES_PAGE_SIZE), 10)), 100);
	const before = event.url.searchParams.get('before')?.trim() || null;
	const since = event.url.searchParams.get('since')?.trim() || null;

	const supabase = getSupabaseClient(event);
	const { data: conv, error: convError } = await supabase
		.from('widget_conversations')
		.select('id, widget_id, session_id, is_ai_active, created_at, updated_at, widgets(id, name)')
		.eq('id', id)
		.single();
	if (convError || !conv) return json({ error: 'Conversation not found' }, { status: 404 });

	// Mark user messages as read
	await supabase
		.from('widget_conversation_messages')
		.update({ read_at: new Date().toISOString() })
		.eq('conversation_id', id)
		.eq('role', 'user')
		.is('read_at', null);

	let messages: { id: string; role: string; content: string; read_at: string | null; created_at: string }[] = [];
	let hasMore = false;

	if (since) {
		// Polling: messages created after this date (order asc)
		const { data: rows, error: msgError } = await supabase
			.from('widget_conversation_messages')
			.select('id, role, content, read_at, created_at')
			.eq('conversation_id', id)
			.gt('created_at', since)
			.order('created_at', { ascending: true });
		if (msgError) return json({ error: msgError.message }, { status: 500 });
		messages = (rows ?? []) as typeof messages;
	} else {
		// Latest page or "load more": order desc, then reverse for asc response
		let query = supabase
			.from('widget_conversation_messages')
			.select('id, role, content, read_at, created_at')
			.eq('conversation_id', id)
			.order('created_at', { ascending: false })
			.limit(limit + 1);
		if (before) query = query.lt('created_at', before);
		const { data: rows, error: msgError } = await query;
		if (msgError) return json({ error: msgError.message }, { status: 500 });
		const raw = (rows ?? []) as typeof messages;
		hasMore = raw.length > limit;
		messages = raw.slice(0, limit).reverse();
	}

	const widget = Array.isArray(conv.widgets) ? conv.widgets[0] : conv.widgets;
	return json({
		conversation: {
			id: conv.id,
			widgetId: conv.widget_id,
			widgetName: (widget as { name: string })?.name ?? '',
			sessionId: conv.session_id,
			isAiActive: conv.is_ai_active,
			createdAt: conv.created_at,
			updatedAt: conv.updated_at
		},
		messages: messages.map((m) => ({
			id: m.id,
			role: m.role,
			content: m.content,
			readAt: m.read_at,
			createdAt: m.created_at
		})),
		hasMore
	});
};

/**
 * PATCH /api/conversations/[id] – set is_ai_active (take over = false, start AI = true).
 * Body: { is_ai_active: boolean }
 */
export const PATCH: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = event.params.id;
	if (!id) return json({ error: 'Missing conversation id' }, { status: 400 });

	let body: { is_ai_active?: boolean };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const isAiActive = typeof body?.is_ai_active === 'boolean' ? body.is_ai_active : undefined;
	if (isAiActive === undefined) return json({ error: 'is_ai_active boolean required' }, { status: 400 });

	const supabase = getSupabaseClient(event);
	const { data, error } = await supabase
		.from('widget_conversations')
		.update({ is_ai_active: isAiActive })
		.eq('id', id)
		.select('id, is_ai_active')
		.single();
	if (error) return json({ error: error.message }, { status: 500 });
	if (!data) return json({ error: 'Conversation not found' }, { status: 404 });

	return json({ conversation: { id: data.id, isAiActive: data.is_ai_active } });
};
