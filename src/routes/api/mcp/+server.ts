import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';
import { env } from '$env/dynamic/private';
import { createClient } from '@supabase/supabase-js';

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
