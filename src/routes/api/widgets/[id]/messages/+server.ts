import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase, getSupabaseAdmin } from '$lib/supabase.server';
import { getShopifyConfigForUser, getDiyProductImages } from '$lib/shopify.server';

function sizeFromTitle(title: string): number | null {
	const m = (typeof title === 'string' ? title : '').match(/\b(15|10|5)\s*L\b/i);
	return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * GET /api/widgets/[id]/messages?session_id= – messages for this widget + session (for embed).
 * No auth; used by the chat widget to load history and poll for human agent replies.
 * 
 * Priority: widget_conversation_messages (preferred) → n8n_chat_histories (fallback for n8n widgets).
 * This ensures messages are properly scoped per conversation and visible in the Messages dashboard.
 */
export const GET: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	const sessionId = event.url.searchParams.get('session_id');
	if (!widgetId || !sessionId?.trim()) {
		return json({ error: 'Missing widget id or session_id' }, { status: 400 });
	}
	try {
		const supabase = getSupabase();
		
		// Always prefer widget_conversation_messages over n8n_chat_histories
		// Check if conversation exists first
		const { data: conv, error: convError } = await supabase
			.from('widget_conversations')
			.select('id, is_ai_active, agent_typing_until, agent_typing_by')
			.eq('widget_id', widgetId)
			.eq('session_id', sessionId.trim())
			.single();
		
		if (!convError && conv) {
			// Conversation exists - always load from widget_conversation_messages (even if empty)
			const { data: rows } = await supabase.rpc('get_conversation_messages_for_embed', {
				p_conv_id: conv.id
			});
			// Use widget_conversation_messages even if empty (don't fall back to n8n)
			type Row = {
				id: string;
				role: string;
				content: string;
				created_at: string;
				avatar_url: string | null;
				line_items_ui: unknown;
				summary: unknown;
				checkout_url: string | null;
				style_overrides?: unknown;
			};
			const rawRows = (rows ?? []) as Row[];
			// Resolve product images for line items that have none (embed widget)
			let imageBySize: Record<number, string> = {};
			const rowsWithPreview = rawRows.filter(
				(r) => r.line_items_ui != null && r.checkout_url && Array.isArray(r.line_items_ui)
			);
			if (rowsWithPreview.length > 0) {
				try {
					const admin = getSupabaseAdmin();
					const { data: widgetRow } = await admin
						.from('widgets')
						.select('created_by')
						.eq('id', widgetId)
						.single();
					const ownerId = (widgetRow as { created_by?: string } | null)?.created_by ?? null;
					if (ownerId) {
						const config = await getShopifyConfigForUser(admin, ownerId);
						if (config) {
							const sizeRe = /\b(15|10|5)\s*L\b/i;
							const bucketConfig: Array<{ size: number; price: string; title: string }> = [];
							for (const r of rowsWithPreview) {
								const raw = Array.isArray(r.line_items_ui) ? r.line_items_ui : [];
								for (const it of raw) {
									const item = it != null && typeof it === 'object' ? (it as Record<string, unknown>) : {};
									const hasImage =
										(item?.imageUrl ?? item?.image_url) &&
										String(item?.imageUrl ?? item?.image_url).trim();
									if (hasImage) continue;
									const title = (item?.title ?? '') as string;
									const m = title.match(sizeRe);
									if (m) {
										const size = Number.parseInt(m[1], 10);
										const price = (item?.unitPrice ?? item?.unit_price ?? '0') as string;
										if (!bucketConfig.some((b) => b.size === size && b.price === price))
											bucketConfig.push({ size, price, title });
									}
								}
							}
							if (bucketConfig.length > 0) imageBySize = await getDiyProductImages(config, bucketConfig);
						}
					}
				} catch {
					// ignore
				}
			}
			const messages = rawRows.map((r) => {
				const rawLineItems = Array.isArray(r.line_items_ui) ? r.line_items_ui : [];
				const lineItemsUI = rawLineItems.map((it: Record<string, unknown>) => {
					let imageUrl = (it?.imageUrl ?? it?.image_url ?? null) as string | null;
					if (!imageUrl || !String(imageUrl).trim()) {
						const size = sizeFromTitle((it?.title ?? '') as string);
						if (size != null && imageBySize[size]) imageUrl = imageBySize[size];
					}
					return { ...it, imageUrl: imageUrl ?? null };
				});
				const so = r.style_overrides && typeof r.style_overrides === 'object' ? (r.style_overrides as Record<string, unknown>) : {};
				const styleOverrides =
					so.checkout_button_color || so.qty_badge_background_color
						? { checkoutButtonColor: so.checkout_button_color as string, qtyBadgeBackgroundColor: so.qty_badge_background_color as string }
						: undefined;
				return {
					id: r.id,
					role: (r.role === 'human_agent' || r.role === 'assistant') ? 'bot' : 'user',
					content: r.content,
					createdAt: r.created_at,
					avatarUrl: r.role === 'human_agent' ? r.avatar_url : undefined,
					checkoutPreview:
						r.line_items_ui != null && r.checkout_url
							? {
									lineItemsUI,
									summary: r.summary != null && typeof r.summary === 'object' ? r.summary : {},
									checkoutUrl: r.checkout_url,
									...(styleOverrides && { styleOverrides })
								}
							: undefined
				};
			});
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
		}
		
		// Only fallback to n8n_chat_histories if no conversation exists (backward compatibility for old sessions)
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
			if (!n8nErr && n8nRows && n8nRows.length > 0) {
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
		}
		
		// No conversation and no n8n messages - return empty array
		return json({ messages: [], agentTyping: false, agentAvatarUrl: null });
	} catch (e) {
		console.error('GET /api/widgets/[id]/messages:', e);
		return json({ messages: [] }, { status: 500 });
	}
};
