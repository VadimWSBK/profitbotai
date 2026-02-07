import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { createClient } from '@supabase/supabase-js';
import { sendContactEmail } from '$lib/send-quote-email.server';
import { getPrimaryEmail, parseEmailsFromDb, emailsToJsonb } from '$lib/contact-email-jsonb';
import {
	computeQuoteFromSettings,
	generatePdfFromDocDefinition,
	type QuoteSettings
} from '$lib/quote-pdf.server';
import { randomUUID } from 'node:crypto';
import {
	getShopifyConfigForUser,
	listRecentOrders,
	searchOrders,
	getOrder,
	listCustomers,
	getCustomer,
	listOrdersForCustomer,
	cancelOrder,
	refundOrderFull,
	getShopifyStatistics,
	listProductsWithImages
} from '$lib/shopify.server';
import { createDiyCheckoutForOwner } from '$lib/diy-checkout.server';
import { getProductPricingForOwner } from '$lib/product-pricing.server';

interface AuthInfo {
	workspaceId: string;
	userId: string;
	apiKeyId: string;
}

async function validateApiKey(apiKey: string): Promise<AuthInfo | null> {
	const supabaseUrl = env.SUPABASE_URL;
	const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

	if (!supabaseUrl || !serviceRoleKey) {
		return null;
	}

	const admin = createClient(supabaseUrl, serviceRoleKey);
	const { data, error } = await admin.rpc('validate_mcp_api_key', {
		p_api_key: apiKey,
	});

	if (error || !data || data.length === 0) {
		return null;
	}

	const authData = data[0] as { workspace_id: string; user_id: string; api_key_id: string };
	return {
		workspaceId: authData.workspace_id,
		userId: authData.user_id,
		apiKeyId: authData.api_key_id,
	};
}

/**
 * POST /api/mcp/tools – List available MCP tools
 * Header: X-MCP-API-Key: pb_mcp_...
 */
export const POST: RequestHandler = async (event) => {
	const apiKey = event.request.headers.get('X-MCP-API-Key');
	if (!apiKey) {
		return json({ error: 'Missing X-MCP-API-Key header' }, { status: 401 });
	}

	const authInfo = await validateApiKey(apiKey);
	if (!authInfo) {
		return json({ error: 'Invalid API key' }, { status: 401 });
	}

	const body = await event.request.json().catch(() => ({}));
	const { action, ...params } = body;

	// Allow conversationId and widgetId to be passed via headers (for n8n workflows)
	// This allows the workflow to inject these from the trigger without the AI needing to pass them
	const headerConversationId = event.request.headers.get('X-Conversation-Id') || event.request.headers.get('x-conversation-id');
	const headerWidgetId = event.request.headers.get('X-Widget-Id') || event.request.headers.get('x-widget-id');
	
	// Debug logging (remove in production if needed)
	if (headerConversationId || headerWidgetId) {
		console.log('[MCP API] Headers received:', { headerConversationId, headerWidgetId, action, hasParamsConversationId: !!params.conversationId, hasParamsWidgetId: !!params.widgetId });
	}
	
	// Merge header values into params if not already present
	const enrichedParams = {
		...params,
		...(headerConversationId && !params.conversationId ? { conversationId: headerConversationId } : {}),
		...(headerWidgetId && !params.widgetId ? { widgetId: headerWidgetId } : {})
	};

	const supabaseUrl = env.SUPABASE_URL!;
	const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY!;
	const supabase = createClient(supabaseUrl, serviceRoleKey);

	try {
		switch (action) {
			case 'list_widgets': {
				const { data, error } = await supabase
					.from('widgets')
					.select('*')
					.eq('workspace_id', authInfo.workspaceId)
					.order('updated_at', { ascending: false });
				if (error) throw new Error(error.message);
				return json({ success: true, data: { widgets: data ?? [], count: (data ?? []).length } });
			}

			case 'get_widget': {
				const { widgetId } = params;
				if (!widgetId) return json({ error: 'widgetId required' }, { status: 400 });
				const { data, error } = await supabase
					.from('widgets')
					.select('*')
					.eq('id', widgetId)
					.eq('workspace_id', authInfo.workspaceId)
					.single();
				if (error) {
					if (error.code === 'PGRST116') return json({ error: 'Widget not found' }, { status: 404 });
					throw new Error(error.message);
				}
				return json({ success: true, data: { widget: data } });
			}

			case 'list_leads': {
				const { widgetId } = params;
				let query = supabase
					.from('leads')
					.select(
						`
						id,
						contact_id,
						stage_id,
						created_at,
						updated_at,
						contacts!inner(
							id,
							widget_id,
							name,
							email,
							phone,
							widgets!inner(workspace_id)
						),
						lead_stages!inner(id, name, sort_order)
					`
					)
					.eq('contacts.widgets.workspace_id', authInfo.workspaceId);
				if (widgetId) {
					query = query.eq('contacts.widget_id', widgetId);
				}
				const { data, error } = await query.order('updated_at', { ascending: false });
				if (error) throw new Error(error.message);
				return json({ success: true, data: { leads: data ?? [], count: (data ?? []).length } });
			}

			case 'get_lead': {
				const { leadId } = params;
				if (!leadId) return json({ error: 'leadId required' }, { status: 400 });
				const { data, error } = await supabase
					.from('leads')
					.select(
						`
						id,
						contact_id,
						stage_id,
						created_at,
						updated_at,
						contacts!inner(
							id,
							widget_id,
							name,
							email,
							phone,
							widgets!inner(workspace_id)
						),
						lead_stages!inner(id, name, sort_order)
					`
					)
					.eq('id', leadId)
					.eq('contacts.widgets.workspace_id', authInfo.workspaceId)
					.single();
				if (error) {
					if (error.code === 'PGRST116') return json({ error: 'Lead not found' }, { status: 404 });
					throw new Error(error.message);
				}
				return json({ success: true, data: { lead: data } });
			}

			case 'move_lead': {
				const { leadId, stageId } = params;
				if (!leadId || !stageId) return json({ error: 'leadId and stageId required' }, { status: 400 });

				// Verify stage belongs to user
				const { data: stage } = await supabase
					.from('lead_stages')
					.select('id')
					.eq('id', stageId)
					.eq('created_by', authInfo.userId)
					.single();
				if (!stage) return json({ error: 'Stage not found or access denied' }, { status: 404 });

				const { data, error } = await (supabase.from('leads') as any)
					.update({ stage_id: stageId })
					.eq('id', leadId)
					.select()
					.single();
				if (error) {
					if (error.code === 'PGRST116') return json({ error: 'Lead not found' }, { status: 404 });
					throw new Error(error.message);
				}
				return json({ success: true, data: { lead: data, message: 'Lead moved successfully' } });
			}

			case 'list_lead_stages': {
				const { data, error } = await supabase
					.from('lead_stages')
					.select('*')
					.eq('created_by', authInfo.userId)
					.order('sort_order', { ascending: true });
				if (error) throw new Error(error.message);
				return json({ success: true, data: { stages: data ?? [], count: (data ?? []).length } });
			}

			case 'create_lead_stage': {
				const { name, sortOrder } = params;
				if (!name) return json({ error: 'name required' }, { status: 400 });
				const { data, error } = await (supabase.from('lead_stages') as any)
					.insert({
						name: name.trim(),
						sort_order: sortOrder ?? 999,
						created_by: authInfo.userId,
					})
					.select()
					.single();
				if (error) throw new Error(error.message);
				return json({ success: true, data: { stage: data } });
			}

			case 'update_lead_stage': {
				const { stageId, name, sortOrder } = params;
				if (!stageId) return json({ error: 'stageId required' }, { status: 400 });
				const updates: Record<string, unknown> = {};
				if (name) updates.name = name;
				if (sortOrder !== undefined) updates.sort_order = sortOrder;
				const { data, error } = await (supabase.from('lead_stages') as any)
					.update(updates)
					.eq('id', stageId)
					.eq('created_by', authInfo.userId)
					.select()
					.single();
				if (error) {
					if (error.code === 'PGRST116') return json({ error: 'Stage not found' }, { status: 404 });
					throw new Error(error.message);
				}
				return json({ success: true, data: { stage: data } });
			}

			case 'delete_lead_stage': {
				const { stageId } = params;
				if (!stageId) return json({ error: 'stageId required' }, { status: 400 });

				// Get first other stage to reassign leads
				const { data: otherStages } = await supabase
					.from('lead_stages')
					.select('id')
					.eq('created_by', authInfo.userId)
					.neq('id', stageId)
					.order('sort_order', { ascending: true })
					.limit(1);

				const fallbackStageId = otherStages?.[0]?.id;
				if (fallbackStageId) {
					await supabase.from('leads').update({ stage_id: fallbackStageId }).eq('stage_id', stageId);
				} else {
					await supabase.from('leads').delete().eq('stage_id', stageId);
				}

				const { error } = await supabase
					.from('lead_stages')
					.delete()
					.eq('id', stageId)
					.eq('created_by', authInfo.userId);
				if (error) throw new Error(error.message);
				return json({ success: true, data: { message: 'Stage deleted' } });
			}

			case 'list_conversations': {
				const { widgetId } = params;
				let query = supabase
					.from('widget_conversations')
					.select(
						`
						id,
						widget_id,
						session_id,
						is_ai_active,
						created_at,
						updated_at,
						widgets!inner(workspace_id)
					`
					)
					.eq('widgets.workspace_id', authInfo.workspaceId);
				if (widgetId) {
					query = query.eq('widget_id', widgetId);
				}
				const { data, error } = await query.order('updated_at', { ascending: false });
				if (error) throw new Error(error.message);
				return json({ success: true, data: { conversations: data ?? [], count: (data ?? []).length } });
			}

			case 'get_conversation': {
				const { conversationId } = params;
				if (!conversationId) return json({ error: 'conversationId required' }, { status: 400 });
				const { data, error } = await supabase
					.from('widget_conversations')
					.select(
						`
						id,
						widget_id,
						session_id,
						is_ai_active,
						created_at,
						updated_at,
						widgets!inner(workspace_id)
					`
					)
					.eq('id', conversationId)
					.eq('widgets.workspace_id', authInfo.workspaceId)
					.single();
				if (error) {
					if (error.code === 'PGRST116') return json({ error: 'Conversation not found' }, { status: 404 });
					throw new Error(error.message);
				}
				return json({ success: true, data: { conversation: data } });
			}

			case 'send_message': {
				const { conversationId, content } = params;
				if (!conversationId || !content) {
					return json({ error: 'conversationId and content required' }, { status: 400 });
				}

				// Verify conversation belongs to workspace
				const { data: conv } = await supabase
					.from('widget_conversations')
					.select('id, widgets!inner(workspace_id)')
					.eq('id', conversationId)
					.eq('widgets.workspace_id', authInfo.workspaceId)
					.single();
				if (!conv) return json({ error: 'Conversation not found or access denied' }, { status: 404 });

				const { data, error } = await (supabase.from('widget_conversation_messages') as any)
					.insert({
						conversation_id: conversationId,
						role: 'human_agent',
						content: content.trim(),
						created_by: authInfo.userId,
					})
					.select('id, role, content, created_at')
					.single();
				if (error) throw new Error(error.message);

				// Update conversation updated_at
				await supabase
					.from('widget_conversations')
					.update({ updated_at: new Date().toISOString() })
					.eq('id', conversationId);

				return json({ success: true, data: { message: data } });
			}

			case 'get_conversation_messages': {
				const { conversationId, limit = 50 } = params;
				if (!conversationId) return json({ error: 'conversationId required' }, { status: 400 });

				// Verify conversation belongs to workspace
				const { data: conv } = await supabase
					.from('widget_conversations')
					.select('id, widgets!inner(workspace_id)')
					.eq('id', conversationId)
					.eq('widgets.workspace_id', authInfo.workspaceId)
					.single();
				if (!conv) return json({ error: 'Conversation not found or access denied' }, { status: 404 });

				const { data, error } = await supabase
					.from('widget_conversation_messages')
					.select('*')
					.eq('conversation_id', conversationId)
					.order('created_at', { ascending: false })
					.limit(limit);
				if (error) throw new Error(error.message);
				return json({ success: true, data: { messages: data ?? [], count: (data ?? []).length } });
			}

			case 'list_contacts': {
				const { widgetId, search, limit = 50, page = 1 } = params;
				const offset = (page - 1) * limit;
				let query = supabase
					.from('contacts')
					.select(
						`
						id,
						conversation_id,
						widget_id,
						name,
						email,
						phone,
						address,
						tags,
						created_at,
						updated_at,
						widgets!inner(workspace_id)
					`,
						{ count: 'exact' }
					)
					.eq('widgets.workspace_id', authInfo.workspaceId)
					.order('updated_at', { ascending: false })
					.range(offset, offset + limit - 1);
				if (widgetId) {
					query = query.eq('widget_id', widgetId);
				}
				if (search) {
					query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
				}
				const { data, error, count } = await query;
				if (error) throw new Error(error.message);
				return json({
					success: true,
					data: { contacts: data ?? [], totalCount: count ?? 0, page, limit },
				});
			}

			case 'get_contact': {
				const { contactId } = params;
				if (!contactId) return json({ error: 'contactId required' }, { status: 400 });
				const { data, error } = await supabase
					.from('contacts')
					.select(
						`
						id,
						conversation_id,
						widget_id,
						name,
						email,
						phone,
						address,
						tags,
						created_at,
						updated_at,
						widgets!inner(workspace_id)
					`
					)
					.eq('id', contactId)
					.eq('widgets.workspace_id', authInfo.workspaceId)
					.single();
				if (error) {
					if (error.code === 'PGRST116') return json({ error: 'Contact not found' }, { status: 404 });
					throw new Error(error.message);
				}
				return json({ success: true, data: { contact: data } });
			}

			case 'send_email': {
				const { conversationId, contactId, subject, body } = enrichedParams;
				if (!subject || !body) {
					return json({ error: 'subject and body required' }, { status: 400 });
				}
				if (!conversationId && !contactId) {
					return json({ error: 'conversationId or contactId required' }, { status: 400 });
				}

				// Get contact and verify workspace access
				let contactRow: { id: string; name: string | null; email: unknown; conversation_id: string | null } | null = null;
				if (contactId) {
					const { data, error } = await supabase
						.from('contacts')
						.select('id, name, email, conversation_id, widgets!inner(workspace_id)')
						.eq('id', contactId)
						.eq('widgets.workspace_id', authInfo.workspaceId)
						.single();
					if (error) {
						if (error.code === 'PGRST116') return json({ error: 'Contact not found' }, { status: 404 });
						throw new Error(error.message);
					}
					contactRow = data as typeof contactRow;
				} else if (conversationId) {
					const { data, error } = await supabase
						.from('contacts')
						.select('id, name, email, conversation_id, widgets!inner(workspace_id)')
						.eq('conversation_id', conversationId)
						.eq('widgets.workspace_id', authInfo.workspaceId)
						.maybeSingle();
					if (error) throw new Error(error.message);
					contactRow = data as typeof contactRow;
				}

				if (!contactRow) {
					return json({ error: 'Contact not found for this conversation' }, { status: 404 });
				}

				const toEmail = getPrimaryEmail(contactRow.email);
				if (!toEmail) {
					return json({ error: 'Contact has no email' }, { status: 400 });
				}

				const result = await sendContactEmail(supabase, authInfo.userId, {
					toEmail,
					subject: String(subject),
					body: String(body),
					contactId: contactRow.id,
					conversationId: contactRow.conversation_id,
					customerName: contactRow.name
				});

				if (result.sent) {
					return json({ success: true, data: { sent: true } });
				}
				return json({ error: result.error ?? 'Failed to send email' }, { status: 500 });
			}

			case 'list_email_templates': {
				const { data, error } = await supabase
					.from('email_templates')
					.select('id, name, subject, body, created_at, updated_at')
					.eq('user_id', authInfo.userId)
					.order('created_at', { ascending: false });
				if (error) throw new Error(error.message);
				return json({ success: true, data: { templates: data ?? [], count: (data ?? []).length } });
			}

			case 'get_email_template': {
				const { templateId } = params;
				if (!templateId) return json({ error: 'templateId required' }, { status: 400 });
				const { data, error } = await supabase
					.from('email_templates')
					.select('id, name, subject, body, created_at, updated_at')
					.eq('id', templateId)
					.eq('user_id', authInfo.userId)
					.single();
				if (error) {
					if (error.code === 'PGRST116') return json({ error: 'Template not found' }, { status: 404 });
					throw new Error(error.message);
				}
				return json({ success: true, data: { template: data } });
			}

			case 'create_email_template': {
				const { name, subject, body } = params;
				if (!name) return json({ error: 'name required' }, { status: 400 });
				const { data, error } = await (supabase.from('email_templates') as any)
					.insert({
						user_id: authInfo.userId,
						name: String(name),
						subject: subject ? String(subject) : '',
						body: body ? String(body) : ''
					})
					.select('id, name, subject, body, created_at, updated_at')
					.single();
				if (error) throw new Error(error.message);
				return json({ success: true, data: { template: data } });
			}

			case 'update_email_template': {
				const { templateId, name, subject, body } = params;
				if (!templateId) return json({ error: 'templateId required' }, { status: 400 });
				const updates: Record<string, unknown> = {};
				if (name !== undefined) updates.name = String(name);
				if (subject !== undefined) updates.subject = String(subject);
				if (body !== undefined) updates.body = String(body);
				if (Object.keys(updates).length === 0) {
					return json({ error: 'No fields to update' }, { status: 400 });
				}
				const { data, error } = await (supabase.from('email_templates') as any)
					.update(updates)
					.eq('id', templateId)
					.eq('user_id', authInfo.userId)
					.select('id, name, subject, body, created_at, updated_at')
					.single();
				if (error) {
					if (error.code === 'PGRST116') return json({ error: 'Template not found' }, { status: 404 });
					throw new Error(error.message);
				}
				return json({ success: true, data: { template: data } });
			}

			case 'delete_email_template': {
				const { templateId } = params;
				if (!templateId) return json({ error: 'templateId required' }, { status: 400 });
				const { error } = await supabase
					.from('email_templates')
					.delete()
					.eq('id', templateId)
					.eq('user_id', authInfo.userId);
				if (error) {
					if (error.code === 'PGRST116') return json({ error: 'Template not found' }, { status: 404 });
					throw new Error(error.message);
				}
				return json({ success: true, data: { message: 'Template deleted' } });
			}

			case 'list_emails': {
				const { contactId, conversationId, limit = 50, page = 1 } = params;
				if (!contactId && !conversationId) {
					return json({ error: 'contactId or conversationId required' }, { status: 400 });
				}

				let query = supabase.from('contact_emails').select('*');
				
				if (contactId) {
					// Verify contact belongs to workspace
					const { data: contact } = await supabase
						.from('contacts')
						.select('id, widgets!inner(workspace_id)')
						.eq('id', contactId)
						.eq('widgets.workspace_id', authInfo.workspaceId)
						.single();
					if (!contact) {
						return json({ error: 'Contact not found' }, { status: 404 });
					}
					query = query.eq('contact_id', contactId);
				} else if (conversationId) {
					// Verify conversation belongs to workspace
					const { data: conv } = await supabase
						.from('widget_conversations')
						.select('id, widgets!inner(workspace_id)')
						.eq('id', conversationId)
						.eq('widgets.workspace_id', authInfo.workspaceId)
						.single();
					if (!conv) {
						return json({ error: 'Conversation not found' }, { status: 404 });
					}
					query = query.eq('conversation_id', conversationId);
				}

				const pageLimit = Math.min(Math.max(1, Number(limit)), 100);
				const pageNum = Math.max(1, Number(page));
				const offset = (pageNum - 1) * pageLimit;

				const { data, error } = await query
					.order('created_at', { ascending: false })
					.range(offset, offset + pageLimit - 1);
				if (error) throw new Error(error.message);
				return json({ success: true, data: { emails: data ?? [], count: (data ?? []).length } });
			}

			case 'get_email': {
				const { emailId } = params;
				if (!emailId) return json({ error: 'emailId required' }, { status: 400 });
				
				// Verify email belongs to workspace via contact
				const { data, error } = await supabase
					.from('contact_emails')
					.select(
						`
						*,
						contacts!inner(
							id,
							widgets!inner(workspace_id)
						)
						`
					)
					.eq('id', emailId)
					.eq('contacts.widgets.workspace_id', authInfo.workspaceId)
					.single();
				if (error) {
					if (error.code === 'PGRST116') return json({ error: 'Email not found' }, { status: 404 });
					throw new Error(error.message);
				}
				return json({ success: true, data: { email: data } });
			}

			case 'upload_quote_image': {
				// Accept base64 image data or image URL
				const { imageData, imageUrl, imageName } = params;
				
				if (!imageData && !imageUrl) {
					return json({ error: 'imageData (base64) or imageUrl required' }, { status: 400 });
				}

				const BUCKET = 'quote_assets';
				let imageUrlResult: string;

				if (imageUrl) {
					// If URL provided, use it directly (assume it's already uploaded)
					imageUrlResult = String(imageUrl);
				} else if (imageData) {
					// Handle base64 image data
					const base64Data = String(imageData);
					const base64Match = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
					if (!base64Match) {
						return json({ error: 'Invalid base64 image format. Expected: data:image/type;base64,...' }, { status: 400 });
					}

					const imageType = base64Match[1];
					const base64Content = base64Match[2];
					const allowedTypes = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
					if (!allowedTypes.includes(imageType.toLowerCase())) {
						return json({ error: 'Invalid image type. Use PNG, JPEG, GIF, WebP, or SVG.' }, { status: 400 });
					}

					const buffer = Buffer.from(base64Content, 'base64');
					if (buffer.length > 2 * 1024 * 1024) {
						return json({ error: 'Image too large (max 2MB)' }, { status: 400 });
					}

					const safeExt = imageType.toLowerCase() === 'jpg' ? 'jpeg' : imageType.toLowerCase();
					const fileName = imageName ? `${String(imageName).replace(/[^a-zA-Z0-9_-]/g, '_')}.${safeExt}` : `${randomUUID()}.${safeExt}`;
					const path = `${authInfo.userId}/images/${fileName}`;

					const contentType = `image/${safeExt === 'svg' ? 'svg+xml' : safeExt}`;
					const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, buffer, {
						contentType,
						upsert: true
					});

					if (uploadErr) {
						console.error('quote_assets upload:', uploadErr);
						return json({ error: uploadErr.message }, { status: 500 });
					}

					const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
					imageUrlResult = urlData.publicUrl;
				} else {
					return json({ error: 'imageData or imageUrl required' }, { status: 400 });
				}

				return json({ success: true, data: { imageUrl: imageUrlResult } });
			}

			case 'generate_quote': {
				const { widgetId, conversationId, email, customer, project, lineItems, images } = params;
				let resolvedWidgetId = typeof widgetId === 'string' ? widgetId.trim() : null;
				const convId = typeof conversationId === 'string' ? conversationId.trim() : undefined;

				// If widgetId not provided, try to resolve from conversationId
				if (!resolvedWidgetId && convId) {
					const { data: conv, error: convErr } = await supabase
						.from('widget_conversations')
						.select('widget_id, widgets!inner(workspace_id)')
						.eq('id', convId)
						.eq('widgets.workspace_id', authInfo.workspaceId)
						.single();
					if (convErr || !conv) {
						if (convErr?.code === 'PGRST116') return json({ error: 'Conversation not found' }, { status: 404 });
						return json({ error: 'Conversation not found or access denied' }, { status: 404 });
					}
					resolvedWidgetId = (conv.widget_id as string) ?? null;
				}

				if (!resolvedWidgetId) {
					return json({ error: 'widgetId or conversationId required' }, { status: 400 });
				}
				if (!convId && !email) {
					return json({ error: 'conversationId or email required' }, { status: 400 });
				}

				// Verify widget belongs to workspace
				const { data: widget, error: widgetErr } = await supabase
					.from('widgets')
					.select('id, created_by, workspace_id')
					.eq('id', resolvedWidgetId)
					.eq('workspace_id', authInfo.workspaceId)
					.single();
				if (widgetErr || !widget) {
					if (widgetErr?.code === 'PGRST116') return json({ error: 'Widget not found' }, { status: 404 });
					throw new Error(widgetErr?.message ?? 'Widget not found');
				}
				const ownerId = (widget as { created_by?: string }).created_by;
				if (!ownerId) {
					return json({ error: 'Widget has no owner' }, { status: 400 });
				}

				// Load quote settings
				const { data: settingsRow, error: settingsErr } = await supabase
					.from('quote_settings')
					.select('*')
					.eq('user_id', ownerId)
					.maybeSingle();
				if (settingsErr || !settingsRow) {
					return json({ error: 'Quote settings not found. Configure quote template first.' }, { status: 400 });
				}

				const settings: QuoteSettings = {
					company: (settingsRow.company as QuoteSettings['company']) ?? {},
					bank_details: (settingsRow.bank_details as QuoteSettings['bank_details']) ?? {},
					line_items: (settingsRow.line_items as QuoteSettings['line_items']) ?? [],
					deposit_percent: Number(settingsRow.deposit_percent) ?? 40,
					tax_percent: Number(settingsRow.tax_percent) ?? 10,
					valid_days: Number(settingsRow.valid_days) ?? 30,
					logo_url: settingsRow.logo_url,
					barcode_url: settingsRow.barcode_url,
					barcode_title: settingsRow.barcode_title ?? 'Call Us or Visit Website',
					currency: settingsRow.currency ?? 'USD'
				};

				// Load contact if conversationId provided
				let customerData = customer ?? {};
				let projectData = project ?? {};
				if (convId) {
					const { data: contact } = await supabase
						.from('contacts')
						.select('name, email, phone, address')
						.eq('conversation_id', convId)
						.eq('widget_id', resolvedWidgetId)
						.maybeSingle();
					if (contact) {
						customerData = { name: contact.name ?? '', email: contact.email ?? '', phone: contact.phone ?? '' };
						if (contact.address) projectData = { ...projectData, fullAddress: contact.address };
					}
				} else if (email) {
					customerData = { ...customerData, email: String(email) };
				}

				const { extractAreaDigits } = await import('$lib/quote-html');
				const roofSize = extractAreaDigits(projectData?.roofSize);
				const computed = computeQuoteFromSettings(settings, roofSize, { lineItems: lineItems as any });

				const payload = {
					customer: customerData,
					project: { roofSize, fullAddress: projectData?.fullAddress },
					quote: {
						quoteDate: computed.quoteDate,
						validUntil: computed.validUntil,
						breakdownTotals: computed.breakdownTotals,
						subtotal: computed.subtotal,
						gst: computed.gst,
						total: computed.total
					},
					images: Array.isArray(images) ? images : []
				};

				let pdfBuffer: Buffer;
				try {
					pdfBuffer = await generatePdfFromDocDefinition(settings, payload, images as string[] | undefined);
				} catch (e) {
					const msg = e instanceof Error ? e.message : 'PDF generation failed';
					console.error('generatePdfFromDocDefinition:', e);
					return json({ error: msg }, { status: 500 });
				}

				const BUCKET = 'roof_quotes';
				const customerName = ((customerData.name || customerData.email || 'Customer') as string)
					.replace(/\s+/g, '_')
					.replace(/[^a-zA-Z0-9_-]/g, '');
				const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
				const fileName = convId
					? `${convId}/quote_${customerName}_${ts}.pdf`
					: `email_${String(email).replace(/[@.]/g, '_') ?? 'unknown'}_${ts}.pdf`;

				const metadata: Record<string, string> = {
					widget_id: resolvedWidgetId
				};
				if (convId) metadata.conversation_id = convId;
				if (email) metadata.email = String(email);

				const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(fileName, pdfBuffer, {
					contentType: 'application/pdf',
					upsert: true,
					metadata
				});
				if (uploadErr) {
					console.error('roof_quotes upload:', uploadErr);
					return json({ error: uploadErr.message }, { status: 500 });
				}

				const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(fileName, 3600);
				const pdfUrl = signed?.signedUrl ?? fileName;

				return json({ success: true, data: { pdfUrl, fileName, total: computed.total } });
			}

			case 'get_quote_settings': {
				const { data, error } = await supabase
					.from('quote_settings')
					.select('*')
					.eq('user_id', authInfo.userId)
					.maybeSingle();
				if (error) throw new Error(error.message);
				if (!data) {
					return json({
						success: true,
						data: {
							company: {},
							bank_details: {},
							line_items: [],
							deposit_percent: 40,
							tax_percent: 10,
							valid_days: 30,
							logo_url: null,
							barcode_url: null,
							barcode_title: 'Call Us or Visit Website',
							logo_size: 60,
							qr_size: 80,
							currency: 'USD'
						}
					});
				}
				return json({
					success: true,
					data: {
						company: data.company ?? {},
						bank_details: data.bank_details ?? {},
						line_items: data.line_items ?? [],
						deposit_percent: Number(data.deposit_percent) ?? 40,
						tax_percent: Number(data.tax_percent) ?? 10,
						valid_days: Number(data.valid_days) ?? 30,
						logo_url: data.logo_url,
						barcode_url: data.barcode_url,
						barcode_title: data.barcode_title ?? 'Call Us or Visit Website',
						logo_size: data.logo_size != null ? Math.min(80, Number(data.logo_size)) : 60,
						qr_size: data.qr_size != null ? Number(data.qr_size) : 80,
						currency: data.currency ?? 'USD'
					}
				});
			}

			case 'update_quote_settings': {
				const {
					company,
					bank_details,
					line_items,
					deposit_percent,
					tax_percent,
					valid_days,
					logo_url,
					barcode_url,
					barcode_title,
					logo_size,
					qr_size,
					currency
				} = params;

				const logoSize = Math.max(20, Math.min(80, Number(logo_size) || 60));
				const qrSize = Math.max(20, Math.min(300, Number(qr_size) || 80));

				const row = {
					user_id: authInfo.userId,
					company: company ?? {},
					bank_details: bank_details ?? {},
					line_items: line_items ?? [],
					deposit_percent: Math.max(0, Math.min(100, Number(deposit_percent) ?? 40)),
					tax_percent: Math.max(0, Math.min(100, Number(tax_percent) ?? 10)),
					valid_days: Math.max(1, Math.min(365, Number(valid_days) ?? 30)),
					logo_url: logo_url ?? null,
					barcode_url: barcode_url ?? null,
					barcode_title: typeof barcode_title === 'string' ? barcode_title : 'Call Us or Visit Website',
					logo_size: logoSize,
					qr_size: qrSize,
					currency: typeof currency === 'string' && currency.trim() ? currency.trim() : 'USD'
				};

				const { error } = await (supabase.from('quote_settings') as any).upsert(row, {
					onConflict: 'user_id',
					ignoreDuplicates: false
				});
				if (error) throw new Error(error.message);
				return json({ success: true, data: { message: 'Quote settings updated' } });
			}

			case 'shopify_list_orders': {
				const config = await getShopifyConfigForUser(supabase, authInfo.userId);
				if (!config) {
					return json({ error: 'Shopify is not connected. Connect Shopify in Settings → Integrations.' }, { status: 400 });
				}
				const { limit = 10 } = params;
				const limitNum = Math.min(Math.max(1, Number(limit)), 250);
				const { orders, error: shopifyError } = await listRecentOrders(config, limitNum);
				if (shopifyError) return json({ error: shopifyError }, { status: 500 });
				return json({ success: true, data: { orders: orders ?? [], count: (orders ?? []).length } });
			}

			case 'shopify_search_orders': {
				const config = await getShopifyConfigForUser(supabase, authInfo.userId);
				if (!config) {
					return json({ error: 'Shopify is not connected. Connect Shopify in Settings → Integrations.' }, { status: 400 });
				}
				const { query: searchQuery, limit = 10 } = params;
				if (!searchQuery || typeof searchQuery !== 'string') {
					return json({ error: 'query parameter required' }, { status: 400 });
				}
				const limitNum = Math.min(Math.max(1, Number(limit)), 50);
				const { orders, error: shopifyError } = await searchOrders(config, String(searchQuery), limitNum);
				if (shopifyError) return json({ error: shopifyError }, { status: 500 });
				return json({ success: true, data: { orders: orders ?? [], count: (orders ?? []).length } });
			}

			case 'shopify_get_order': {
				const config = await getShopifyConfigForUser(supabase, authInfo.userId);
				if (!config) {
					return json({ error: 'Shopify is not connected. Connect Shopify in Settings → Integrations.' }, { status: 400 });
				}
				const { orderId } = params;
				if (!orderId) return json({ error: 'orderId required' }, { status: 400 });
				const orderIdNum = Number(orderId);
				if (!Number.isFinite(orderIdNum)) {
					return json({ error: 'orderId must be a number' }, { status: 400 });
				}
				const { order, error: shopifyError } = await getOrder(config, orderIdNum);
				if (shopifyError) return json({ error: shopifyError }, { status: 500 });
				if (!order) return json({ error: 'Order not found' }, { status: 404 });
				return json({ success: true, data: { order } });
			}

			case 'shopify_list_customers': {
				const config = await getShopifyConfigForUser(supabase, authInfo.userId);
				if (!config) {
					return json({ error: 'Shopify is not connected. Connect Shopify in Settings → Integrations.' }, { status: 400 });
				}
				const { limit = 50, pageInfo } = params;
				const limitNum = Math.min(Math.max(1, Number(limit)), 250);
				const { customers, nextPageInfo, error: shopifyError } = await listCustomers(config, {
					limit: limitNum,
					pageInfo: typeof pageInfo === 'string' ? pageInfo : undefined
				});
				if (shopifyError) return json({ error: shopifyError }, { status: 500 });
				return json({
					success: true,
					data: { customers: customers ?? [], count: (customers ?? []).length, nextPageInfo }
				});
			}

			case 'shopify_get_customer': {
				const config = await getShopifyConfigForUser(supabase, authInfo.userId);
				if (!config) {
					return json({ error: 'Shopify is not connected. Connect Shopify in Settings → Integrations.' }, { status: 400 });
				}
				const { customerId } = params;
				if (!customerId) return json({ error: 'customerId required' }, { status: 400 });
				const customerIdNum = Number(customerId);
				if (!Number.isFinite(customerIdNum)) {
					return json({ error: 'customerId must be a number' }, { status: 400 });
				}
				const { customer, error: shopifyError } = await getCustomer(config, customerIdNum);
				if (shopifyError) return json({ error: shopifyError }, { status: 500 });
				if (!customer) return json({ error: 'Customer not found' }, { status: 404 });
				return json({ success: true, data: { customer } });
			}

			case 'shopify_get_customer_orders': {
				const config = await getShopifyConfigForUser(supabase, authInfo.userId);
				if (!config) {
					return json({ error: 'Shopify is not connected. Connect Shopify in Settings → Integrations.' }, { status: 400 });
				}
				const { customerId } = params;
				if (!customerId) return json({ error: 'customerId required' }, { status: 400 });
				const customerIdNum = Number(customerId);
				if (!Number.isFinite(customerIdNum)) {
					return json({ error: 'customerId must be a number' }, { status: 400 });
				}
				const { orders, error: shopifyError } = await listOrdersForCustomer(config, customerIdNum);
				if (shopifyError) return json({ error: shopifyError }, { status: 500 });
				return json({ success: true, data: { orders: orders ?? [], count: (orders ?? []).length } });
			}

			case 'shopify_cancel_order': {
				const config = await getShopifyConfigForUser(supabase, authInfo.userId);
				if (!config) {
					return json({ error: 'Shopify is not connected. Connect Shopify in Settings → Integrations.' }, { status: 400 });
				}
				const { orderId, reason, notify, restock } = params;
				if (!orderId) return json({ error: 'orderId required' }, { status: 400 });
				const orderIdNum = Number(orderId);
				if (!Number.isFinite(orderIdNum)) {
					return json({ error: 'orderId must be a number' }, { status: 400 });
				}
				const { ok, error: shopifyError } = await cancelOrder(config, orderIdNum, {
					reason: typeof reason === 'string' ? reason : undefined,
					notify: notify === true || notify === 'true',
					restock: restock === true || restock === 'true'
				});
				if (!ok) return json({ error: shopifyError ?? 'Failed to cancel order' }, { status: 500 });
				return json({ success: true, data: { message: 'Order cancelled successfully' } });
			}

			case 'shopify_refund_order': {
				const config = await getShopifyConfigForUser(supabase, authInfo.userId);
				if (!config) {
					return json({ error: 'Shopify is not connected. Connect Shopify in Settings → Integrations.' }, { status: 400 });
				}
				const { orderId, notify, note } = params;
				if (!orderId) return json({ error: 'orderId required' }, { status: 400 });
				const orderIdNum = Number(orderId);
				if (!Number.isFinite(orderIdNum)) {
					return json({ error: 'orderId must be a number' }, { status: 400 });
				}
				const { ok, error: shopifyError } = await refundOrderFull(config, orderIdNum, {
					notify: notify === true || notify === 'true',
					note: typeof note === 'string' ? note : undefined
				});
				if (!ok) return json({ error: shopifyError ?? 'Failed to refund order' }, { status: 500 });
				return json({ success: true, data: { message: 'Order refunded successfully' } });
			}

			case 'shopify_get_statistics': {
				const config = await getShopifyConfigForUser(supabase, authInfo.userId);
				if (!config) {
					return json({ error: 'Shopify is not connected. Connect Shopify in Settings → Integrations.' }, { status: 400 });
				}
				const { days = 30 } = params;
				const daysNum = Math.min(Math.max(1, Number(days)), 365);
				const { statistics, error: shopifyError } = await getShopifyStatistics(config, { days: daysNum });
				if (shopifyError) return json({ error: shopifyError }, { status: 500 });
				if (!statistics) return json({ error: 'Failed to get statistics' }, { status: 500 });
				return json({ success: true, data: { statistics } });
			}

			case 'shopify_list_products': {
				const config = await getShopifyConfigForUser(supabase, authInfo.userId);
				if (!config) {
					return json({ error: 'Shopify is not connected. Connect Shopify in Settings → Integrations.' }, { status: 400 });
				}
				const { limit = 100 } = params;
				const limitNum = Math.min(Math.max(1, Number(limit)), 250);
				const { products, error: shopifyError } = await listProductsWithImages(config, limitNum);
				if (shopifyError) return json({ error: shopifyError }, { status: 500 });
				return json({ success: true, data: { products: products ?? [], count: (products ?? []).length } });
			}

			case 'get_contact_by_conversation': {
				const { widgetId, conversationId } = enrichedParams;
				if (!widgetId || !conversationId) {
					return json({ error: 'widgetId and conversationId required' }, { status: 400 });
				}

				// Verify widget belongs to workspace
				const { data: widget } = await supabase
					.from('widgets')
					.select('id, workspace_id')
					.eq('id', widgetId)
					.eq('workspace_id', authInfo.workspaceId)
					.single();
				if (!widget) {
					return json({ error: 'Widget not found or access denied' }, { status: 404 });
				}

				// Verify conversation exists and belongs to this widget
				const { data: conv, error: convError } = await supabase
					.from('widget_conversations')
					.select('id, widget_id')
					.eq('id', conversationId)
					.eq('widget_id', widgetId)
					.single();
				if (convError || !conv) {
					return json({ error: 'Conversation not found or does not belong to this widget' }, { status: 404 });
				}

				let data = null;
				let error = null;
				
				// Try to get existing contact
				const { data: existingContact, error: fetchError } = await supabase
					.from('contacts')
					.select('id, name, email, phone, address, street_address, city, state, postcode, country, roof_size_sqm, conversation_id, widget_id, created_at')
					.eq('conversation_id', conversationId)
					.eq('widget_id', widgetId)
					.maybeSingle();
				
				if (fetchError) {
					console.error('get_contact_by_conversation fetch error:', fetchError);
					return json({ error: fetchError.message }, { status: 500 });
				}

				// If contact doesn't exist, create a placeholder contact
				if (!existingContact) {
					const { data: newContact, error: createError } = await supabase
						.from('contacts')
						.insert({
							conversation_id: conversationId,
							widget_id: widgetId
						})
						.select('id, name, email, phone, address, street_address, city, state, postcode, country, roof_size_sqm, conversation_id, widget_id, created_at')
						.single();
					
					if (createError) {
						console.error('get_contact_by_conversation create error:', createError);
						// If creation fails (e.g., due to constraint), try fetching again
						const { data: retryContact, error: retryError } = await supabase
							.from('contacts')
							.select('id, name, email, phone, address, street_address, city, state, postcode, country, roof_size_sqm, conversation_id, widget_id, created_at')
							.eq('conversation_id', conversationId)
							.eq('widget_id', widgetId)
							.maybeSingle();
						
						if (retryError) {
							return json({ error: retryError.message }, { status: 500 });
						}
						data = retryContact;
					} else {
						data = newContact;
					}
				} else {
					data = existingContact;
				}

				if (!data) {
					return json({ success: true, data: { contact: null } });
				}
				
				const emails = parseEmailsFromDb(data.email);
				return json({
					success: true,
					data: {
						contact: {
							id: data.id,
							name: data.name ?? null,
							email: getPrimaryEmail(data.email) ?? null,
							emails: emails.length > 0 ? emails : null,
							phone: data.phone ?? null,
							address: data.address ?? null,
							streetAddress: data.street_address ?? null,
							city: data.city ?? null,
							state: data.state ?? null,
							postcode: data.postcode ?? null,
							country: data.country ?? null,
							roofSizeSqm: data.roof_size_sqm != null ? Number(data.roof_size_sqm) : null,
							conversationId: data.conversation_id,
							widgetId: data.widget_id,
							createdAt: data.created_at
						}
					}
				});
			}

			case 'update_contact_by_conversation': {
				const { widgetId, conversationId, name, email, emails, phone, address, street_address, city, state, postcode, country, roof_size_sqm } = enrichedParams;
				if (!widgetId || !conversationId) {
					return json({ error: 'widgetId and conversationId required' }, { status: 400 });
				}

				// Verify widget belongs to workspace
				const { data: widget } = await supabase
					.from('widgets')
					.select('id, workspace_id')
					.eq('id', widgetId)
					.eq('workspace_id', authInfo.workspaceId)
					.single();
				if (!widget) {
					return json({ error: 'Widget not found or access denied' }, { status: 404 });
				}

				const updates: Record<string, string | number | string[]> = {};
				if (typeof name === 'string') {
					const v = name.trim();
					if (v) updates.name = v;
				}
				if (Array.isArray(emails)) {
					const arr = emailsToJsonb(emails);
					if (arr.length > 0) updates.email = arr;
				} else if (typeof email === 'string') {
					const v = email.trim();
					if (v) updates.email = emailsToJsonb(v);
				}
				if (typeof phone === 'string') {
					const v = phone.trim();
					if (v) updates.phone = v;
				}
				if (typeof address === 'string') {
					const v = address.trim();
					if (v) updates.address = v;
				}
				if (typeof street_address === 'string') {
					const v = street_address.trim();
					if (v) updates.street_address = v;
				}
				if (typeof city === 'string') {
					const v = city.trim();
					if (v) updates.city = v;
				}
				if (typeof state === 'string') {
					const v = state.trim();
					if (v) updates.state = v;
				}
				if (typeof postcode === 'string') {
					const v = postcode.trim();
					if (v) updates.postcode = v;
				}
				if (typeof country === 'string') {
					const v = country.trim();
					if (v) updates.country = v;
				}
				if (typeof roof_size_sqm === 'number' && roof_size_sqm >= 0) {
					updates.roof_size_sqm = roof_size_sqm;
				}
				if (Object.keys(updates).length === 0) {
					return json({ error: 'No fields to update (name, email, emails, phone, address, street_address, city, state, postcode, country, roof_size_sqm)' }, { status: 400 });
				}

				const { error } = await supabase
					.from('contacts')
					.update(updates)
					.eq('conversation_id', conversationId)
					.eq('widget_id', widgetId);
				if (error) {
					console.error('update_contact_by_conversation:', error);
					return json({ error: error.message }, { status: 500 });
				}
				return json({ success: true, data: { message: 'Contact updated successfully' } });
			}

			case 'get_product_pricing': {
				const { widgetId, conversationId } = enrichedParams;
				let resolvedWidgetId = typeof widgetId === 'string' ? widgetId.trim() : null;

				// If widgetId not provided, try to resolve from conversationId
				if (!resolvedWidgetId && conversationId) {
					const { data: conv, error: convErr } = await supabase
						.from('widget_conversations')
						.select('widget_id, widgets!inner(workspace_id)')
						.eq('id', conversationId)
						.eq('widgets.workspace_id', authInfo.workspaceId)
						.single();
					if (convErr || !conv) {
						if (convErr?.code === 'PGRST116') return json({ error: 'Conversation not found' }, { status: 404 });
						return json({ error: 'Conversation not found or access denied' }, { status: 404 });
					}
					resolvedWidgetId = (conv.widget_id as string) ?? null;
				}

				if (!resolvedWidgetId) {
					return json({ error: 'widgetId or conversationId required' }, { status: 400 });
				}

				// Verify widget belongs to workspace and get owner
				const { data: widget, error: widgetErr } = await supabase
					.from('widgets')
					.select('id, created_by, workspace_id')
					.eq('id', resolvedWidgetId)
					.eq('workspace_id', authInfo.workspaceId)
					.single();
				if (widgetErr || !widget) {
					if (widgetErr?.code === 'PGRST116') return json({ error: 'Widget not found' }, { status: 404 });
					return json({ error: 'Widget not found or access denied' }, { status: 404 });
				}
				const ownerId = (widget.created_by as string);
				if (!ownerId) {
					return json({ error: 'Widget has no owner' }, { status: 400 });
				}

				try {
					const products = await getProductPricingForOwner(ownerId);
					return json({
						success: true,
						data: {
							products: products.map((p) => ({
								id: p.id,
								name: p.name,
								sizeLitres: p.sizeLitres,
								price: p.price,
								currency: p.currency,
								coverageSqm: p.coverageSqm,
								imageUrl: p.imageUrl,
								shopifyProductId: p.shopifyProductId,
								shopifyVariantId: p.shopifyVariantId,
								sortOrder: p.sortOrder
							}))
						}
					});
				} catch (e) {
					const msg = e instanceof Error ? e.message : 'Failed to get product pricing';
					console.error('get_product_pricing:', e);
					return json({ error: msg }, { status: 500 });
				}
			}

			case 'create_diy_checkout': {
				const { widgetId, conversationId, roof_size_sqm, count_15l, count_10l, count_5l, discount_percent, email } = enrichedParams;
				let resolvedWidgetId = typeof widgetId === 'string' ? widgetId.trim() : null;
				const convId = typeof conversationId === 'string' ? conversationId.trim() : undefined;

				// Debug logging
				console.log('[create_diy_checkout]', {
					hasWidgetId: !!resolvedWidgetId,
					hasConversationId: !!convId,
					widgetId: resolvedWidgetId,
					conversationId: convId,
					workspaceId: authInfo.workspaceId,
					headerConversationId,
					headerWidgetId,
					paramsConversationId: params.conversationId,
					paramsWidgetId: params.widgetId
				});

				// If widgetId not provided, try to resolve from conversationId
				if (!resolvedWidgetId && convId) {
					const { data: conv, error: convErr } = await supabase
						.from('widget_conversations')
						.select('widget_id, widgets!inner(workspace_id)')
						.eq('id', convId)
						.eq('widgets.workspace_id', authInfo.workspaceId)
						.single();
					if (convErr || !conv) {
						console.error('[create_diy_checkout] Conversation lookup failed:', { convErr, convId, workspaceId: authInfo.workspaceId });
						if (convErr?.code === 'PGRST116') return json({ error: 'Conversation not found' }, { status: 404 });
						return json({ error: 'Conversation not found or access denied' }, { status: 404 });
					}
					resolvedWidgetId = (conv.widget_id as string) ?? null;
				}

				if (!resolvedWidgetId) {
					console.error('[create_diy_checkout] Missing widgetId and conversationId:', { widgetId: resolvedWidgetId, conversationId: convId });
					return json({ error: 'widgetId or conversationId required' }, { status: 400 });
				}

				// Verify widget belongs to workspace and get owner
				const { data: widget, error: widgetErr } = await supabase
					.from('widgets')
					.select('id, created_by, workspace_id')
					.eq('id', resolvedWidgetId)
					.eq('workspace_id', authInfo.workspaceId)
					.single();
				if (widgetErr || !widget) {
					console.error('[create_diy_checkout] Widget lookup failed:', { widgetErr, resolvedWidgetId, workspaceId: authInfo.workspaceId });
					if (widgetErr?.code === 'PGRST116') return json({ error: 'Widget not found' }, { status: 404 });
					return json({ error: 'Widget not found or access denied' }, { status: 404 });
				}
				const ownerId = (widget.created_by as string);
				if (!ownerId) {
					return json({ error: 'Widget has no owner' }, { status: 400 });
				}

				// Validate input
				const roofSizeSqm = typeof roof_size_sqm === 'number' && roof_size_sqm >= 1 ? roof_size_sqm : undefined;
				const count15l = typeof count_15l === 'number' && count_15l >= 0 ? count_15l : undefined;
				const count10l = typeof count_10l === 'number' && count_10l >= 0 ? count_10l : undefined;
				const count5l = typeof count_5l === 'number' && count_5l >= 0 ? count_5l : undefined;
				const discountPercent = typeof discount_percent === 'number' && discount_percent >= 1 && discount_percent <= 20 ? discount_percent : undefined;
				const contactEmail = typeof email === 'string' ? email.trim() || undefined : undefined;

				if (roofSizeSqm == null && (count15l ?? 0) === 0 && (count10l ?? 0) === 0 && (count5l ?? 0) === 0) {
					return json(
						{ error: 'Provide roof_size_sqm or at least one of count_15l, count_10l, count_5l.' },
						{ status: 400 }
					);
				}

				// Get contact email from conversation if not provided
				let finalEmail = contactEmail;
				if (!finalEmail && convId) {
					const { data: contact } = await supabase
						.from('contacts')
						.select('email')
						.eq('conversation_id', convId)
						.eq('widget_id', resolvedWidgetId)
						.maybeSingle();
					if (contact?.email) {
						finalEmail = getPrimaryEmail(contact.email) ?? undefined;
					}
				}

				try {
					const result = await createDiyCheckoutForOwner(supabase, ownerId, {
						roof_size_sqm: roofSizeSqm,
						count_15l: count15l,
						count_10l: count10l,
						count_5l: count5l,
						discount_percent: discountPercent,
						email: finalEmail
					});

					if (!result.ok) {
						return json({ error: result.error }, { status: 400 });
					}

					return json({
						success: true,
						data: {
							checkoutUrl: result.data.checkoutUrl,
							lineItemsUI: result.data.lineItemsUI,
							summary: result.data.summary
						}
					});
				} catch (e) {
					const msg = e instanceof Error ? e.message : 'Failed to create checkout';
					console.error('create_diy_checkout:', e);
					return json({ error: msg }, { status: 500 });
				}
			}

			case 'create_discount': {
				const { widgetId, discount_percent } = enrichedParams;
				if (!widgetId) {
					return json({ error: 'widgetId required' }, { status: 400 });
				}

				// Verify widget belongs to workspace
				const { data: widget, error: widgetErr } = await supabase
					.from('widgets')
					.select('id, workspace_id')
					.eq('id', widgetId)
					.eq('workspace_id', authInfo.workspaceId)
					.single();
				if (widgetErr || !widget) {
					if (widgetErr?.code === 'PGRST116') return json({ error: 'Widget not found' }, { status: 404 });
					return json({ error: 'Widget not found or access denied' }, { status: 404 });
				}

				const ALLOWED_PERCENTS = [10, 15] as const;
				const CODE_BY_PERCENT: Record<number, string> = { 10: 'CHAT10', 15: 'CHAT15' };

				const raw = typeof discount_percent === 'number' ? discount_percent : undefined;
				const discountPercent = raw != null && ALLOWED_PERCENTS.includes(raw as (typeof ALLOWED_PERCENTS)[number])
					? (raw as (typeof ALLOWED_PERCENTS)[number])
					: null;

				if (discountPercent === null) {
					return json(
						{ error: 'discount_percent is required and must be 10 or 15.' },
						{ status: 400 }
					);
				}

				const code = CODE_BY_PERCENT[discountPercent];
				const message =
					discountPercent === 10
						? 'A 10% discount has been applied. When you ask for your checkout link, the discount will be included automatically.'
						: 'A 15% discount has been applied. When you ask for your checkout link, the discount will be included automatically.';

				return json({
					success: true,
					data: {
						discountPercent,
						code,
						message
					}
				});
			}

			case 'list_tools': {
				// Return list of available tools
				return json({
					success: true,
					data: {
						tools: [
							'list_widgets',
							'get_widget',
							'list_leads',
							'get_lead',
							'move_lead',
							'list_lead_stages',
							'create_lead_stage',
							'update_lead_stage',
							'delete_lead_stage',
							'list_conversations',
							'get_conversation',
							'send_message',
							'get_conversation_messages',
							'list_contacts',
							'get_contact',
							'get_contact_by_conversation',
							'update_contact_by_conversation',
							'send_email',
							'list_email_templates',
							'get_email_template',
							'create_email_template',
							'update_email_template',
							'delete_email_template',
							'list_emails',
							'get_email',
							'generate_quote',
							'get_quote_settings',
							'update_quote_settings',
							'upload_quote_image',
							'get_product_pricing',
							'create_diy_checkout',
							'create_discount',
							'shopify_list_orders',
							'shopify_search_orders',
							'shopify_get_order',
							'shopify_list_customers',
							'shopify_get_customer',
							'shopify_get_customer_orders',
							'shopify_cancel_order',
							'shopify_refund_order',
							'shopify_get_statistics',
							'shopify_list_products',
						],
					},
				});
			}

			default:
				return json({ error: `Unknown action: ${action}` }, { status: 400 });
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error occurred';
		console.error(`MCP API error (${action}):`, error);
		return json({ error: message }, { status: 500 });
	}
};
