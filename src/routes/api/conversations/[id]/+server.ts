import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient, getSupabaseAdmin } from '$lib/supabase.server';
import { syncReceivedEmailsForUser } from '$lib/sync-received-emails.server';
import { getPrimaryEmail } from '$lib/contact-email-jsonb';

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
		.select('id, widget_id, session_id, is_ai_active, is_ai_email_active, created_at, updated_at, widgets(id, name, n8n_webhook_url)')
		.eq('id', id)
		.single();
	if (convError || !conv) return json({ error: 'Conversation not found' }, { status: 404 });

	const widget = Array.isArray(conv.widgets) ? conv.widgets[0] : conv.widgets;
	const widgetObj = widget as { id?: string; name?: string; n8n_webhook_url?: string } | null;
	const useN8nHistory =
		widgetObj?.n8n_webhook_url != null && String(widgetObj.n8n_webhook_url).trim() !== '';

	// Get contact for this conversation (for contact-centric display)
	const { data: contactRow } = await supabase
		.from('contacts')
		.select('id, name, email')
		.eq('conversation_id', id)
		.maybeSingle();
	const contact = contactRow
		? {
				id: (contactRow as { id: string }).id,
				name: (contactRow as { name: string | null }).name ?? null,
				email: getPrimaryEmail(contactRow.email) ?? null
			}
		: null;

	// Mark user messages as read (no-op when using n8n; messages live in n8n_chat_histories)
	await supabase
		.from('widget_conversation_messages')
		.update({ read_at: new Date().toISOString() })
		.eq('conversation_id', id)
		.eq('role', 'user')
		.is('read_at', null);

	let chatMessages: { id: string; role: string; content: string; read_at: string | null; created_at: string }[] = [];
	let hasMore = false;

	if (useN8nHistory) {
		// Load chat from n8n Postgres Chat Memory (session_id = conversation.session_id)
		const sessionId = (conv as { session_id: string }).session_id;
		const admin = getSupabaseAdmin();
		const { data: n8nRows, error: n8nErr } = await admin
			.from('n8n_chat_histories')
			.select('id, message')
			.eq('session_id', sessionId)
			.order('id', { ascending: true });
		if (!n8nErr && n8nRows?.length) {
			type N8nMsg = { type?: string; content?: string };
			const baseTime = new Date('2024-01-01T00:00:00.000Z').getTime();
			const mapped = (n8nRows as { id: number; message: N8nMsg }[]).map((r) => {
				const msg = r.message ?? {};
				const role = msg.type === 'human' || msg.type === 'user' ? 'user' : 'assistant';
				const content = typeof msg.content === 'string' ? msg.content : '';
				const created_at = new Date(baseTime + Number(r.id) * 1000).toISOString();
				return { id: String(r.id), role, content, read_at: null as string | null, created_at };
			});
			if (since) {
				chatMessages = mapped.filter((m) => m.created_at > since);
			} else {
				let filtered = mapped;
				if (before) filtered = filtered.filter((m) => m.created_at < before);
				hasMore = filtered.length > limit;
				chatMessages = filtered.slice(-limit); // most recent `limit` in asc order
			}
		}
	} else if (since) {
		const { data: rows, error: msgError } = await supabase
			.from('widget_conversation_messages')
			.select('id, role, content, read_at, created_at')
			.eq('conversation_id', id)
			.gt('created_at', since)
			.order('created_at', { ascending: true });
		if (msgError) return json({ error: msgError.message }, { status: 500 });
		chatMessages = (rows ?? []) as typeof chatMessages;
	} else {
		let query = supabase
			.from('widget_conversation_messages')
			.select('id, role, content, read_at, created_at')
			.eq('conversation_id', id)
			.order('created_at', { ascending: false })
			.limit(limit + 1);
		if (before) query = query.lt('created_at', before);
		const { data: rows, error: msgError } = await query;
		if (msgError) return json({ error: msgError.message }, { status: 500 });
		const raw = (rows ?? []) as typeof chatMessages;
		hasMore = raw.length > limit;
		chatMessages = raw.slice(0, limit).reverse();
	}

	// Fetch contact emails for unified view (both outbound and inbound)
	let emailRows: { id: string; subject: string; body_preview: string | null; created_at: string; status: string; direction: string }[] = [];
	if (contact?.id) {
		let emailQuery = supabase
			.from('contact_emails')
			.select('id, subject, body_preview, created_at, status, direction')
			.eq('contact_id', contact.id);
		if (since) emailQuery = emailQuery.gt('created_at', since);
		else if (before) emailQuery = emailQuery.lt('created_at', before);
		const { data: emails } = await emailQuery.order('created_at', { ascending: !!since }).limit(100);
		emailRows = (emails ?? []) as typeof emailRows;
	}

	const assistantMessageIds = chatMessages.filter((m) => m.role === 'assistant').map((m) => m.id);
	let previewByMessageId: Record<string, { line_items_ui: unknown; summary: unknown; checkout_url: string }> = {};
	if (assistantMessageIds.length > 0) {
		const admin = getSupabaseAdmin();
		const { data: previewRows } = await admin
			.from('widget_checkout_previews')
			.select('message_id, line_items_ui, summary, checkout_url')
			.in('message_id', assistantMessageIds);
		previewByMessageId = (previewRows ?? []).reduce(
			(acc, row) => {
				if (row.message_id) acc[row.message_id] = { line_items_ui: row.line_items_ui, summary: row.summary, checkout_url: row.checkout_url ?? '' };
				return acc;
			},
			{} as Record<string, { line_items_ui: unknown; summary: unknown; checkout_url: string }>
		);
	}

	type UnifiedMessage = {
		id: string;
		role: string;
		content: string;
		readAt: string | null;
		createdAt: string;
		channel: 'chat' | 'email';
		status?: string;
		direction?: 'outbound' | 'inbound';
		checkoutPreview?: { lineItemsUI: unknown[]; summary: Record<string, unknown>; checkoutUrl: string };
	};
	const chatUnified: UnifiedMessage[] = chatMessages.map((m) => {
		const preview = previewByMessageId[m.id];
		return {
			id: m.id,
			role: m.role,
			content: m.content,
			readAt: m.read_at,
			createdAt: m.created_at,
			channel: 'chat' as const,
			...(preview && {
				checkoutPreview: {
					lineItemsUI: Array.isArray(preview.line_items_ui) ? preview.line_items_ui : [],
					summary: preview.summary != null && typeof preview.summary === 'object' ? preview.summary : {},
					checkoutUrl: preview.checkout_url
				}
			})
		};
	});
	const emailUnified: UnifiedMessage[] = emailRows.map((e) => ({
		id: e.id,
		role: e.direction === 'inbound' ? 'user' : 'assistant',
		content: `**${e.subject}**\n\n${e.body_preview ?? ''}`.trim(),
		readAt: null,
		createdAt: e.created_at,
		channel: 'email' as const,
		status: e.status,
		direction: (e.direction === 'inbound' ? 'inbound' : 'outbound') as 'inbound' | 'outbound'
	}));
	const merged = [...chatUnified, ...emailUnified].sort(
		(a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
	);

	// On initial load (no since), sync received emails from Resend so inbound show in Messages
	if (!since) {
		syncReceivedEmailsForUser(supabase, user.id).catch(() => {});
	}

	return json({
		conversation: {
			id: conv.id,
			widgetId: conv.widget_id,
			widgetName: widgetObj?.name ?? '',
			sessionId: conv.session_id,
			isAiActive: conv.is_ai_active,
			isAiEmailActive: (conv as { is_ai_email_active?: boolean }).is_ai_email_active ?? true,
			createdAt: conv.created_at,
			updatedAt: conv.updated_at,
			contactId: contact?.id ?? null,
			contactName: contact?.name ?? null,
			contactEmail: contact?.email ?? null
		},
		messages: merged.map((m) => ({
			id: m.id,
			role: m.role,
			content: m.content,
			readAt: m.readAt,
			createdAt: m.createdAt,
			channel: m.channel,
			...(m.status && { status: m.status }),
			...(m.direction && { direction: m.direction }),
			...(m.channel === 'chat' && (m as UnifiedMessage).checkoutPreview && { checkoutPreview: (m as UnifiedMessage).checkoutPreview })
		})),
		hasMore
	});
};

/**
 * PATCH /api/conversations/[id] – set is_ai_active (STOP AI = false, Start AI = true) and/or is_ai_email_active.
 * Body: { is_ai_active?: boolean, is_ai_email_active?: boolean } (at least one required)
 */
export const PATCH: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = event.params.id;
	if (!id) return json({ error: 'Missing conversation id' }, { status: 400 });

	let body: { is_ai_active?: boolean; is_ai_email_active?: boolean };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const isAiActive = typeof body?.is_ai_active === 'boolean' ? body.is_ai_active : undefined;
	const isAiEmailActive = typeof body?.is_ai_email_active === 'boolean' ? body.is_ai_email_active : undefined;
	if (isAiActive === undefined && isAiEmailActive === undefined) {
		return json({ error: 'At least one of is_ai_active or is_ai_email_active boolean required' }, { status: 400 });
	}

	const supabase = getSupabaseClient(event);
	const updates: { is_ai_active?: boolean; is_ai_email_active?: boolean } = {};
	if (isAiActive !== undefined) updates.is_ai_active = isAiActive;
	if (isAiEmailActive !== undefined) updates.is_ai_email_active = isAiEmailActive;

	const { data, error } = await supabase
		.from('widget_conversations')
		.update(updates)
		.eq('id', id)
		.select('id, is_ai_active, is_ai_email_active')
		.single();
	if (error) return json({ error: error.message }, { status: 500 });
	if (!data) return json({ error: 'Conversation not found' }, { status: 404 });

	const row = data as { id: string; is_ai_active: boolean; is_ai_email_active?: boolean };
	return json({
		conversation: {
			id: row.id,
			isAiActive: row.is_ai_active,
			isAiEmailActive: row.is_ai_email_active ?? true
		}
	});
};
