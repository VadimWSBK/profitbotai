/**
 * Agent autonomy tools: let the LLM search contacts, create/update/delete contact,
 * generate quote, send email, send chat message. Used when widget has agentAutonomy enabled.
 * Tools can be filtered by agent's allowed_tools.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { getPrimaryEmail, mergeEmailIntoList, emailsToJsonb } from '$lib/contact-email-jsonb';
import { generateQuoteForConversation, type GenerateQuoteForConversationResult } from '$lib/quote-pdf.server';
import { sendQuoteEmail, sendContactEmail } from '$lib/send-quote-email.server';
import { AGENT_TOOL_IDS, type AgentToolId } from '$lib/agent-tools';
import { createDiyCheckoutForOwner, calculateBucketBreakdownForOwner } from '$lib/diy-checkout.server';
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
	/** App origin for building short quote download URLs (avoids InvalidJWT on raw signed URLs). */
	origin?: string;
};

/** Minimal context for tools that only need ownerId (e.g. Chatwoot webhook). conversationId/widgetId may be empty. */
export type AgentToolContextMinimal = Pick<AgentToolContext, 'ownerId' | 'contact' | 'extractedRoofSize' | 'origin'> & {
	conversationId?: string;
	widgetId?: string;
	/** Chatwoot-only: used for generate_quote storage path and to allow the tool in this channel. */
	chatwootAccountId?: number;
	chatwootConversationId?: number;
	agentId?: string;
};

function getContext(ctx: unknown): AgentToolContext | AgentToolContextMinimal | null {
	if (ctx && typeof ctx === 'object' && 'ownerId' in ctx) {
		return ctx as AgentToolContext | AgentToolContextMinimal;
	}
	return null;
}

/** True when context has widget + conversation (e.g. in-app widget). False for Chatwoot/owner-only context. */
function hasWidgetConversation(c: AgentToolContext | AgentToolContextMinimal | null): c is AgentToolContext {
	if (!c || !('conversationId' in c) || !('widgetId' in c)) return false;
	const conv = (c as AgentToolContext).conversationId;
	const wid = (c as AgentToolContext).widgetId;
	return typeof conv === 'string' && conv.length > 0 && typeof wid === 'string' && wid.length > 0;
}

function buildTools(admin: SupabaseClient): Record<string, Tool> {
	const tools: Record<string, Tool> = {};

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
			if (!hasWidgetConversation(c)) return { contacts: [], message: 'Contact search is not available in this channel.' };
			const q = query.trim().toLowerCase();
			if (!q) return { contacts: [], message: 'Provide a search term (name or email).' };
			// Search by name only (email is jsonb array; partial match would need RPC)
			const { data: rows } = await admin
				.from('contacts')
				.select('name, email, phone, address')
				.eq('widget_id', c.widgetId)
				.ilike('name', `%${q}%`)
				.limit(10);
			const contacts = (rows ?? []).map((r) => ({
				name: r.name ?? '',
				email: getPrimaryEmail(r.email) ?? '',
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
			const primaryEmail = getPrimaryEmail(contact?.email);
			const hasDetails =
				contact &&
				(contact.name?.trim() || primaryEmail || contact.phone?.trim() || contact.address?.trim() || contact.roof_size_sqm != null);
			if (!hasDetails) {
				return { contact: null, message: 'No contact details stored yet for this conversation.' };
			}
			return {
				contact: {
					name: contact.name ?? '',
					email: primaryEmail ?? '',
					phone: contact.phone ?? '',
					address: contact.address ?? '',
					roof_size_sqm: contact.roof_size_sqm == null ? null : Number(contact.roof_size_sqm),
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
			if (!hasWidgetConversation(c)) return { error: 'This action is not available in this channel.' };
			const updates: Record<string, string | number | string[]> = {};
			if (name?.trim()) updates.name = name.trim();
			if (email?.trim()) updates.email = emailsToJsonb(email);
			if (phone?.trim()) updates.phone = phone.trim();
			if (address?.trim()) updates.address = address.trim();
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
			if (!hasWidgetConversation(c)) return { error: 'This action is not available in this channel.' };
			const updates: Record<string, string | number | string[]> = {};
			if (name?.trim()) updates.name = name.trim();
			if (phone?.trim()) updates.phone = phone.trim();
			if (address?.trim()) updates.address = address.trim();
			if (roof_size_sqm != null && Number(roof_size_sqm) >= 0) updates.roof_size_sqm = Number(roof_size_sqm);
			if (email?.trim()) {
				const { data: cur } = await admin
					.from('contacts')
					.select('email')
					.eq('conversation_id', c.conversationId)
					.eq('widget_id', c.widgetId)
					.maybeSingle();
				updates.email = mergeEmailIntoList(cur?.email, email.trim().toLowerCase());
			}
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
			if (!hasWidgetConversation(c)) return { error: 'This action is not available in this channel.' };
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
			const minimal = c as AgentToolContextMinimal;
			const isChatwoot =
				!hasWidgetConversation(c) &&
				minimal.chatwootAccountId != null &&
				minimal.chatwootConversationId != null;
			if (!hasWidgetConversation(c) && !isChatwoot) {
				return { error: 'This action is not available in this channel.' };
			}
			const contact = c.contact;
			if (!contact?.name?.trim()) return { error: 'Contact name is required for a quote. Ask the user for their name.' };
			if (!getPrimaryEmail(contact?.email)?.trim()) return { error: 'Contact email is required for a quote. Ask the user for their email.' };
			const roofSize = roof_size_sqm ?? c.extractedRoofSize ?? (c.contact?.roof_size_sqm == null ? undefined : Number(c.contact.roof_size_sqm));
			if (roofSize == null || Number(roofSize) < 0) {
				return { error: 'Roof size (square metres) is required. Ask the user for their roof size or area.' };
			}
			const conversationId = hasWidgetConversation(c)
				? c.conversationId
				: `chatwoot-${minimal.chatwootAccountId}-${minimal.chatwootConversationId}`;
			const widgetId = hasWidgetConversation(c)
				? c.widgetId
				: `chatwoot-${minimal.agentId ?? 'agent'}`;
			const result: GenerateQuoteForConversationResult = await generateQuoteForConversation(
				admin,
				conversationId,
				widgetId,
				contact,
				{ roofSize: Number(roofSize) },
				c.ownerId
			);
			if (result.error) return { error: result.error };
			if (result.storagePath) {
				if (hasWidgetConversation(c)) {
					await admin.rpc('append_pdf_quote_to_contact', {
						p_conversation_id: c.conversationId,
						p_widget_id: c.widgetId,
						p_pdf_url: result.storagePath ?? '',
						p_total: result.total ?? null,
					});
				}
				// Use short link so clicks get a fresh signed URL (raw signed URLs can fail with InvalidJWT)
				const downloadUrl = c.origin
					? `${c.origin}/api/quote/download?path=${encodeURIComponent(result.storagePath)}`
					: result.signedUrl;
				return {
					success: true,
					downloadUrl,
					message: 'Quote generated. Share the download link as [Download PDF Quote](downloadUrl) in your reply.',
				};
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

			let contactId: string | undefined;
			let conversationIdForEmail: string | undefined;
			if (hasWidgetConversation(c)) {
				const { data: contactRow } = await admin
					.from('contacts')
					.select('id')
					.eq('conversation_id', c.conversationId)
					.eq('widget_id', c.widgetId)
					.maybeSingle();
				contactId = contactRow?.id as string | undefined;
				conversationIdForEmail = c.conversationId;
			} else {
				const minimal = c as AgentToolContextMinimal;
				if (minimal.chatwootAccountId != null && minimal.chatwootConversationId != null) {
					const { data: contactRow } = await admin
						.from('contacts')
						.select('id')
						.eq('chatwoot_account_id', minimal.chatwootAccountId)
						.eq('chatwoot_conversation_id', minimal.chatwootConversationId)
						.maybeSingle();
					contactId = contactRow?.id as string | undefined;
					conversationIdForEmail = `chatwoot-${minimal.chatwootAccountId}-${minimal.chatwootConversationId}`;
				}
			}
			if (!contactId) return { error: 'No contact record for this conversation.' };

			if (quote_download_url?.trim()) {
				const quoteResult = await sendQuoteEmail(admin, c.ownerId, {
					toEmail: to,
					quoteDownloadUrl: quote_download_url.trim(),
					customerName: c.contact?.name ?? null,
					customSubject: subject.trim(),
					customBody: body.trim(),
					contactId,
					conversationId: conversationIdForEmail,
				});
				if (quoteResult.sent) return { success: true, message: 'Email with quote link sent.' };
				return { error: quoteResult.error ?? 'Failed to send email' };
			}

			const result = await sendContactEmail(admin, c.ownerId, {
				toEmail: to,
				subject: subject.trim(),
				body: body.trim(),
				contactId,
				conversationId: conversationIdForEmail,
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
			if (!hasWidgetConversation(c)) return { error: 'This action is not available in this channel.' };
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
			if (!hasWidgetConversation(c)) return { stage: null, message: 'This action is not available in this channel.' };
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
			if (!hasWidgetConversation(c)) return { error: 'This action is not available in this channel.' };
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

	tools.calculate_bucket_breakdown = tool({
		description:
			'Calculate DIY bucket breakdown for a roof size. Call this when the customer asks "how much" or "what do I need" for their roof—do NOT calculate in chat. Returns litres needed, bucket counts, total price, AND checkout link automatically. One call gives everything; no need to call shopify_create_diy_checkout_link separately when you have roof_size_sqm.',
		inputSchema: z.object({
			roof_size_sqm: z
				.number()
				.min(1)
				.describe('Roof size in square metres. Required.'),
			discount_percent: z
				.number()
				.int()
				.min(1)
				.max(20)
				.optional()
				.describe('Optional discount: 10, 15, or 20.')
		}),
		execute: async (
			{ roof_size_sqm, discount_percent },
			{ experimental_context }: { experimental_context?: unknown }
		) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };

			const result = await calculateBucketBreakdownForOwner(admin, c.ownerId, {
				roof_size_sqm,
				discount_percent
			});

			if (!result.ok) return { error: result.error ?? 'Failed to calculate breakdown' };

			const { lineItemsUI, summary, litres, roofSizeSqm } = result.data;
			const breakdown = lineItemsUI.map((li) => `${li.quantity}× ${li.title} @ ${li.unitPrice} = ${li.lineTotal}`).join(', ');

			// Automatically create checkout link (same flow as shopify_create_diy_checkout_link)
			const checkoutResult = await createDiyCheckoutForOwner(admin, c.ownerId, {
				roof_size_sqm,
				discount_percent,
				email: getPrimaryEmail(c.contact?.email)?.trim() || undefined
			});

			// Use checkout result summary when available (has discount fields); fallback to bucket breakdown summary
			const summaryWithDiscount = summary as {
				totalItems: number;
				subtotal: string;
				total: string;
				currency: string;
				discountPercent?: number;
				discountAmount?: string;
			};
			const effectiveSummary =
				checkoutResult.ok && checkoutResult.data.summary
					? checkoutResult.data.summary
					: summaryWithDiscount;

			// Build previewMarkdown in the same format as shopify_create_diy_checkout_link
			const totalItems = effectiveSummary.totalItems;
			const hasDiscount =
				effectiveSummary.discountPercent != null && effectiveSummary.discountPercent >= 1;
			const previewParts: string[] = [
				'**Your Checkout Preview**',
				'',
				`**Items** ${totalItems}`,
				...(hasDiscount ? [`**Discount** ${effectiveSummary.discountPercent}% OFF`] : []),
				'**Shipping** FREE',
				'',
				`**Subtotal** ${effectiveSummary.subtotal} ${effectiveSummary.currency}`,
				...(hasDiscount && effectiveSummary.discountAmount
					? [`**Savings** -${effectiveSummary.discountAmount} ${effectiveSummary.currency}`]
					: []),
				`**TOTAL** **${effectiveSummary.total} ${effectiveSummary.currency}**`,
				'',
				'_GST included_'
			];
			const previewMarkdown =
				checkoutResult.ok && checkoutResult.data.checkoutUrl
					? previewParts.concat('', '[GO TO CHECKOUT](' + checkoutResult.data.checkoutUrl + ')').join('\n')
					: previewParts.join('\n');

			const base = {
				success: true,
				roofSizeSqm,
				litres,
				lineItemsUI,
				breakdown,
				summary: {
					totalItems: effectiveSummary.totalItems,
					subtotal: effectiveSummary.subtotal,
					total: effectiveSummary.total,
					currency: effectiveSummary.currency,
					...(effectiveSummary.discountPercent != null && {
						discountPercent: effectiveSummary.discountPercent
					}),
					...(effectiveSummary.discountAmount != null && {
						discountAmount: effectiveSummary.discountAmount
					})
				}
			};

			if (checkoutResult.ok) {
				const { checkoutUrl } = checkoutResult.data;
				return {
					...base,
					checkoutUrl,
					previewMarkdown,
					message: `Breakdown and checkout link ready. In your reply: 1) Give a short intro with the product breakdown and total. 2) Include the full checkout preview block exactly as below (copy it). Use for BOTH discounted and non-discounted quotes:\n\n${previewMarkdown}`
				};
			}
			return { ...base, previewMarkdown, message: `Breakdown ready (no checkout link). Include this preview in your reply:\n\n${previewMarkdown}` };
		}
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

	tools.shopify_create_diy_checkout_link = tool({
		description:
			'Use this when the customer wants a DIY quote or to buy product themselves (supply-only). Creates a one-click checkout (cart link). Kit contents come from the account\'s DIY Kit Builder settings (roof-kit); only the products configured there are included. When describing the quote to the customer, mention ONLY the products that appear in the tool result (the line items breakdown)—do not assume or add sealant, sealer, bonus kit, or other components unless they are in that list. Call with roof_size_sqm when you have their roof size. If the customer asks for a discount, pass discount_percent 10, 15, or 20 (NZ10, NZ15, NZ20).',
		inputSchema: z.object({
			roof_size_sqm: z
				.number()
				.min(1)
				.optional()
				.describe('Roof size in square metres. Drives the kit calculator; products depend on DIY Kit Builder config.'),
			count_15l: z.number().int().min(0).optional().describe('Number of 15L buckets (if not using roof_size_sqm).'),
			count_10l: z.number().int().min(0).optional().describe('Number of 10L buckets (if not using roof_size_sqm).'),
			count_5l: z.number().int().min(0).optional().describe('Number of 5L buckets (if not using roof_size_sqm).'),
			discount_percent: z
				.number()
				.int()
				.min(1)
				.max(20)
				.optional()
				.describe('Discount: 10 (NZ10), 15 (NZ15), or 20 (NZ20). Use same value as when offering the discount.'),
			email: z.string().optional().describe('Customer email for pre-filling checkout (optional).')
		}),
		execute: async (
			{ roof_size_sqm, count_15l, count_10l, count_5l, discount_percent, email },
			{ experimental_context }: { experimental_context?: unknown }
		) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };

			const result = await createDiyCheckoutForOwner(admin, c.ownerId, {
				roof_size_sqm: roof_size_sqm != null && roof_size_sqm >= 1 ? roof_size_sqm : undefined,
				count_15l,
				count_10l,
				count_5l,
				discount_percent,
				email: email?.trim() || getPrimaryEmail(c.contact?.email)?.trim() || undefined
			});

			if (!result.ok) return { error: result.error ?? 'Failed to create checkout link' };

			const { checkoutUrl, lineItemsUI, summary, styleOverrides } = result.data;
			const totalItems = summary.totalItems;
			const hasDiscount = summary.discountPercent != null;
			const previewParts: string[] = [
				'**Your Checkout Preview**',
				'',
				`**Items** ${totalItems}`,
				...(hasDiscount ? [`**Discount** ${summary.discountPercent}% OFF`] : []),
				'**Shipping** FREE',
				'',
				`**Subtotal** ${summary.subtotal} ${summary.currency}`,
				...(hasDiscount && summary.discountAmount ? [`**Savings** -${summary.discountAmount} ${summary.currency}`] : []),
				`**TOTAL** **${summary.total} ${summary.currency}**`,
				'',
				'_GST included_',
				'',
				'[GO TO CHECKOUT](' + checkoutUrl + ')'
			];
			const previewMarkdown = previewParts.filter(Boolean).join('\n');
			const lineItemsText = lineItemsUI.map((li) => `${li.quantity}× ${li.title}`).join(', ');

			const styleOverridesDb =
				styleOverrides && (styleOverrides.checkoutButtonColor || styleOverrides.qtyBadgeBackgroundColor)
					? {
							checkout_button_color: styleOverrides.checkoutButtonColor ?? null,
							qty_badge_background_color: styleOverrides.qtyBadgeBackgroundColor ?? null
						}
					: {};
			// Only persist preview when we have a widget conversation (skip for Chatwoot / owner-only context)
			if (c.conversationId && c.widgetId) {
				const { error: previewErr } = await admin
					.from('widget_checkout_previews')
					.insert({
						conversation_id: c.conversationId,
						widget_id: c.widgetId,
						line_items_ui: lineItemsUI,
						summary,
						checkout_url: checkoutUrl,
						...(Object.keys(styleOverridesDb).length > 0 && { style_overrides: styleOverridesDb })
					});
				if (previewErr) console.error('Failed to save checkout preview:', previewErr);
			}

			return {
				success: true,
				checkoutUrl,
				lineItemsUI,
				styleOverrides: styleOverrides ?? undefined,
				summary: {
					totalItems: summary.totalItems,
					subtotal: summary.subtotal,
					total: summary.total,
					currency: summary.currency,
					...(summary.discountPercent != null && { discountPercent: summary.discountPercent }),
					...(summary.discountAmount != null && { discountAmount: summary.discountAmount })
				},
				discountPercent: summary.discountPercent ?? null,
				subtotal: summary.subtotal,
				discountAmount: summary.discountAmount ?? null,
				total: summary.total,
				lineItems: lineItemsUI.map((li) => `${li.quantity}× ${li.title} (${li.unitPrice} each)`),
				previewMarkdown,
				message: `Checkout link created. In your reply: 1) Give a short intro with the product breakdown and total (e.g. "Here is your DIY quote for [X] m²: ${lineItemsText}. The total cost is $[total] AUD."). 2) Include the full checkout preview block exactly as below—use for BOTH discounted and non-discounted quotes. Copy it exactly:\n\n${previewMarkdown}`
			};
		}
	});

	tools.shopify_create_discount = tool({
		description:
			'When the customer asks for a discount, record which fixed code to use (NZ10, NZ15, NZ20). Call this when you offer 10%, 15%, or 20% off; then when creating the checkout link with shopify_create_diy_checkout_link pass the same discount_percent so the link includes ?discount=CODE. Offer 10% first (NZ10); if they push for more, use 15% (NZ15) or 20% (NZ20).',
		inputSchema: z.object({
			discount_percent: z
				.number()
				.int()
				.refine((v) => v === 10 || v === 15 || v === 20, { message: 'Must be 10, 15, or 20' })
				.describe('Discount: 10 (NZ10), 15 (NZ15), or 20 (NZ20).')
		}),
		execute: async (
			{ discount_percent },
			{ experimental_context }: { experimental_context?: unknown }
		) => {
			const c = getContext(experimental_context);
			if (!c) return { error: 'Missing context' };
			const { FIXED_DISCOUNT_CODE_BY_PERCENT } = await import('$lib/shopify.server');
			const code = FIXED_DISCOUNT_CODE_BY_PERCENT[discount_percent];
			if (!code) return { error: 'Use discount_percent 10, 15, or 20.' };
			return {
				success: true,
				code,
				discountPercent: discount_percent,
				message: `A ${discount_percent}% discount (${code}) will be applied. When you send the checkout link, use calculate_bucket_breakdown (or shopify_create_diy_checkout_link) with discount_percent: ${discount_percent} so the link includes the discount.`
			};
		}
	});

	tools.shopify_create_draft_order = tool({
		description:
			'Create a Shopify draft order and return a checkout link. Use when the customer wants a draft order or checkout link with custom products (not DIY buckets).',
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
): Record<string, Tool> {
	const all = buildTools(admin);
	if (!allowedTools || allowedTools.length === 0) return all;
	const set = new Set(allowedTools as string[]);
	const out: Record<string, Tool> = {};
	for (const id of AGENT_TOOL_IDS) {
		if (set.has(id) && all[id]) out[id] = all[id];
	}
	return out;
}
