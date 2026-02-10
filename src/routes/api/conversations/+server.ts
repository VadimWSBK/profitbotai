import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { getPrimaryEmail } from '$lib/contact-email-jsonb';

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
			contact_id,
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

	const convIds = (rows ?? []).map((r: { id: string }) => r.id);
	const contactIdsFromConvs = [...new Set(
		(rows ?? [])
			.map((r: { contact_id?: string | null }) => r.contact_id)
			.filter((id): id is string => Boolean(id))
	)];

	// Resolve contact per conversation: prefer contact_id on conversation (supports merged contacts), else fallback to contact where conversation_id = id
	const contactById: Record<string, { id: string; name: string | null; email: string | null }> = {};
	if (contactIdsFromConvs.length > 0) {
		const { data: contactRows } = await supabase
			.from('contacts')
			.select('id, name, email')
			.in('id', contactIdsFromConvs);
		for (const c of contactRows ?? []) {
			contactById[(c as { id: string }).id] = {
				id: (c as { id: string }).id,
				name: (c as { name: string | null }).name ?? null,
				email: getPrimaryEmail((c as { email: unknown }).email) ?? null
			};
		}
	}
	const { data: contactRowsByConv } = await supabase
		.from('contacts')
		.select('id, conversation_id, name, email')
		.in('conversation_id', convIds);
	const contactByConvId: Record<string, { id: string; name: string | null; email: string | null }> = {};
	for (const c of contactRowsByConv ?? []) {
		const convId = (c as { conversation_id: string }).conversation_id;
		contactByConvId[convId] = {
			id: (c as { id: string }).id,
			name: (c as { name: string | null }).name ?? null,
			email: getPrimaryEmail((c as { email: unknown }).email) ?? null
		};
	}

	// Get unread count per conversation (user messages with read_at null)
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

	type ContactInfo = { id: string; name: string | null; email: string | null };
	const conversations = (rows ?? []).map((r: { id: string; contact_id?: string | null; widget_id: string; widgets: { name: string } | { name: string }[]; session_id: string; is_ai_active: boolean; created_at: string; updated_at: string }) => {
		const contact: ContactInfo | undefined =
			(r.contact_id ? contactById[r.contact_id] : undefined) ?? contactByConvId[r.id];
		return {
			id: r.id,
			widgetId: r.widget_id,
			widgetName: Array.isArray(r.widgets) ? (r.widgets[0]?.name ?? '') : (r.widgets as { name: string })?.name ?? '',
			sessionId: r.session_id,
			isAiActive: r.is_ai_active,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
			unreadCount: unreadByConv[r.id] ?? 0,
			contactId: contact?.id ?? null,
			contactName: contact?.name ?? null,
			contactEmail: contact?.email ?? null
		};
	});

	return json({ conversations });
};
