import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { createClient } from '@supabase/supabase-js';
import { sendContactEmail } from '$lib/send-quote-email.server';
import { getPrimaryEmail } from '$lib/contact-email-jsonb';
import {
	computeQuoteFromSettings,
	generatePdfFromDocDefinition,
	type QuoteSettings
} from '$lib/quote-pdf.server';

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
				const { conversationId, contactId, subject, body } = params;
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

			case 'generate_quote': {
				const { widgetId, conversationId, email, customer, project, lineItems } = params;
				if (!widgetId) {
					return json({ error: 'widgetId required' }, { status: 400 });
				}
				if (!conversationId && !email) {
					return json({ error: 'conversationId or email required' }, { status: 400 });
				}

				// Verify widget belongs to workspace
				const { data: widget, error: widgetErr } = await supabase
					.from('widgets')
					.select('id, created_by, workspace_id')
					.eq('id', widgetId)
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
				if (conversationId) {
					const { data: contact } = await supabase
						.from('contacts')
						.select('name, email, phone, address')
						.eq('conversation_id', conversationId)
						.eq('widget_id', widgetId)
						.maybeSingle();
					if (contact) {
						customerData = { name: contact.name ?? '', email: contact.email ?? '', phone: contact.phone ?? '' };
						if (contact.address) projectData = { ...projectData, fullAddress: contact.address };
					}
				} else if (email) {
					customerData = { ...customerData, email: String(email) };
				}

				const roofSize = Math.max(0, Number(projectData?.roofSize) ?? 0);
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
					}
				};

				let pdfBuffer: Buffer;
				try {
					pdfBuffer = await generatePdfFromDocDefinition(settings, payload);
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
				const fileName = conversationId
					? `${conversationId}/quote_${customerName}_${ts}.pdf`
					: `email_${String(email).replace(/[@.]/g, '_') ?? 'unknown'}_${ts}.pdf`;

				const metadata: Record<string, string> = {
					widget_id: widgetId
				};
				if (conversationId) metadata.conversation_id = conversationId;
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
