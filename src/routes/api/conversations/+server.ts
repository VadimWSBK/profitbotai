import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { getPrimaryEmail } from '$lib/contact-email-jsonb';

/** Synthetic id for Chatwoot conversations in the Messages list */
export function chatwootConversationId(accountId: number, conversationId: number): string {
	return `chatwoot-${accountId}-${conversationId}`;
}

export function parseChatwootConversationId(id: string): { accountId: number; conversationId: number } | null {
	const m = id.match(/^chatwoot-(\d+)-(\d+)$/);
	if (!m) return null;
	return { accountId: Number(m[1]), conversationId: Number(m[2]) };
}

/**
 * GET /api/conversations?widget_id= – list conversations for widgets the user owns,
 * plus Chatwoot conversations from contacts with chatwoot_account_id/chatwoot_conversation_id.
 * Returns id, widget_id, widget_name, session_id, is_ai_active, updated_at, unread_count.
 * Chatwoot convs use id like "chatwoot-{accountId}-{conversationId}" and source: "chatwoot".
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
	const widgetConversations = (rows ?? []).map((r: { id: string; contact_id?: string | null; widget_id: string; widgets: { name: string } | { name: string }[]; session_id: string; is_ai_active: boolean; created_at: string; updated_at: string }) => {
		const contact: ContactInfo | undefined =
			(r.contact_id ? contactById[r.contact_id] : undefined) ?? contactByConvId[r.id];
		return {
			id: r.id,
			source: 'widget' as const,
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

	// Chatwoot conversations: from contacts with chatwoot_account_id + chatwoot_conversation_id (RLS via agents.workspace)
	const { data: chatwootContacts } = await supabase
		.from('contacts')
		.select(`
			id,
			name,
			email,
			chatwoot_account_id,
			chatwoot_conversation_id,
			agent_id,
			agents!inner(id, name)
		`)
		.not('chatwoot_account_id', 'is', null)
		.not('chatwoot_conversation_id', 'is', null);
	const chatwootList = (chatwootContacts ?? []) as Array<{
		id: string;
		name: string | null;
		email: unknown;
		chatwoot_account_id: number;
		chatwoot_conversation_id: number;
		agent_id: string | null;
		agents: { name: string } | { name: string }[];
	}>;
	// Dedupe by (account_id, conversation_id) - unique constraint on contacts ensures at most one, but be safe
	const seen = new Set<string>();
	const chatwootDeduped = chatwootList.filter((c) => {
		const key = `${c.chatwoot_account_id}-${c.chatwoot_conversation_id}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	const chatwootKeys = chatwootDeduped.map((c) => `${c.chatwoot_account_id}-${c.chatwoot_conversation_id}`);
	if (chatwootKeys.length === 0) {
		return json({ conversations: widgetConversations });
	}
	const accountIds = [...new Set(chatwootDeduped.map((c) => c.chatwoot_account_id))];
	const convIdsNum = [...new Set(chatwootDeduped.map((c) => c.chatwoot_conversation_id))];
	const { data: latestMsgs } = await supabase
		.from('chatwoot_conversation_messages')
		.select('account_id, conversation_id, created_at')
		.in('account_id', accountIds)
		.in('conversation_id', convIdsNum);
	const latestByKey: Record<string, string> = {};
	for (const m of latestMsgs ?? []) {
		const row = m as { account_id: number; conversation_id: number; created_at: string };
		const key = `${row.account_id}-${row.conversation_id}`;
		const existing = latestByKey[key];
		if (!existing || row.created_at > existing) latestByKey[key] = row.created_at;
	}
	const chatwootConversations = chatwootDeduped.map((c) => {
		const key = `${c.chatwoot_account_id}-${c.chatwoot_conversation_id}`;
		const updatedAt = latestByKey[key] ?? c.id; // fallback for ordering
		const agentName = Array.isArray(c.agents) ? (c.agents[0]?.name ?? 'Chatwoot') : (c.agents as { name: string })?.name ?? 'Chatwoot';
		return {
			id: chatwootConversationId(c.chatwoot_account_id, c.chatwoot_conversation_id),
			source: 'chatwoot' as const,
			widgetId: null,
			widgetName: agentName,
			sessionId: `chatwoot-${c.chatwoot_account_id}-${c.chatwoot_conversation_id}`,
			isAiActive: true,
			createdAt: updatedAt,
			updatedAt,
			unreadCount: 0,
			contactId: c.id,
			contactName: c.name ?? null,
			contactEmail: getPrimaryEmail(c.email) ?? null
		};
	});
	chatwootConversations.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

	const chatwootToInclude = widgetId ? [] : chatwootConversations;
	const allConversations = [...widgetConversations, ...chatwootToInclude].sort(
		(a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
	);
	return json({ conversations: allConversations });
};
