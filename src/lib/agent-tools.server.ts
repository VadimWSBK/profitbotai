/**
 * Agent autonomy tools: let the LLM search contacts, create/update/delete contact,
 * generate quote, send email, send chat message. Used when widget has agentAutonomy enabled.
 * Tools can be filtered by agent's allowed_tools.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { tool } from 'ai';
import { z } from 'zod';
import { generateQuoteForConversation } from '$lib/quote-pdf.server';
import { sendQuoteEmail, sendContactEmail } from '$lib/send-quote-email.server';
import { AGENT_TOOL_IDS, type AgentToolId } from '$lib/agent-tools';
import {
	cancelOrder,
	createDraftOrder,
	getShopifyConfigForUser,
	listRecentOrders,
	refundOrderFull,
	searchOrders,
	shopifyRequest
} from '$lib/shopify.server';

export type AgentToolContext = {
	conversationId: string;
	widgetId: string;
	ownerId: string;
	contact: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null; roof_size_sqm?: number | null } | null;
	extractedRoofSize?: number;
};

function getContext(ctx: unknown): AgentToolContext | null {
	if (ctx && typeof ctx === 'object' && 'conversationId' in ctx && 'widgetId' in ctx && 'ownerId' in ctx) {
		return ctx as AgentToolContext;
	}
	return null;
}

function buildTools(admin: SupabaseClient): Record<string, ReturnType<typeof tool>> {
	const tools: Record<string, ReturnType<typeof tool>> = {};

	tools.search_contacts = tool({
		description:
			'Search contacts in the database by name or email. Use when the user asks to find a contact, look up someone, or search for contact information. Returns matching contacts (name, email, phone, address) for this widget.',
		inputSchema: z.object({
			query: z.string().describe('Search term: name or email (or part of) to look up'),
		}),
		execute: async (
			{ query },
			{ experimental_context }: { experimental_context?: unknown }
		) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context', contacts: [] };
			const q = query.trim().toLowerCase();
			if (!q) return { contacts: [], message: 'Provide a search term (name or email).' };
			const { data: rows } = await admin
				.from('contacts')
				.select('name, email, phone, address')
				.eq('widget_id', c.widgetId)
				.or(`name.ilike.%${q}%,email.ilike.%${q}%`)
				.limit(10);
			const contacts = (rows ?? []).map((r) => ({
				name: r.name ?? '',
				email: r.email ?? '',
				phone: r.phone ?? '',
				address: r.address ?? '',
			}));
			return { contacts, count: contacts.length };
		},
	});

		tools.get_current_contact = tool({
		description:
			'Get the current conversation contact (the person chatting). Use when the user asks "what do you have on file?", "my details", or to confirm name/email/phone/address/roof size for this chat.',
		inputSchema: z.object({}),
		execute: async (_, { experimental_context }: { experimental_context?: unknown }) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };
			const contact = c.contact;
			if (!contact || (!contact.name && !contact.email && !contact.phone && !contact.address && contact.roof_size_sqm == null)) {
				return { contact: null, message: 'No contact details stored yet for this conversation.' };
			}
			return {
				contact: {
					name: contact.name ?? '',
					email: contact.email ?? '',
					phone: contact.phone ?? '',
					address: contact.address ?? '',
					roof_size_sqm: contact.roof_size_sqm != null ? Number(contact.roof_size_sqm) : null,
				},
			};
		},
	});

	tools.create_contact = tool({
		description:
			'Create or overwrite the contact for the current conversation. Use when the user provides their name, email, phone, address, or roof size (sqm) and you want to store it. One contact per conversation.',
		inputSchema: z.object({
			name: z.string().optional().describe('Full name'),
			email: z.string().optional().describe('Email address'),
			phone: z.string().optional().describe('Phone number'),
			address: z.string().optional().describe('Address'),
			roof_size_sqm: z.number().min(0).optional().describe('Roof or project area in square metres'),
		}),
		execute: async (
			{ name, email, phone, address, roof_size_sqm },
			{ experimental_context }: { experimental_context?: unknown }
		) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };
			const updates: Record<string, string | number> = {};
			if (name != null && name.trim()) updates.name = name.trim();
			if (email != null && email.trim()) updates.email = email.trim().toLowerCase();
			if (phone != null && phone.trim()) updates.phone = phone.trim();
			if (address != null && address.trim()) updates.address = address.trim();
			if (roof_size_sqm != null && Number(roof_size_sqm) >= 0) updates.roof_size_sqm = Number(roof_size_sqm);
			if (Object.keys(updates).length === 0) return { error: 'Provide at least one field (name, email, phone, address, or roof_size_sqm).' };
			const { error: upsertErr } = await admin.from('contacts').upsert(
				{
					conversation_id: c.conversationId,
					widget_id: c.widgetId,
					...updates,
				},
				{ onConflict: 'conversation_id', ignoreDuplicates: false }
			);
			if (upsertErr) return { error: upsertErr.message };
			return { success: true, message: 'Contact saved.' };
		},
	});

	tools.update_contact = tool({
		description:
			'Update the current conversation contact. Use when the user wants to change their stored name, email, phone, address, or roof size (sqm). Only provided fields are updated.',
		inputSchema: z.object({
			name: z.string().optional().describe('Full name'),
			email: z.string().optional().describe('Email address'),
			phone: z.string().optional().describe('Phone number'),
			address: z.string().optional().describe('Address'),
			roof_size_sqm: z.number().min(0).optional().describe('Roof or project area in square metres'),
		}),
		execute: async (
			{ name, email, phone, address, roof_size_sqm },
			{ experimental_context }: { experimental_context?: unknown }
		) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };
			const updates: Record<string, string | number> = {};
			if (name != null && name.trim()) updates.name = name.trim();
			if (email != null && email.trim()) updates.email = email.trim().toLowerCase();
			if (phone != null && phone.trim()) updates.phone = phone.trim();
			if (address != null && address.trim()) updates.address = address.trim();
			if (roof_size_sqm != null && Number(roof_size_sqm) >= 0) updates.roof_size_sqm = Number(roof_size_sqm);
			if (Object.keys(updates).length === 0) return { error: 'Provide at least one field to update.' };
			const { error } = await admin
				.from('contacts')
				.update(updates)
				.eq('conversation_id', c.conversationId)
				.eq('widget_id', c.widgetId);
			if (error) return { error: error.message };
			return { success: true, message: 'Contact updated.' };
		},
	});

	tools.delete_contact = tool({
		description:
			'Delete the contact record for the current conversation. Use only when the user explicitly asks to remove their stored details. The conversation continues but contact info is cleared.',
		inputSchema: z.object({}),
		execute: async (_, { experimental_context }: { experimental_context?: unknown }) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };
			const { error } = await admin
				.from('contacts')
				.delete()
				.eq('conversation_id', c.conversationId)
				.eq('widget_id', c.widgetId);
			if (error) return { error: error.message };
			return { success: true, message: 'Contact removed.' };
		},
	});

	tools.generate_quote = tool({
		description:
			'Generate a Done For You quote PDF (we coat the roof for the customer—professional installation). Use ONLY when the customer wants us to do the work, not DIY. Requires name, email, roof size (sqm). Do NOT use for DIY—for DIY, calculate litres, buckets, and price in chat only.',
		inputSchema: z.object({
			roof_size_sqm: z
				.number()
				.optional()
				.describe('Roof size in square metres; omit to use value already provided in conversation'),
		}),
		execute: async (
			{ roof_size_sqm },
			{ experimental_context }: { experimental_context?: unknown }
		) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };
			const contact = c.contact;
			if (!contact?.name?.trim()) return { error: 'Contact name is required for a quote. Ask the user for their name.' };
			if (!contact?.email?.trim()) return { error: 'Contact email is required for a quote. Ask the user for their email.' };
			const roofSize = roof_size_sqm ?? c.extractedRoofSize ?? (c.contact?.roof_size_sqm != null ? Number(c.contact.roof_size_sqm) : undefined);
			if (roofSize == null || Number(roofSize) < 0) {
				return { error: 'Roof size (square metres) is required. Ask the user for their roof size or area.' };
			}
			const result = await generateQuoteForConversation(
				admin,
				c.conversationId,
				c.widgetId,
				contact,
				{ roofSize: Number(roofSize) },
				c.ownerId
			);
			if (result.error) return { error: result.error };
			if (result.signedUrl) {
				await admin.rpc('append_pdf_quote_to_contact', {
					p_conversation_id: c.conversationId,
					p_widget_id: c.widgetId,
					p_pdf_url: result.storagePath ?? '',
					p_total: result.total ?? null,
				});
				return { success: true, downloadUrl: result.signedUrl, message: 'Quote generated. Share the download link with the customer.' };
			}
			return { error: 'Quote generation did not return a URL.' };
		},
	});

	tools.send_email = tool({
		description:
			'Send an email to a contact. Use to send the quote link, a follow-up, or any email. Requires recipient email, subject, and body. If you have a quote download URL from generate_quote, you can include it in the body as a link.',
		inputSchema: z.object({
			to_email: z.string().describe('Recipient email address'),
			subject: z.string().describe('Email subject'),
			body: z.string().describe('Email body (plain text). You can include a link like: Download your quote: [URL]'),
			quote_download_url: z.string().optional().describe('Optional: quote PDF download URL to include in the email'),
		}),
		execute: async (
			{ to_email, subject, body, quote_download_url },
			{ experimental_context }: { experimental_context?: unknown }
		) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };
			const to = to_email?.trim().toLowerCase();
			if (!to) return { error: 'Recipient email is required.' };
			if (!subject?.trim()) return { error: 'Subject is required.' };
			if (!body?.trim()) return { error: 'Body is required.' };

			const { data: contactRow } = await admin
				.from('contacts')
				.select('id')
				.eq('conversation_id', c.conversationId)
				.eq('widget_id', c.widgetId)
				.maybeSingle();
			const contactId = contactRow?.id as string | undefined;
			if (!contactId) return { error: 'No contact record for this conversation.' };

			if (quote_download_url?.trim()) {
				const quoteResult = await sendQuoteEmail(admin, c.ownerId, {
					toEmail: to,
					quoteDownloadUrl: quote_download_url.trim(),
					customerName: c.contact?.name ?? null,
					customSubject: subject.trim(),
					customBody: body.trim(),
					contactId,
					conversationId: c.conversationId,
				});
				if (quoteResult.sent) return { success: true, message: 'Email with quote link sent.' };
				return { error: quoteResult.error ?? 'Failed to send email' };
			}

			const result = await sendContactEmail(admin, c.ownerId, {
				toEmail: to,
				subject: subject.trim(),
				body: body.trim(),
				contactId,
				conversationId: c.conversationId,
				customerName: c.contact?.name ?? null,
			});
			if (result.sent) return { success: true, message: 'Email sent.' };
			return { error: result.error ?? 'Failed to send email' };
		},
	});

	tools.send_message = tool({
		description:
			'Post a message to the chat as the assistant. Use when you want to send a specific message to the user in the conversation (e.g. a confirmation, link, or notice) before or as part of your reply.',
		inputSchema: z.object({
			content: z.string().describe('The message text to post in the chat (plain text or markdown)'),
		}),
		execute: async (
			{ content },
			{ experimental_context }: { experimental_context?: unknown }
		) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };
			const text = content?.trim();
			if (!text) return { error: 'Message content is required.' };
			const { error } = await admin.from('widget_conversation_messages').insert({
				conversation_id: c.conversationId,
				role: 'assistant',
				content: text,
			});
			if (error) return { error: error.message };
			return { success: true, message: 'Message posted.' };
		},
	});

	tools.get_leadflow_stages = tool({
		description:
			'List the leadflow pipeline stages for this widget owner. Use when you need to know which stages exist (e.g. "New lead", "Quote sent", "Won") so you can move a contact to the right stage. Returns stage id, name, and order.',
		inputSchema: z.object({}),
		execute: async (_, { experimental_context }: { experimental_context?: unknown }) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };
			const { data: rows } = await admin
				.from('lead_stages')
				.select('id, name, sort_order')
				.eq('created_by', c.ownerId)
				.order('sort_order', { ascending: true });
			const stages = (rows ?? []).map((r) => ({ id: r.id, name: r.name ?? '', sortOrder: r.sort_order ?? 0 }));
			return { stages, count: stages.length };
		},
	});

	tools.get_contact_lead_stage = tool({
		description:
			'Get the current leadflow stage of the conversation contact. Use when the user asks where they are in the pipeline or before moving them to another stage. Returns stage id and name, or "not in pipeline" if they have no lead.',
		inputSchema: z.object({}),
		execute: async (_, { experimental_context }: { experimental_context?: unknown }) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };
			const { data: contactRow } = await admin
				.from('contacts')
				.select('id')
				.eq('conversation_id', c.conversationId)
				.eq('widget_id', c.widgetId)
				.maybeSingle();
			if (!contactRow?.id) return { stage: null, message: 'No contact for this conversation.' };
			const { data: leadRow } = await admin
				.from('leads')
				.select('stage_id')
				.eq('contact_id', contactRow.id)
				.maybeSingle();
			if (!leadRow?.stage_id) return { stage: null, message: 'Contact is not in the pipeline yet.' };
			const { data: stageRow } = await admin
				.from('lead_stages')
				.select('id, name')
				.eq('id', leadRow.stage_id)
				.maybeSingle();
			return { stage: stageRow ? { id: stageRow.id, name: stageRow.name ?? '' } : { id: leadRow.stage_id, name: '' } };
		},
	});

	tools.move_contact_to_stage = tool({
		description:
			'Move the current conversation contact to a leadflow stage. Use after sending a quote (move to "Quote sent"), when they become a customer (move to "Won"), or to adjust their pipeline position. Provide either stage_id (from get_leadflow_stages) or stage_name (e.g. "Quote sent", "Won"). If the contact is not in the pipeline yet, they are added to the given stage.',
		inputSchema: z.object({
			stage_id: z.string().optional().describe('Stage UUID from get_leadflow_stages'),
			stage_name: z.string().optional().describe('Stage name, e.g. "Quote sent", "Won", "New lead" (case-insensitive match)'),
		}),
		execute: async (
			{ stage_id, stage_name },
			{ experimental_context }: { experimental_context?: unknown }
		) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };
			let targetStageId: string | null = null;
			if (stage_id?.trim()) {
				const { data: stageRow } = await admin
					.from('lead_stages')
					.select('id')
					.eq('id', stage_id.trim())
					.eq('created_by', c.ownerId)
					.maybeSingle();
				if (stageRow?.id) targetStageId = stageRow.id;
			}
			if (!targetStageId && stage_name?.trim()) {
				const { data: stageRow } = await admin
					.from('lead_stages')
					.select('id')
					.eq('created_by', c.ownerId)
					.ilike('name', stage_name.trim())
					.limit(1)
					.maybeSingle();
				if (stageRow?.id) targetStageId = stageRow.id;
			}
			if (!targetStageId) return { error: 'Provide a valid stage_id (from get_leadflow_stages) or stage_name (e.g. "Quote sent").' };
			const { data: contactRow } = await admin
				.from('contacts')
				.select('id')
				.eq('conversation_id', c.conversationId)
				.eq('widget_id', c.widgetId)
				.maybeSingle();
			if (!contactRow?.id) return { error: 'No contact for this conversation.' };
			const { error: upsertErr } = await admin.from('leads').upsert(
				{ contact_id: contactRow.id, stage_id: targetStageId },
				{ onConflict: 'contact_id', ignoreDuplicates: false }
			);
			if (upsertErr) return { error: upsertErr.message };
			return { success: true, message: 'Contact moved to stage.' };
		},
	});

	tools.shopify_check_orders = tool({
		description:
			'Check Shopify orders and status. Use to look up an order by order number, ID, or customer email, or list recent orders when no query is provided.',
		inputSchema: z.object({
			query: z
				.string()
				.optional()
				.describe('Order number (e.g. #1001), customer email, or search term. Leave empty to list recent orders.'),
			order_id: z
				.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().int().positive().optional())
				.describe('Shopify order ID (numeric) if known.'),
			limit: z.number().int().min(1).max(20).optional().describe('Max orders to return (default 5).')
		}),
		execute: async (
			{ query, order_id, limit },
			{ experimental_context }: { experimental_context?: unknown }
		) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };
			const config = await getShopifyConfigForUser(admin, c.ownerId);
			if (!config) return { error: 'Shopify is not connected for this account.' };

			const max = typeof limit === 'number' ? limit : 5;
			if (order_id) {
				const res = await shopifyRequest<{ order?: Record<string, unknown> }>(config, `orders/${order_id}.json`, {
					query: {
						fields:
							'id,name,email,created_at,financial_status,fulfillment_status,cancelled_at,cancel_reason,total_price,currency,order_status_url'
					}
				});
				if (!res.ok) return { error: res.error ?? 'Failed to fetch order' };
				const order = res.data?.order ?? null;
				return { orders: order ? [order] : [], count: order ? 1 : 0 };
			}

			const q = (query ?? '').trim();
			if (!q) {
				const recent = await listRecentOrders(config, max);
				if (recent.error) return { error: recent.error };
				return { orders: recent.orders ?? [], count: recent.orders?.length ?? 0 };
			}

			let searchQuery = q;
			if (q.includes('@')) {
				searchQuery = `email:${q}`;
			} else if (/^#?\d+/.test(q)) {
				const orderName = q.startsWith('#') ? q : `#${q}`;
				searchQuery = `name:${orderName}`;
			}
			const result = await searchOrders(config, searchQuery, max);
			if (result.error) return { error: result.error };
			return { orders: result.orders ?? [], count: result.orders?.length ?? 0 };
		}
	});

	tools.shopify_create_draft_order = tool({
		description:
			'Create a Shopify draft order and return a checkout link. Use when the customer wants a draft order or checkout link.',
		inputSchema: z.object({
			email: z.string().optional().describe('Customer email (optional).'),
			line_items: z
				.array(
					z.object({
						title: z.string().optional().describe('Line item title if no variant_id.'),
						variant_id: z.number().int().optional().describe('Variant ID if using existing product variant.'),
						quantity: z.number().int().min(1).describe('Quantity'),
						price: z.string().optional().describe('Price per item (e.g. "29.99") if no variant_id.')
					})
				)
				.min(1)
				.describe('Line items for the draft order.'),
			note: z.string().optional().describe('Optional internal note'),
			tags: z.string().optional().describe('Optional tags (comma-separated)'),
			currency: z.string().optional().describe('Optional currency code, e.g. USD')
		}),
		execute: async (
			{ email, line_items, note, tags, currency },
			{ experimental_context }: { experimental_context?: unknown }
		) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };
			const config = await getShopifyConfigForUser(admin, c.ownerId);
			if (!config) return { error: 'Shopify is not connected for this account.' };
			const result = await createDraftOrder(config, {
				email: email?.trim() || undefined,
				line_items,
				note: note?.trim() || undefined,
				tags: tags?.trim() || undefined,
				currency: currency?.trim() || undefined
			});
			if (!result.ok) return { error: result.error ?? 'Failed to create draft order' };
			return {
				success: true,
				draftOrderId: result.draftOrderId,
				checkoutUrl: result.checkoutUrl,
				message: result.checkoutUrl
					? 'Draft order created. Share the checkout link with the customer.'
					: 'Draft order created.'
			};
		}
	});

	tools.shopify_cancel_order = tool({
		description: 'Cancel a Shopify order by ID. Use when the customer requests cancellation.',
		inputSchema: z.object({
			order_id: z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().int().positive()),
			reason: z.string().optional().describe('Reason (e.g. customer, inventory, fraud, other).'),
			notify: z.boolean().optional().describe('Whether to notify the customer (default false).'),
			restock: z.boolean().optional().describe('Whether to restock items (default false).')
		}),
		execute: async (
			{ order_id, reason, notify, restock },
			{ experimental_context }: { experimental_context?: unknown }
		) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };
			const config = await getShopifyConfigForUser(admin, c.ownerId);
			if (!config) return { error: 'Shopify is not connected for this account.' };
			const result = await cancelOrder(config, Number(order_id), {
				reason: reason?.trim() || undefined,
				notify: notify ?? false,
				restock: restock ?? false
			});
			if (!result.ok) return { error: result.error ?? 'Failed to cancel order' };
			return { success: true, message: 'Order cancelled.' };
		}
	});

	tools.shopify_refund_order = tool({
		description: 'Refund a Shopify order in full by ID. Use when the customer requests a refund.',
		inputSchema: z.object({
			order_id: z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().int().positive()),
			notify: z.boolean().optional().describe('Whether to notify the customer (default false).'),
			note: z.string().optional().describe('Optional refund note')
		}),
		execute: async (
			{ order_id, notify, note },
			{ experimental_context }: { experimental_context?: unknown }
		) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };
			const config = await getShopifyConfigForUser(admin, c.ownerId);
			if (!config) return { error: 'Shopify is not connected for this account.' };
			const result = await refundOrderFull(config, Number(order_id), {
				notify: notify ?? false,
				note: note?.trim() || undefined
			});
			if (!result.ok) return { error: result.error ?? 'Failed to refund order' };
			return { success: true, message: 'Order refunded.' };
		}
	});

	return tools;
}

/**
 * Create agent tools. If allowedTools is provided, only those tools are returned; otherwise all.
 * Pass AgentToolContext via experimental_context in streamText.
 */
export function createAgentTools(
	admin: SupabaseClient,
	allowedTools?: AgentToolId[] | string[] | null
): Record<string, ReturnType<typeof tool>> {
	const all = buildTools(admin);
	if (!allowedTools || allowedTools.length === 0) return all;
	const set = new Set(allowedTools as string[]);
	const out: Record<string, ReturnType<typeof tool>> = {};
	for (const id of AGENT_TOOL_IDS) {
		if (set.has(id) && all[id]) out[id] = all[id];
	}
	return out;
}
