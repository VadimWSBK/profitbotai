import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getSupabaseClient, getSupabaseAdmin } from '$lib/supabase.server';
import { syncReceivedEmailsForUser } from '$lib/sync-received-emails.server';
import { getPrimaryEmail } from '$lib/contact-email-jsonb';
import { getProductImageUrlsBySize } from '$lib/product-pricing.server';
import { getShopifyConfigForUser, getDiyProductImages } from '$lib/shopify.server';
import { getDefaultKitBuilderConfig } from '$lib/diy-kit-builder.server';

const MESSAGES_PAGE_SIZE = 20;

function sizeFromTitle(title: string): number | null {
	const m = (typeof title === 'string' ? title : '').match(/\b(15|10|5)\s*L\b/i);
	return m ? Number.parseInt(m[1], 10) : null;
}

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
		.select('id, widget_id, session_id, is_ai_active, is_ai_email_active, created_at, updated_at, widgets(id, name, n8n_webhook_url, created_by)')
		.eq('id', id)
		.single();
	if (convError || !conv) return json({ error: 'Conversation not found' }, { status: 404 });

	const widget = Array.isArray(conv.widgets) ? conv.widgets[0] : conv.widgets;
	const widgetObj = widget as { id?: string; name?: string; n8n_webhook_url?: string } | null;

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

	// Mark user messages as read
	await supabase
		.from('widget_conversation_messages')
		.update({ read_at: new Date().toISOString() })
		.eq('conversation_id', id)
		.eq('role', 'user')
		.is('read_at', null);

	// Always load from widget_conversation_messages (preferred over n8n_chat_histories). Include checkout_preview so Messages menu shows same data as embed.
	type ChatMessageRow = {
		id: string;
		role: string;
		content: string;
		read_at: string | null;
		created_at: string;
		checkout_preview?: unknown;
	};
	let chatMessages: ChatMessageRow[] = [];
	let hasMore = false;

	if (since) {
		const { data: rows, error: msgError } = await supabase
			.from('widget_conversation_messages')
			.select('id, role, content, read_at, created_at, checkout_preview')
			.eq('conversation_id', id)
			.gt('created_at', since)
			.order('created_at', { ascending: true });
		if (msgError) return json({ error: msgError.message }, { status: 500 });
		chatMessages = (rows ?? []) as ChatMessageRow[];
	} else {
		let query = supabase
			.from('widget_conversation_messages')
			.select('id, role, content, read_at, created_at, checkout_preview')
			.eq('conversation_id', id)
			.order('created_at', { ascending: false })
			.limit(limit + 1);
		if (before) query = query.lt('created_at', before);
		const { data: rows, error: msgError } = await query;
		if (msgError) return json({ error: msgError.message }, { status: 500 });
		const raw = (rows ?? []) as ChatMessageRow[];
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
	let previewByMessageId: Record<string, { line_items_ui: unknown; summary: unknown; checkout_url: string; style_overrides?: unknown }> = {};
	if (assistantMessageIds.length > 0) {
		const admin = getSupabaseAdmin();
		const { data: previewRows } = await admin
			.from('widget_checkout_previews')
			.select('message_id, line_items_ui, summary, checkout_url, style_overrides')
			.in('message_id', assistantMessageIds);
		previewByMessageId = (previewRows ?? []).reduce(
			(acc, row) => {
				if (row.message_id)
					acc[row.message_id] = {
						line_items_ui: row.line_items_ui,
						summary: row.summary,
						checkout_url: row.checkout_url ?? '',
						style_overrides: row.style_overrides
					};
				return acc;
			},
			{} as Record<string, { line_items_ui: unknown; summary: unknown; checkout_url: string; style_overrides?: unknown }>
		);
		// Fallback: use an unlinked preview for this conversation so sessions where the link step failed (or message came from n8n) still show checkout + button
		const hasCheckoutContent = (c: string) => {
			const s = (c ?? '').toLowerCase();
			return s.includes('checkout preview') || s.includes('diy quote') || /\d+\s*x\s*.+?\s*(?:15|10|5)\s*l/.test(s);
		};
		const assistantWithoutPreview = chatMessages
			.filter((m) => m.role === 'assistant' && !previewByMessageId[m.id] && hasCheckoutContent(m.content))
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
		if (assistantWithoutPreview) {
			const { data: unlinked } = await admin
				.from('widget_checkout_previews')
				.select('line_items_ui, summary, checkout_url, style_overrides')
				.eq('conversation_id', id)
				.is('message_id', null)
				.order('created_at', { ascending: false })
				.limit(1)
				.maybeSingle();
			if (unlinked && typeof unlinked.checkout_url === 'string' && unlinked.checkout_url.trim()) {
				previewByMessageId[assistantWithoutPreview.id] = {
					line_items_ui: unlinked.line_items_ui,
					summary: unlinked.summary,
					checkout_url: unlinked.checkout_url.trim(),
					style_overrides: unlinked.style_overrides
				};
			}
		}
	}

	// Effective preview per message: prefer message.checkout_preview (survives refresh), else joined widget_checkout_previews
	type EffectivePreview = {
		lineItemsUI: unknown[];
		summary: Record<string, unknown>;
		checkoutUrl: string;
		styleOverrides?: { checkoutButtonColor?: string; qtyBadgeBackgroundColor?: string };
	};
	const effectivePreviewByMessageId: Record<string, EffectivePreview> = {};
	const allLineItemsForImages: Array<Record<string, unknown>> = [];
	for (const m of chatMessages) {
		if (m.role !== 'assistant') continue;
		const fromMsg =
			m.checkout_preview != null && typeof m.checkout_preview === 'object'
				? (m.checkout_preview as { lineItemsUI?: unknown[]; summary?: unknown; checkoutUrl?: string; styleOverrides?: unknown })
				: null;
		const fromTable = previewByMessageId[m.id];
		const rawLineItems = Array.isArray(fromMsg?.lineItemsUI)
			? fromMsg!.lineItemsUI
			: Array.isArray(fromTable?.line_items_ui)
				? fromTable!.line_items_ui
				: [];
		const checkoutUrl =
			(typeof fromMsg?.checkoutUrl === 'string' && fromMsg.checkoutUrl.trim()) || (typeof fromTable?.checkout_url === 'string' && fromTable?.checkout_url.trim()) || '';
		if (rawLineItems.length > 0 && checkoutUrl) {
			const soRaw =
				fromMsg?.styleOverrides != null && typeof fromMsg.styleOverrides === 'object'
					? (fromMsg.styleOverrides as Record<string, unknown>)
					: fromTable?.style_overrides != null && typeof fromTable.style_overrides === 'object'
						? (fromTable.style_overrides as Record<string, unknown>)
						: {};
			const styleOverrides =
				soRaw.checkout_button_color || soRaw.checkoutButtonColor || soRaw.qty_badge_background_color || soRaw.qtyBadgeBackgroundColor
					? {
							checkoutButtonColor: (soRaw.checkoutButtonColor ?? soRaw.checkout_button_color) as string,
							qtyBadgeBackgroundColor: (soRaw.qtyBadgeBackgroundColor ?? soRaw.qty_badge_background_color) as string
						}
					: undefined;
			const summary =
				(fromMsg?.summary != null && typeof fromMsg.summary === 'object' ? fromMsg.summary : fromTable?.summary) != null &&
				typeof (fromMsg?.summary ?? fromTable?.summary) === 'object'
					? (fromMsg?.summary ?? fromTable?.summary) as Record<string, unknown>
					: {};
			effectivePreviewByMessageId[m.id] = {
				lineItemsUI: rawLineItems,
				summary,
				checkoutUrl: checkoutUrl.trim(),
				...(styleOverrides && { styleOverrides })
			};
			for (const it of rawLineItems) {
				if (it != null && typeof it === 'object') allLineItemsForImages.push(it as Record<string, unknown>);
			}
		}
	}

	let imageBySize: Record<number, string> = {};
	let displayNameByHandle = new Map<string, string>();
	const ownerId = (widgetObj as { created_by?: string } | null)?.created_by ?? null;
	if (ownerId && (Object.keys(effectivePreviewByMessageId).length > 0 || allLineItemsForImages.length > 0)) {
		try {
			imageBySize = await getProductImageUrlsBySize(ownerId);
			const admin = getSupabaseAdmin();
			const missing = [15, 10, 5].filter((s) => !imageBySize[s]);
			if (missing.length > 0 && allLineItemsForImages.length > 0) {
				const config = await getShopifyConfigForUser(admin, ownerId);
				if (config) {
					const sizeRe = /\b(15|10|5)\s*L\b/i;
					const bucketConfig: Array<{ size: number; price: string; title: string; product_handle?: string | null }> = [];
					for (const item of allLineItemsForImages) {
						const hasImage = (item?.imageUrl ?? item?.image_url) && String(item?.imageUrl ?? item?.image_url).trim();
						if (hasImage) continue;
						const title = (item?.title ?? '') as string;
						const match = title.match(sizeRe);
						if (match) {
							const size = Number.parseInt(match[1], 10);
							const price = (item?.unitPrice ?? item?.unit_price ?? '0') as string;
							const product_handle = (item?.product_handle ?? item?.productHandle) as string | null | undefined;
							if (!bucketConfig.some((b) => b.size === size && b.price === price && (b.product_handle ?? '') === (product_handle ?? '')))
								bucketConfig.push({ size, price, title, product_handle });
						}
					}
					if (bucketConfig.length > 0) {
						const fromShopify = await getDiyProductImages(config, bucketConfig);
						for (const s of [15, 10, 5] as const) {
							if (!imageBySize[s] && fromShopify[s]) imageBySize = { ...imageBySize, [s]: fromShopify[s] };
						}
					}
				}
				const envImageBySize: Record<15 | 10 | 5, string | undefined> = {
					15: env.DIY_PRODUCT_IMAGE_15L,
					10: env.DIY_PRODUCT_IMAGE_10L,
					5: env.DIY_PRODUCT_IMAGE_5L
				};
				for (const s of [15, 10, 5] as const) {
					const envUrl = envImageBySize[s]?.trim();
					if (!imageBySize[s] && envUrl) imageBySize = { ...imageBySize, [s]: envUrl };
				}
			}
			const kitConfig = await getDefaultKitBuilderConfig(admin, ownerId);
			if (kitConfig?.product_entries?.length) {
				const norm = (h: string) => h?.trim().toLowerCase() ?? '';
				for (const e of kitConfig.product_entries) {
					const h = e.product_handle?.trim();
					const d = e.display_name?.trim();
					if (h && d && !displayNameByHandle.has(norm(h))) displayNameByHandle.set(norm(h), d);
				}
			}
		} catch {
			// ignore
		}
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
		checkoutPreview?: {
			lineItemsUI: unknown[];
			summary: Record<string, unknown>;
			checkoutUrl: string;
			styleOverrides?: { checkoutButtonColor?: string; qtyBadgeBackgroundColor?: string };
		};
	};
	const chatUnified: UnifiedMessage[] = chatMessages.map((m) => {
		const preview = effectivePreviewByMessageId[m.id];
		if (!preview) {
			return {
				id: m.id,
				role: m.role,
				content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
				readAt: m.read_at,
				createdAt: m.created_at,
				channel: 'chat' as const
			};
		}
		const rawLineItems = Array.isArray(preview.lineItemsUI) ? preview.lineItemsUI : [];
		const lineItemsUI = rawLineItems.map((it: unknown) => {
			const item = it != null && typeof it === 'object' ? (it as Record<string, unknown>) : {};
			let imageUrl = (item?.imageUrl ?? item?.image_url ?? null) as string | null;
			if (!imageUrl || !String(imageUrl).trim()) {
				const size = sizeFromTitle((item?.title ?? '') as string);
				if (size != null && imageBySize[size]) imageUrl = imageBySize[size];
			}
			const url = imageUrl?.trim() || null;
			let title = (item?.title ?? '') as string;
			const productHandle = (item?.product_handle ?? item?.productHandle) as string | null | undefined;
			if (productHandle && displayNameByHandle.size > 0) {
				const norm = (h: string) => h?.trim().toLowerCase() ?? '';
				const customName = displayNameByHandle.get(norm(productHandle))?.replace(/\s*\d+\s*L\s*$/i, '').trim();
				if (customName) {
					const sizeSuffix = (title.match(/\s*\d+\s*L\s*$/i) ?? [])[0] ?? '';
					title = customName + (sizeSuffix || '');
				}
			}
			return { ...item, title, imageUrl: url, image_url: url };
		});
		return {
			id: m.id,
			role: m.role,
			content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
			readAt: m.read_at,
			createdAt: m.created_at,
			channel: 'chat' as const,
			checkoutPreview: {
				lineItemsUI,
				summary: preview.summary,
				checkoutUrl: (preview.checkoutUrl && String(preview.checkoutUrl).trim()) || '',
				...(preview.styleOverrides && { styleOverrides: preview.styleOverrides })
			}
		};
	});
	const emailUnified: UnifiedMessage[] = emailRows.map((e) => {
		const subject = typeof e.subject === 'string' ? e.subject : String(e.subject ?? '');
		const body = typeof e.body_preview === 'string' ? e.body_preview : '';
		return {
			id: e.id,
			role: e.direction === 'inbound' ? 'user' : 'assistant',
			content: `**${subject}**\n\n${body}`.trim(),
			readAt: null,
			createdAt: e.created_at,
			channel: 'email' as const,
			status: e.status,
			direction: (e.direction === 'inbound' ? 'inbound' : 'outbound') as 'inbound' | 'outbound'
		};
	});
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
