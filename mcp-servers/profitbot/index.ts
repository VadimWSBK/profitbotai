#!/usr/bin/env node
/**
 * MCP Server for ProfitBot (Tenant-Scoped)
 * 
 * Exposes ProfitBot functionality as MCP tools, scoped to a specific workspace/tenant.
 * Uses API key authentication to ensure OpenClaw only has access to one tenant.
 * 
 * Usage:
 *   npx tsx mcp-servers/profitbot/index.ts
 * 
 * Environment variables:
 *   SUPABASE_URL - Your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Your Supabase service role key (for admin access)
 *   MCP_API_KEY - The MCP API key for the tenant (generated in dashboard)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	ErrorCode,
	McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { createClient } from '@supabase/supabase-js';

interface AuthInfo {
	workspaceId: string;
	userId: string;
	apiKeyId: string;
}

interface ProfitBotLead {
	id: string;
	contact_id: string;
	stage_id: string;
	created_at: string;
	updated_at: string;
}

interface ProfitBotLeadStage {
	id: string;
	name: string;
	sort_order: number;
	created_at: string;
}

class ProfitBotClient {
	private supabase: ReturnType<typeof createClient>;
	private authInfo: AuthInfo;

	constructor(supabaseUrl: string, serviceRoleKey: string, authInfo: AuthInfo) {
		this.supabase = createClient(supabaseUrl, serviceRoleKey);
		this.authInfo = authInfo;
	}

	// Ensure all operations are scoped to workspace
	private ensureWorkspaceScope<T extends { workspace_id?: string }>(
		data: T | T[] | null
	): T | T[] | null {
		if (!data) return null;
		if (Array.isArray(data)) {
			return data.filter((item) => item.workspace_id === this.authInfo.workspaceId) as T[];
		}
		if (data.workspace_id && data.workspace_id !== this.authInfo.workspaceId) {
			throw new Error('Access denied: resource belongs to different workspace');
		}
		return data;
	}

	// Widget operations (scoped to workspace)
	async listWidgets(): Promise<unknown[]> {
		const { data, error } = await this.supabase
			.from('widgets')
			.select('*')
			.eq('workspace_id', this.authInfo.workspaceId)
			.order('updated_at', { ascending: false });
		if (error) throw new Error(`Failed to list widgets: ${error.message}`);
		return (data ?? []) as unknown[];
	}

	async getWidget(id: string): Promise<unknown | null> {
		const { data, error } = await this.supabase
			.from('widgets')
			.select('*')
			.eq('id', id)
			.eq('workspace_id', this.authInfo.workspaceId)
			.single();
		if (error) {
			if (error.code === 'PGRST116') return null;
			throw new Error(`Failed to get widget: ${error.message}`);
		}
		return data as unknown;
	}

	// Leadflow operations
	async listLeads(widgetId?: string): Promise<unknown[]> {
		// Get leads via contacts (contacts are scoped to widgets which are scoped to workspace)
		let query = this.supabase
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
			.eq('contacts.widgets.workspace_id', this.authInfo.workspaceId);

		if (widgetId) {
			query = query.eq('contacts.widget_id', widgetId);
		}

		const { data, error } = await query.order('updated_at', { ascending: false });
		if (error) throw new Error(`Failed to list leads: ${error.message}`);
		return (data ?? []) as unknown[];
	}

	async getLead(leadId: string): Promise<unknown | null> {
		const { data, error } = await this.supabase
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
			.eq('contacts.widgets.workspace_id', this.authInfo.workspaceId)
			.single();
		if (error) {
			if (error.code === 'PGRST116') return null;
			throw new Error(`Failed to get lead: ${error.message}`);
		}
		return data as unknown;
	}

	async moveLead(leadId: string, stageId: string): Promise<unknown> {
		// Verify stage belongs to user's workspace
		const { data: stage } = await this.supabase
			.from('lead_stages')
			.select('id, created_by')
			.eq('id', stageId)
			.eq('created_by', this.authInfo.userId)
			.single();
		if (!stage) throw new Error('Stage not found or access denied');

		const { data, error } = await (this.supabase.from('leads') as any)
			.update({ stage_id: stageId })
			.eq('id', leadId)
			.select()
			.single();
		if (error) {
			if (error.code === 'PGRST116') throw new Error('Lead not found');
			throw new Error(`Failed to move lead: ${error.message}`);
		}
		return data as unknown;
	}

	async listLeadStages(): Promise<ProfitBotLeadStage[]> {
		const { data, error } = await this.supabase
			.from('lead_stages')
			.select('*')
			.eq('created_by', this.authInfo.userId)
			.order('sort_order', { ascending: true });
		if (error) throw new Error(`Failed to list stages: ${error.message}`);
		return (data ?? []) as ProfitBotLeadStage[];
	}

	async createLeadStage(name: string, sortOrder?: number): Promise<ProfitBotLeadStage> {
		const { data, error } = await (this.supabase.from('lead_stages') as any)
			.insert({
				name: name.trim(),
				sort_order: sortOrder ?? 999,
				created_by: this.authInfo.userId,
			})
			.select()
			.single();
		if (error) throw new Error(`Failed to create stage: ${error.message}`);
		return data as ProfitBotLeadStage;
	}

	async updateLeadStage(stageId: string, updates: Partial<ProfitBotLeadStage>): Promise<ProfitBotLeadStage> {
		const { data, error } = await (this.supabase.from('lead_stages') as any)
			.update(updates)
			.eq('id', stageId)
			.eq('created_by', this.authInfo.userId)
			.select()
			.single();
		if (error) {
			if (error.code === 'PGRST116') throw new Error('Stage not found');
			throw new Error(`Failed to update stage: ${error.message}`);
		}
		return data as ProfitBotLeadStage;
	}

	async deleteLeadStage(stageId: string): Promise<void> {
		// Get first other stage to reassign leads
		const { data: otherStages } = await this.supabase
			.from('lead_stages')
			.select('id')
			.eq('created_by', this.authInfo.userId)
			.neq('id', stageId)
			.order('sort_order', { ascending: true })
			.limit(1);

		const fallbackStageId = otherStages?.[0]?.id;

		if (fallbackStageId) {
			await this.supabase.from('leads').update({ stage_id: fallbackStageId }).eq('stage_id', stageId);
		} else {
			await this.supabase.from('leads').delete().eq('stage_id', stageId);
		}

		const { error } = await this.supabase
			.from('lead_stages')
			.delete()
			.eq('id', stageId)
			.eq('created_by', this.authInfo.userId);
		if (error) throw new Error(`Failed to delete stage: ${error.message}`);
	}

	// Conversation operations
	async listConversations(widgetId?: string): Promise<unknown[]> {
		let query = this.supabase
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
			.eq('widgets.workspace_id', this.authInfo.workspaceId);

		if (widgetId) {
			query = query.eq('widget_id', widgetId);
		}

		const { data, error } = await query.order('updated_at', { ascending: false });
		if (error) throw new Error(`Failed to list conversations: ${error.message}`);
		return (data ?? []) as unknown[];
	}

	async getConversation(conversationId: string): Promise<unknown | null> {
		const { data, error } = await this.supabase
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
			.eq('widgets.workspace_id', this.authInfo.workspaceId)
			.single();
		if (error) {
			if (error.code === 'PGRST116') return null;
			throw new Error(`Failed to get conversation: ${error.message}`);
		}
		return data as unknown;
	}

	async sendMessage(conversationId: string, content: string): Promise<unknown> {
		// Verify conversation belongs to workspace
		const { data: conv } = await this.supabase
			.from('widget_conversations')
			.select('id, widgets!inner(workspace_id)')
			.eq('id', conversationId)
			.eq('widgets.workspace_id', this.authInfo.workspaceId)
			.single();
		if (!conv) throw new Error('Conversation not found or access denied');

		const { data, error } = await (this.supabase.from('widget_conversation_messages') as any)
			.insert({
				conversation_id: conversationId,
				role: 'human_agent',
				content: content.trim(),
				created_by: this.authInfo.userId,
			})
			.select('id, role, content, created_at')
			.single();
		if (error) throw new Error(`Failed to send message: ${error.message}`);

		// Update conversation updated_at
		await this.supabase
			.from('widget_conversations')
			.update({ updated_at: new Date().toISOString() })
			.eq('id', conversationId);

		return data as unknown;
	}

	async getConversationMessages(conversationId: string, limit = 50): Promise<unknown[]> {
		// Verify conversation belongs to workspace
		const { data: conv } = await this.supabase
			.from('widget_conversations')
			.select('id, widgets!inner(workspace_id)')
			.eq('id', conversationId)
			.eq('widgets.workspace_id', this.authInfo.workspaceId)
			.single();
		if (!conv) throw new Error('Conversation not found or access denied');

		const { data, error } = await this.supabase
			.from('widget_conversation_messages')
			.select('*')
			.eq('conversation_id', conversationId)
			.order('created_at', { ascending: false })
			.limit(limit);
		if (error) throw new Error(`Failed to get messages: ${error.message}`);
		return (data ?? []) as unknown[];
	}

	// Contact operations (scoped via widgets)
	async listContacts(widgetId?: string, search?: string, limit = 50, page = 1): Promise<{
		contacts: unknown[];
		totalCount: number;
	}> {
		const offset = (page - 1) * limit;
		let query = this.supabase
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
			.eq('widgets.workspace_id', this.authInfo.workspaceId)
			.order('updated_at', { ascending: false })
			.range(offset, offset + limit - 1);

		if (widgetId) {
			query = query.eq('widget_id', widgetId);
		}
		if (search) {
			query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
		}

		const { data, error, count } = await query;
		if (error) throw new Error(`Failed to list contacts: ${error.message}`);
		return {
			contacts: (data ?? []) as unknown[],
			totalCount: count ?? 0,
		};
	}

	async getContact(contactId: string): Promise<unknown | null> {
		const { data, error } = await this.supabase
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
			.eq('widgets.workspace_id', this.authInfo.workspaceId)
			.single();
		if (error) {
			if (error.code === 'PGRST116') return null;
			throw new Error(`Failed to get contact: ${error.message}`);
		}
		return data as unknown;
	}
}

class ProfitBotMCPServer {
	private server: Server;
	private client: ProfitBotClient;
	private authInfo: AuthInfo;

	constructor() {
		const supabaseUrl = process.env.SUPABASE_URL;
		const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
		const mcpApiKey = process.env.MCP_API_KEY;

		if (!supabaseUrl || !serviceRoleKey) {
			throw new Error('Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
		}
		if (!mcpApiKey) {
			throw new Error('Missing required environment variable: MCP_API_KEY');
		}

		// Validate API key and get auth info (will be set in initialize)
		this.authInfo = { workspaceId: '', userId: '', apiKeyId: '' };
		this.client = new ProfitBotClient(supabaseUrl, serviceRoleKey, this.authInfo);

		this.server = new Server(
			{
				name: 'profitbot-mcp-server',
				version: '2.0.0',
			},
			{
				capabilities: {
					tools: {},
				},
			}
		);

		this.setupToolHandlers();
		this.setupErrorHandling();
	}

	private async initialize(): Promise<void> {
		const supabaseUrl = process.env.SUPABASE_URL!;
		const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
		const mcpApiKey = process.env.MCP_API_KEY!;

		const admin = createClient(supabaseUrl, serviceRoleKey);
		const { data, error } = await admin.rpc('validate_mcp_api_key', {
			p_api_key: mcpApiKey,
		});

		if (error || !data || data.length === 0) {
			throw new Error('Invalid MCP API key');
		}

		const authData = data[0] as { workspace_id: string; user_id: string; api_key_id: string };
		this.authInfo.workspaceId = authData.workspace_id;
		this.authInfo.userId = authData.user_id;
		this.authInfo.apiKeyId = authData.api_key_id;

		// Recreate client with auth info
		this.client = new ProfitBotClient(supabaseUrl, serviceRoleKey, this.authInfo);
	}

	private setupToolHandlers() {
		this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: [
				// Widget tools
				{
					name: 'list_widgets',
					description: 'List all widgets for the current workspace.',
					inputSchema: {
						type: 'object',
						properties: {},
					},
				},
				{
					name: 'get_widget',
					description: 'Get details of a specific widget by ID.',
					inputSchema: {
						type: 'object',
						properties: {
							widgetId: {
								type: 'string',
								description: 'The ID of the widget to retrieve',
							},
						},
						required: ['widgetId'],
					},
				},
				// Leadflow tools
				{
					name: 'list_leads',
					description: 'List all leads in the pipeline. Optionally filter by widget ID.',
					inputSchema: {
						type: 'object',
						properties: {
							widgetId: {
								type: 'string',
								description: 'Optional widget ID to filter leads',
							},
						},
					},
				},
				{
					name: 'get_lead',
					description: 'Get details of a specific lead by ID.',
					inputSchema: {
						type: 'object',
						properties: {
							leadId: {
								type: 'string',
								description: 'The ID of the lead to retrieve',
							},
						},
						required: ['leadId'],
					},
				},
				{
					name: 'move_lead',
					description: 'Move a lead to a different stage.',
					inputSchema: {
						type: 'object',
						properties: {
							leadId: {
								type: 'string',
								description: 'The ID of the lead to move',
							},
							stageId: {
								type: 'string',
								description: 'The ID of the target stage',
							},
						},
						required: ['leadId', 'stageId'],
					},
				},
				{
					name: 'list_lead_stages',
					description: 'List all lead stages in the pipeline.',
					inputSchema: {
						type: 'object',
						properties: {},
					},
				},
				{
					name: 'create_lead_stage',
					description: 'Create a new lead stage.',
					inputSchema: {
						type: 'object',
						properties: {
							name: {
								type: 'string',
								description: 'Stage name',
							},
							sortOrder: {
								type: 'number',
								description: 'Optional sort order (default: 999)',
							},
						},
						required: ['name'],
					},
				},
				{
					name: 'update_lead_stage',
					description: 'Update a lead stage (name or sort order).',
					inputSchema: {
						type: 'object',
						properties: {
							stageId: {
								type: 'string',
								description: 'The ID of the stage to update',
							},
							name: {
								type: 'string',
								description: 'New stage name',
							},
							sortOrder: {
								type: 'number',
								description: 'New sort order',
							},
						},
						required: ['stageId'],
					},
				},
				{
					name: 'delete_lead_stage',
					description: 'Delete a lead stage. Leads in this stage will be moved to the first remaining stage.',
					inputSchema: {
						type: 'object',
						properties: {
							stageId: {
								type: 'string',
								description: 'The ID of the stage to delete',
							},
						},
						required: ['stageId'],
					},
				},
				// Conversation tools
				{
					name: 'list_conversations',
					description: 'List conversations. Optionally filter by widget ID.',
					inputSchema: {
						type: 'object',
						properties: {
							widgetId: {
								type: 'string',
								description: 'Optional widget ID to filter conversations',
							},
						},
					},
				},
				{
					name: 'get_conversation',
					description: 'Get details of a specific conversation by ID.',
					inputSchema: {
						type: 'object',
						properties: {
							conversationId: {
								type: 'string',
								description: 'The ID of the conversation to retrieve',
							},
						},
						required: ['conversationId'],
					},
				},
				{
					name: 'send_message',
					description: 'Send a message as a human agent in a conversation.',
					inputSchema: {
						type: 'object',
						properties: {
							conversationId: {
								type: 'string',
								description: 'The ID of the conversation',
							},
							content: {
								type: 'string',
								description: 'Message content',
							},
						},
						required: ['conversationId', 'content'],
					},
				},
				{
					name: 'get_conversation_messages',
					description: 'Get messages from a conversation.',
					inputSchema: {
						type: 'object',
						properties: {
							conversationId: {
								type: 'string',
								description: 'The ID of the conversation',
							},
							limit: {
								type: 'number',
								description: 'Maximum number of messages (default: 50)',
								default: 50,
							},
						},
						required: ['conversationId'],
					},
				},
				// Contact tools
				{
					name: 'list_contacts',
					description: 'List contacts. Supports pagination and search.',
					inputSchema: {
						type: 'object',
						properties: {
							widgetId: {
								type: 'string',
								description: 'Optional widget ID to filter contacts',
							},
							search: {
								type: 'string',
								description: 'Optional search query (searches name and email)',
							},
							limit: {
								type: 'number',
								description: 'Number of contacts per page (default: 50, max: 50)',
								default: 50,
							},
							page: {
								type: 'number',
								description: 'Page number (default: 1)',
								default: 1,
							},
						},
					},
				},
				{
					name: 'get_contact',
					description: 'Get details of a specific contact by ID.',
					inputSchema: {
						type: 'object',
						properties: {
							contactId: {
								type: 'string',
								description: 'The ID of the contact to retrieve',
							},
						},
						required: ['contactId'],
					},
				},
			],
		}));

		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			const { name, arguments: args } = request.params;

			try {
				switch (name) {
					case 'list_widgets': {
						const widgets = await this.client.listWidgets();
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ widgets, count: widgets.length }, null, 2),
								},
							],
						};
					}

					case 'get_widget': {
						const widgetId = args?.widgetId as string;
						if (!widgetId) {
							throw new McpError(ErrorCode.InvalidParams, 'widgetId is required');
						}
						const widget = await this.client.getWidget(widgetId);
						if (!widget) {
							throw new McpError(ErrorCode.InvalidParams, 'Widget not found');
						}
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ widget }, null, 2),
								},
							],
						};
					}

					case 'list_leads': {
						const widgetId = args?.widgetId as string | undefined;
						const leads = await this.client.listLeads(widgetId);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ leads, count: leads.length }, null, 2),
								},
							],
						};
					}

					case 'get_lead': {
						const leadId = args?.leadId as string;
						if (!leadId) {
							throw new McpError(ErrorCode.InvalidParams, 'leadId is required');
						}
						const lead = await this.client.getLead(leadId);
						if (!lead) {
							throw new McpError(ErrorCode.InvalidParams, 'Lead not found');
						}
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ lead }, null, 2),
								},
							],
						};
					}

					case 'move_lead': {
						const leadId = args?.leadId as string;
						const stageId = args?.stageId as string;
						if (!leadId || !stageId) {
							throw new McpError(ErrorCode.InvalidParams, 'leadId and stageId are required');
						}
						const lead = await this.client.moveLead(leadId, stageId);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ lead, message: 'Lead moved successfully' }, null, 2),
								},
							],
						};
					}

					case 'list_lead_stages': {
						const stages = await this.client.listLeadStages();
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ stages, count: stages.length }, null, 2),
								},
							],
						};
					}

					case 'create_lead_stage': {
						const name = args?.name as string;
						const sortOrder = args?.sortOrder as number | undefined;
						if (!name) {
							throw new McpError(ErrorCode.InvalidParams, 'name is required');
						}
						const stage = await this.client.createLeadStage(name, sortOrder);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ stage }, null, 2),
								},
							],
						};
					}

					case 'update_lead_stage': {
						const stageId = args?.stageId as string;
						const name = args?.name as string | undefined;
						const sortOrder = args?.sortOrder as number | undefined;
						if (!stageId) {
							throw new McpError(ErrorCode.InvalidParams, 'stageId is required');
						}
						const updates: Partial<ProfitBotLeadStage> = {};
						if (name) updates.name = name;
						if (sortOrder !== undefined) updates.sort_order = sortOrder;
						const stage = await this.client.updateLeadStage(stageId, updates);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ stage }, null, 2),
								},
							],
						};
					}

					case 'delete_lead_stage': {
						const stageId = args?.stageId as string;
						if (!stageId) {
							throw new McpError(ErrorCode.InvalidParams, 'stageId is required');
						}
						await this.client.deleteLeadStage(stageId);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ success: true, message: 'Stage deleted' }, null, 2),
								},
							],
						};
					}

					case 'list_conversations': {
						const widgetId = args?.widgetId as string | undefined;
						const conversations = await this.client.listConversations(widgetId);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ conversations, count: conversations.length }, null, 2),
								},
							],
						};
					}

					case 'get_conversation': {
						const conversationId = args?.conversationId as string;
						if (!conversationId) {
							throw new McpError(ErrorCode.InvalidParams, 'conversationId is required');
						}
						const conversation = await this.client.getConversation(conversationId);
						if (!conversation) {
							throw new McpError(ErrorCode.InvalidParams, 'Conversation not found');
						}
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ conversation }, null, 2),
								},
							],
						};
					}

					case 'send_message': {
						const conversationId = args?.conversationId as string;
						const content = args?.content as string;
						if (!conversationId || !content) {
							throw new McpError(ErrorCode.InvalidParams, 'conversationId and content are required');
						}
						const message = await this.client.sendMessage(conversationId, content);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ message, success: true }, null, 2),
								},
							],
						};
					}

					case 'get_conversation_messages': {
						const conversationId = args?.conversationId as string;
						const limit = (args?.limit as number) || 50;
						if (!conversationId) {
							throw new McpError(ErrorCode.InvalidParams, 'conversationId is required');
						}
						const messages = await this.client.getConversationMessages(conversationId, limit);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ messages, count: messages.length }, null, 2),
								},
							],
						};
					}

					case 'list_contacts': {
						const widgetId = args?.widgetId as string | undefined;
						const search = args?.search as string | undefined;
						const limit = Math.min(50, (args?.limit as number) || 50);
						const page = Math.max(1, (args?.page as number) || 1);
						const result = await this.client.listContacts(widgetId, search, limit, page);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify(result, null, 2),
								},
							],
						};
					}

					case 'get_contact': {
						const contactId = args?.contactId as string;
						if (!contactId) {
							throw new McpError(ErrorCode.InvalidParams, 'contactId is required');
						}
						const contact = await this.client.getContact(contactId);
						if (!contact) {
							throw new McpError(ErrorCode.InvalidParams, 'Contact not found');
						}
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ contact }, null, 2),
								},
							],
						};
					}

					default:
						throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
				}
			} catch (error) {
				if (error instanceof McpError) {
					throw error;
				}
				const message = error instanceof Error ? error.message : 'Unknown error occurred';
				throw new McpError(ErrorCode.InternalError, message);
			}
		});
	}

	private setupErrorHandling() {
		this.server.onerror = (error) => {
			console.error('[MCP Error]', error);
		};

		process.on('SIGINT', async () => {
			await this.server.close();
			process.exit(0);
		});
	}

	async run() {
		// Initialize auth before starting
		await this.initialize();

		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		console.error(`ProfitBot MCP server running on stdio (workspace: ${this.authInfo.workspaceId})`);
	}
}

// Start the server
const server = new ProfitBotMCPServer();
server.run().catch((error) => {
	console.error('Failed to start server:', error);
	process.exit(1);
});
