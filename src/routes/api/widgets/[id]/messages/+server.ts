import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getSupabase, getSupabaseAdmin } from '$lib/supabase.server';
import { getProductImageUrlsBySize } from '$lib/product-pricing.server';
import { getShopifyConfigForUser, getDiyProductImages } from '$lib/shopify.server';
import { getDefaultKitBuilderConfig } from '$lib/diy-kit-builder.server';

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
				checkout_preview?: unknown;
			};
			const rawRows = (rows ?? []) as Row[];
			// Widget owner for image resolution and kit builder display names
			const admin = getSupabaseAdmin();
			const { data: widgetRow } = await admin
				.from('widgets')
				.select('created_by')
				.eq('id', widgetId)
				.single();
			const ownerId = (widgetRow as { created_by?: string } | null)?.created_by ?? null;
			// Resolve product images from product_pricing first (one Supabase query), then Shopify/env
			let imageBySize: Record<number, string> = {};
			// Rows that have preview from join OR from message.checkout_preview (so we fill images for both)
			const rowsWithPreview = rawRows.filter((r) => {
				if (r.checkout_preview != null && typeof r.checkout_preview === 'object') {
					const cp = r.checkout_preview as { lineItemsUI?: unknown };
					if (Array.isArray(cp.lineItemsUI) && cp.lineItemsUI.length > 0) return true;
				}
				return r.line_items_ui != null && r.checkout_url && Array.isArray(r.line_items_ui);
			});
			if (rowsWithPreview.length > 0 && ownerId) {
				try {
					imageBySize = await getProductImageUrlsBySize(ownerId);
					const missing = [15, 10, 5].filter((s) => !imageBySize[s]);
					if (missing.length > 0) {
						const config = await getShopifyConfigForUser(admin, ownerId);
						if (config) {
							const sizeRe = /\b(15|10|5)\s*L\b/i;
							const bucketConfig: Array<{ size: number; price: string; title: string; product_handle?: string | null }> = [];
							for (const r of rowsWithPreview) {
								const fromMsg =
									r.checkout_preview != null && typeof r.checkout_preview === 'object'
										? (r.checkout_preview as { lineItemsUI?: unknown[] }).lineItemsUI
										: null;
								const raw = Array.isArray(fromMsg) ? fromMsg : Array.isArray(r.line_items_ui) ? r.line_items_ui : [];
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
										const product_handle = (item?.product_handle ?? item?.productHandle) as string | null | undefined;
										if (!bucketConfig.some((b) => b.size === size && b.price === price && (b.product_handle ?? '') === (product_handle ?? '')))
											bucketConfig.push({ size, price, title, product_handle });
									}
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
				} catch {
					// ignore
				}
			}
			// Kit builder display names: so reload shows "Name in checkout" instead of product name
			let displayNameByHandle = new Map<string, string>();
			try {
				const kitConfig = ownerId ? await getDefaultKitBuilderConfig(admin, ownerId) : null;
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
			const messages = rawRows.map((r) => {
				// Prefer checkout_preview from message row (survives refresh); else use joined columns
				const fromMsg =
					r.checkout_preview != null && typeof r.checkout_preview === 'object'
						? (r.checkout_preview as { lineItemsUI?: unknown[]; summary?: unknown; checkoutUrl?: string; styleOverrides?: unknown })
						: null;
				const rawLineItems = Array.isArray(fromMsg?.lineItemsUI)
					? fromMsg!.lineItemsUI
					: Array.isArray(r.line_items_ui)
						? r.line_items_ui
						: [];
				const hasPreview =
					(fromMsg?.checkoutUrl && rawLineItems.length > 0) ||
					(r.line_items_ui != null && r.checkout_url && rawLineItems.length > 0);
				const lineItemsUI = rawLineItems.map((it: Record<string, unknown>) => {
					let imageUrl = (it?.imageUrl ?? it?.image_url ?? null) as string | null;
					if (!imageUrl || !String(imageUrl).trim()) {
						const size = sizeFromTitle((it?.title ?? '') as string);
						if (size != null && imageBySize[size]) imageUrl = imageBySize[size];
					}
					const url = imageUrl?.trim() || null;
					let title = (it?.title ?? '') as string;
					const productHandle = (it?.product_handle ?? it?.productHandle) as string | null | undefined;
					if (productHandle && displayNameByHandle.size > 0) {
						const norm = (h: string) => h?.trim().toLowerCase() ?? '';
						const customName = displayNameByHandle.get(norm(productHandle))?.replace(/\s*\d+\s*L\s*$/i, '').trim();
						if (customName) {
							const sizeSuffix = (title.match(/\s*\d+\s*L\s*$/i) ?? [])[0] ?? '';
							title = customName + (sizeSuffix || '');
						}
					}
					return { ...it, title, imageUrl: url, image_url: url };
				});
				const soRaw =
					fromMsg?.styleOverrides != null && typeof fromMsg.styleOverrides === 'object'
						? (fromMsg.styleOverrides as Record<string, unknown>)
						: r.style_overrides != null && typeof r.style_overrides === 'object'
							? (r.style_overrides as Record<string, unknown>)
							: {};
				const styleOverrides =
					soRaw.checkout_button_color ||
					soRaw.checkoutButtonColor ||
					soRaw.qty_badge_background_color ||
					soRaw.qtyBadgeBackgroundColor
						? {
								checkoutButtonColor: (soRaw.checkoutButtonColor ?? soRaw.checkout_button_color) as string,
								qtyBadgeBackgroundColor: (soRaw.qtyBadgeBackgroundColor ?? soRaw.qty_badge_background_color) as string
							}
						: undefined;
				const checkoutUrl =
					typeof fromMsg?.checkoutUrl === 'string' && fromMsg.checkoutUrl.trim()
						? fromMsg.checkoutUrl.trim()
						: (r.checkout_url ?? '').trim();
				const summary =
					fromMsg?.summary != null && typeof fromMsg.summary === 'object'
						? fromMsg.summary
						: r.summary != null && typeof r.summary === 'object'
							? r.summary
							: {};
				return {
					id: r.id,
					role: (r.role === 'human_agent' || r.role === 'assistant') ? 'bot' : 'user',
					content: r.content,
					createdAt: r.created_at,
					avatarUrl: r.role === 'human_agent' ? r.avatar_url : undefined,
					checkoutPreview:
						hasPreview && checkoutUrl
							? {
									lineItemsUI,
									summary,
									checkoutUrl,
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
