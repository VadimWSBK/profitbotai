#!/usr/bin/env node
/**
 * MCP Server for ProfitBot
 * 
 * Exposes ProfitBot widgets, agents, team, analytics, contacts, and conversations
 * as MCP tools, allowing AI assistants like OpenClaw to control ProfitBot actions.
 * 
 * Usage:
 *   npx tsx mcp-servers/profitbot/index.ts
 * 
 * Environment variables:
 *   SUPABASE_URL - Your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Your Supabase service role key (for admin access)
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

interface ProfitBotWidget {
	id: string;
	name: string;
	display_mode: 'popup' | 'standalone' | 'embedded';
	config: Record<string, unknown>;
	n8n_webhook_url: string | null;
	created_at: string;
	updated_at: string;
	workspace_id?: string;
	created_by?: string;
}

interface ProfitBotAgent {
	id: string;
	name: string;
	description: string | null;
	system_prompt: string | null;
	chat_backend: string | null;
	n8n_webhook_url: string | null;
	bot_role: string | null;
	bot_tone: string | null;
	bot_instructions: string | null;
	created_at: string;
	updated_at: string;
	created_by?: string;
}

interface ProfitBotTeamMember {
	id: string;
	user_id: string;
	workspace_id: string;
	role: 'owner' | 'admin' | 'member';
	created_at: string;
}

interface ProfitBotContact {
	id: string;
	conversation_id: string | null;
	widget_id: string | null;
	name: string | null;
	email: string | null;
	phone: string | null;
	address: string | null;
	tags: string[];
	created_at: string;
	updated_at: string;
}

interface ProfitBotConversation {
	id: string;
	widget_id: string;
	session_id: string;
	is_ai_active: boolean;
	created_at: string;
	updated_at: string;
}

class ProfitBotClient {
	private supabase: ReturnType<typeof createClient>;

	constructor(supabaseUrl: string, serviceRoleKey: string) {
		this.supabase = createClient(supabaseUrl, serviceRoleKey);
	}

	// Widget operations
	async listWidgets(workspaceId?: string): Promise<ProfitBotWidget[]> {
		let query = this.supabase.from('widgets').select('*').order('updated_at', { ascending: false });
		if (workspaceId) {
			query = query.eq('workspace_id', workspaceId);
		}
		const { data, error } = await query;
		if (error) throw new Error(`Failed to list widgets: ${error.message}`);
		return (data ?? []) as ProfitBotWidget[];
	}

	async getWidget(id: string): Promise<ProfitBotWidget | null> {
		const { data, error } = await this.supabase
			.from('widgets')
			.select('*')
			.eq('id', id)
			.single();
		if (error) {
			if (error.code === 'PGRST116') return null;
			throw new Error(`Failed to get widget: ${error.message}`);
		}
		return data as ProfitBotWidget;
	}

	async createWidget(
		name: string,
		displayMode: 'popup' | 'standalone' | 'embedded',
		workspaceId: string,
		createdBy: string,
		config?: Record<string, unknown>,
		n8nWebhookUrl?: string
	): Promise<ProfitBotWidget> {
		const { data, error } = await (this.supabase
			.from('widgets') as any)
			.insert({
				name,
				display_mode: displayMode,
				config: config ?? {},
				n8n_webhook_url: n8nWebhookUrl ?? null,
				workspace_id: workspaceId,
				created_by: createdBy,
			})
			.select()
			.single();
		if (error) throw new Error(`Failed to create widget: ${error.message}`);
		return data as ProfitBotWidget;
	}

	async updateWidget(
		id: string,
		updates: Partial<ProfitBotWidget>
	): Promise<ProfitBotWidget> {
		const { data, error } = await (this.supabase
			.from('widgets') as any)
			.update(updates)
			.eq('id', id)
			.select()
			.single();
		if (error) {
			if (error.code === 'PGRST116') throw new Error('Widget not found');
			throw new Error(`Failed to update widget: ${error.message}`);
		}
		return data as ProfitBotWidget;
	}

	async deleteWidget(id: string): Promise<void> {
		const { error } = await this.supabase.from('widgets').delete().eq('id', id);
		if (error) {
			if (error.code === 'PGRST116') throw new Error('Widget not found');
			throw new Error(`Failed to delete widget: ${error.message}`);
		}
	}

	// Agent operations
	async listAgents(): Promise<ProfitBotAgent[]> {
		const { data, error } = await this.supabase
			.from('agents')
			.select('*')
			.order('updated_at', { ascending: false });
		if (error) throw new Error(`Failed to list agents: ${error.message}`);
		return (data ?? []) as ProfitBotAgent[];
	}

	async getAgent(id: string): Promise<ProfitBotAgent | null> {
		const { data, error } = await this.supabase
			.from('agents')
			.select('*')
			.eq('id', id)
			.single();
		if (error) {
			if (error.code === 'PGRST116') return null;
			throw new Error(`Failed to get agent: ${error.message}`);
		}
		return data as ProfitBotAgent;
	}

	async createAgent(
		name: string,
		createdBy: string,
		description?: string,
		systemPrompt?: string
	): Promise<ProfitBotAgent> {
		const { data, error } = await (this.supabase
			.from('agents') as any)
			.insert({
				name,
				description: description ?? null,
				system_prompt: systemPrompt ?? null,
				created_by: createdBy,
			})
			.select()
			.single();
		if (error) throw new Error(`Failed to create agent: ${error.message}`);
		return data as ProfitBotAgent;
	}

	async updateAgent(id: string, updates: Partial<ProfitBotAgent>): Promise<ProfitBotAgent> {
		const { data, error } = await (this.supabase
			.from('agents') as any)
			.update(updates)
			.eq('id', id)
			.select()
			.single();
		if (error) {
			if (error.code === 'PGRST116') throw new Error('Agent not found');
			throw new Error(`Failed to update agent: ${error.message}`);
		}
		return data as ProfitBotAgent;
	}

	async deleteAgent(id: string): Promise<void> {
		const { error } = await this.supabase.from('agents').delete().eq('id', id);
		if (error) {
			if (error.code === 'PGRST116') throw new Error('Agent not found');
			throw new Error(`Failed to delete agent: ${error.message}`);
		}
	}

	// Team operations
	async listTeamMembers(workspaceId: string): Promise<ProfitBotTeamMember[]> {
		const { data, error } = await this.supabase
			.from('team_members')
			.select('*')
			.eq('workspace_id', workspaceId)
			.order('created_at', { ascending: true });
		if (error) throw new Error(`Failed to list team members: ${error.message}`);
		return (data ?? []) as ProfitBotTeamMember[];
	}

	async getWorkspaceId(userId: string): Promise<string | null> {
		const { data, error } = await this.supabase
			.from('profiles')
			.select('workspace_id')
			.eq('user_id', userId)
			.single();
		if (error || !data) return null;
		return (data as { workspace_id: string }).workspace_id;
	}

	// Analytics operations
	async getWidgetEvents(
		widgetId?: string,
		from?: string,
		to?: string,
		limit = 500
	): Promise<unknown[]> {
		let query = this.supabase
			.from('widget_events')
			.select('*')
			.order('created_at', { ascending: false })
			.limit(limit);
		if (widgetId) query = query.eq('widget_id', widgetId);
		if (from) query = query.gte('created_at', from);
		if (to) query = query.lte('created_at', to);
		const { data, error } = await query;
		if (error) throw new Error(`Failed to get events: ${error.message}`);
		return (data ?? []) as unknown[];
	}

	// Contact operations
	async listContacts(
		widgetId?: string,
		search?: string,
		limit = 50,
		page = 1
	): Promise<{ contacts: ProfitBotContact[]; totalCount: number }> {
		const offset = (page - 1) * limit;
		let query = this.supabase
			.from('contacts')
			.select('*', { count: 'exact' })
			.order('updated_at', { ascending: false })
			.range(offset, offset + limit - 1);
		if (widgetId) query = query.eq('widget_id', widgetId);
		if (search) {
			query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
		}
		const { data, error, count } = await query;
		if (error) throw new Error(`Failed to list contacts: ${error.message}`);
		return {
			contacts: (data ?? []) as ProfitBotContact[],
			totalCount: count ?? 0,
		};
	}

	async getContact(id: string): Promise<ProfitBotContact | null> {
		const { data, error } = await this.supabase
			.from('contacts')
			.select('*')
			.eq('id', id)
			.single();
		if (error) {
			if (error.code === 'PGRST116') return null;
			throw new Error(`Failed to get contact: ${error.message}`);
		}
		return data as ProfitBotContact;
	}

	// Conversation operations
	async listConversations(widgetId?: string): Promise<ProfitBotConversation[]> {
		let query = this.supabase
			.from('widget_conversations')
			.select('*')
			.order('updated_at', { ascending: false });
		if (widgetId) query = query.eq('widget_id', widgetId);
		const { data, error } = await query;
		if (error) throw new Error(`Failed to list conversations: ${error.message}`);
		return (data ?? []) as ProfitBotConversation[];
	}

	async getConversation(id: string): Promise<ProfitBotConversation | null> {
		const { data, error } = await this.supabase
			.from('widget_conversations')
			.select('*')
			.eq('id', id)
			.single();
		if (error) {
			if (error.code === 'PGRST116') return null;
			throw new Error(`Failed to get conversation: ${error.message}`);
		}
		return data as ProfitBotConversation;
	}

	// Document/training operations
	async getWidgetDocuments(widgetId: string): Promise<unknown[]> {
		const { data, error } = await this.supabase
			.from('widget_documents')
			.select('id, widget_id, metadata, created_at')
			.eq('widget_id', widgetId)
			.order('created_at', { ascending: false });
		if (error) {
			// Table might not exist
			if (error.code === '42P01') return [];
			throw new Error(`Failed to get documents: ${error.message}`);
		}
		return (data ?? []) as unknown[];
	}

	async countWidgetDocuments(widgetId: string): Promise<number> {
		const { count, error } = await this.supabase
			.from('widget_documents')
			.select('*', { count: 'exact', head: true })
			.eq('widget_id', widgetId);
		if (error) {
			if (error.code === '42P01') return 0;
			throw new Error(`Failed to count documents: ${error.message}`);
		}
		return count ?? 0;
	}
}

class ProfitBotMCPServer {
	private server: Server;
	private client: ProfitBotClient;

	constructor() {
		const supabaseUrl = process.env.SUPABASE_URL;
		const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

		if (!supabaseUrl || !serviceRoleKey) {
			throw new Error(
				'Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
			);
		}

		this.client = new ProfitBotClient(supabaseUrl, serviceRoleKey);
		this.server = new Server(
			{
				name: 'profitbot-mcp-server',
				version: '1.0.0',
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

	private setupToolHandlers() {
		this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: [
				// Widget tools
				{
					name: 'list_widgets',
					description: 'List all widgets in ProfitBot. Optionally filter by workspace ID.',
					inputSchema: {
						type: 'object',
						properties: {
							workspaceId: {
								type: 'string',
								description: 'Optional workspace ID to filter widgets',
							},
						},
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
				{
					name: 'create_widget',
					description: 'Create a new widget in ProfitBot.',
					inputSchema: {
						type: 'object',
						properties: {
							name: {
								type: 'string',
								description: 'Widget name',
							},
							displayMode: {
								type: 'string',
								enum: ['popup', 'standalone', 'embedded'],
								description: 'Display mode for the widget',
							},
							workspaceId: {
								type: 'string',
								description: 'Workspace ID to create the widget in',
							},
							createdBy: {
								type: 'string',
								description: 'User ID of the creator',
							},
							config: {
								type: 'object',
								description: 'Optional widget configuration (JSON object)',
							},
							n8nWebhookUrl: {
								type: 'string',
								description: 'Optional n8n webhook URL',
							},
						},
						required: ['name', 'displayMode', 'workspaceId', 'createdBy'],
					},
				},
				{
					name: 'update_widget',
					description: 'Update an existing widget.',
					inputSchema: {
						type: 'object',
						properties: {
							widgetId: {
								type: 'string',
								description: 'The ID of the widget to update',
							},
							name: {
								type: 'string',
								description: 'New widget name',
							},
							displayMode: {
								type: 'string',
								enum: ['popup', 'standalone', 'embedded'],
								description: 'New display mode',
							},
							config: {
								type: 'object',
								description: 'Updated widget configuration (JSON object)',
							},
							n8nWebhookUrl: {
								type: 'string',
								description: 'Updated n8n webhook URL',
							},
						},
						required: ['widgetId'],
					},
				},
				{
					name: 'delete_widget',
					description: 'Delete a widget by ID.',
					inputSchema: {
						type: 'object',
						properties: {
							widgetId: {
								type: 'string',
								description: 'The ID of the widget to delete',
							},
						},
						required: ['widgetId'],
					},
				},
				// Agent tools
				{
					name: 'list_agents',
					description: 'List all agents in ProfitBot.',
					inputSchema: {
						type: 'object',
						properties: {},
					},
				},
				{
					name: 'get_agent',
					description: 'Get details of a specific agent by ID.',
					inputSchema: {
						type: 'object',
						properties: {
							agentId: {
								type: 'string',
								description: 'The ID of the agent to retrieve',
							},
						},
						required: ['agentId'],
					},
				},
				{
					name: 'create_agent',
					description: 'Create a new agent in ProfitBot.',
					inputSchema: {
						type: 'object',
						properties: {
							name: {
								type: 'string',
								description: 'Agent name',
							},
							createdBy: {
								type: 'string',
								description: 'User ID of the creator',
							},
							description: {
								type: 'string',
								description: 'Optional agent description',
							},
							systemPrompt: {
								type: 'string',
								description: 'Optional system prompt for the agent',
							},
						},
						required: ['name', 'createdBy'],
					},
				},
				{
					name: 'update_agent',
					description: 'Update an existing agent.',
					inputSchema: {
						type: 'object',
						properties: {
							agentId: {
								type: 'string',
								description: 'The ID of the agent to update',
							},
							name: {
								type: 'string',
								description: 'New agent name',
							},
							description: {
								type: 'string',
								description: 'New agent description',
							},
							systemPrompt: {
								type: 'string',
								description: 'New system prompt',
							},
							chatBackend: {
								type: 'string',
								description: 'Chat backend (e.g., "n8n", "openai")',
							},
							n8nWebhookUrl: {
								type: 'string',
								description: 'n8n webhook URL',
							},
							botRole: {
								type: 'string',
								description: 'Bot role description',
							},
							botTone: {
								type: 'string',
								description: 'Bot tone',
							},
							botInstructions: {
								type: 'string',
								description: 'Additional bot instructions',
							},
						},
						required: ['agentId'],
					},
				},
				{
					name: 'delete_agent',
					description: 'Delete an agent by ID.',
					inputSchema: {
						type: 'object',
						properties: {
							agentId: {
								type: 'string',
								description: 'The ID of the agent to delete',
							},
						},
						required: ['agentId'],
					},
				},
				// Team tools
				{
					name: 'list_team_members',
					description: 'List team members for a workspace.',
					inputSchema: {
						type: 'object',
						properties: {
							workspaceId: {
								type: 'string',
								description: 'Workspace ID to list members for',
							},
						},
						required: ['workspaceId'],
					},
				},
				{
					name: 'get_workspace_id',
					description: 'Get workspace ID for a user.',
					inputSchema: {
						type: 'object',
						properties: {
							userId: {
								type: 'string',
								description: 'User ID to get workspace for',
							},
						},
						required: ['userId'],
					},
				},
				// Analytics tools
				{
					name: 'get_widget_events',
					description: 'Get widget analytics events. Optionally filter by widget ID and date range.',
					inputSchema: {
						type: 'object',
						properties: {
							widgetId: {
								type: 'string',
								description: 'Optional widget ID to filter events',
							},
							from: {
								type: 'string',
								description: 'Optional start date (ISO 8601 format)',
							},
							to: {
								type: 'string',
								description: 'Optional end date (ISO 8601 format)',
							},
							limit: {
								type: 'number',
								description: 'Maximum number of events to return (default: 500)',
								default: 500,
							},
						},
					},
				},
				// Contact tools
				{
					name: 'list_contacts',
					description: 'List contacts. Supports pagination and filtering.',
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
				// Training/document tools
				{
					name: 'get_widget_documents',
					description: 'Get documents/training data for a widget.',
					inputSchema: {
						type: 'object',
						properties: {
							widgetId: {
								type: 'string',
								description: 'Widget ID to get documents for',
							},
						},
						required: ['widgetId'],
					},
				},
				{
					name: 'count_widget_documents',
					description: 'Get count of documents/training data for a widget.',
					inputSchema: {
						type: 'object',
						properties: {
							widgetId: {
								type: 'string',
								description: 'Widget ID to count documents for',
							},
						},
						required: ['widgetId'],
					},
				},
			],
		}));

		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			const { name, arguments: args } = request.params;

			try {
				switch (name) {
					// Widget operations
					case 'list_widgets': {
						const widgets = await this.client.listWidgets(
							args?.workspaceId as string | undefined
						);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify(
										{
											widgets: widgets.map((w) => ({
												id: w.id,
												name: w.name,
												displayMode: w.display_mode,
												n8nWebhookUrl: w.n8n_webhook_url,
												createdAt: w.created_at,
												updatedAt: w.updated_at,
											})),
											count: widgets.length,
										},
										null,
										2
									),
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
									text: JSON.stringify(widget, null, 2),
								},
							],
						};
					}

					case 'create_widget': {
						const name = args?.name as string;
						const displayMode = args?.displayMode as 'popup' | 'standalone' | 'embedded';
						const workspaceId = args?.workspaceId as string;
						const createdBy = args?.createdBy as string;
						const config = args?.config as Record<string, unknown> | undefined;
						const n8nWebhookUrl = args?.n8nWebhookUrl as string | undefined;

						if (!name || !displayMode || !workspaceId || !createdBy) {
							throw new McpError(
								ErrorCode.InvalidParams,
								'name, displayMode, workspaceId, and createdBy are required'
							);
						}

						const widget = await this.client.createWidget(
							name,
							displayMode,
							workspaceId,
							createdBy,
							config,
							n8nWebhookUrl
						);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ widget }, null, 2),
								},
							],
						};
					}

					case 'update_widget': {
						const widgetId = args?.widgetId as string;
						if (!widgetId) {
							throw new McpError(ErrorCode.InvalidParams, 'widgetId is required');
						}

						const updates: Partial<ProfitBotWidget> = {};
						if (args?.name) updates.name = args.name as string;
						if (args?.displayMode) {
							updates.display_mode = args.displayMode as 'popup' | 'standalone' | 'embedded';
						}
						if (args?.config) updates.config = args.config as Record<string, unknown>;
						if (args?.n8nWebhookUrl !== undefined) {
							updates.n8n_webhook_url = (args.n8nWebhookUrl as string) || null;
						}

						const widget = await this.client.updateWidget(widgetId, updates);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ widget }, null, 2),
								},
							],
						};
					}

					case 'delete_widget': {
						const widgetId = args?.widgetId as string;
						if (!widgetId) {
							throw new McpError(ErrorCode.InvalidParams, 'widgetId is required');
						}
						await this.client.deleteWidget(widgetId);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ success: true, message: 'Widget deleted' }, null, 2),
								},
							],
						};
					}

					// Agent operations
					case 'list_agents': {
						const agents = await this.client.listAgents();
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify(
										{
											agents: agents.map((a) => ({
												id: a.id,
												name: a.name,
												description: a.description,
												createdAt: a.created_at,
												updatedAt: a.updated_at,
											})),
											count: agents.length,
										},
										null,
										2
									),
								},
							],
						};
					}

					case 'get_agent': {
						const agentId = args?.agentId as string;
						if (!agentId) {
							throw new McpError(ErrorCode.InvalidParams, 'agentId is required');
						}
						const agent = await this.client.getAgent(agentId);
						if (!agent) {
							throw new McpError(ErrorCode.InvalidParams, 'Agent not found');
						}
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify(agent, null, 2),
								},
							],
						};
					}

					case 'create_agent': {
						const name = args?.name as string;
						const createdBy = args?.createdBy as string;
						const description = args?.description as string | undefined;
						const systemPrompt = args?.systemPrompt as string | undefined;

						if (!name || !createdBy) {
							throw new McpError(ErrorCode.InvalidParams, 'name and createdBy are required');
						}

						const agent = await this.client.createAgent(name, createdBy, description, systemPrompt);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ agent }, null, 2),
								},
							],
						};
					}

					case 'update_agent': {
						const agentId = args?.agentId as string;
						if (!agentId) {
							throw new McpError(ErrorCode.InvalidParams, 'agentId is required');
						}

						const updates: Partial<ProfitBotAgent> = {};
						if (args?.name) updates.name = args.name as string;
						if (args?.description !== undefined) updates.description = args.description as string | null;
						if (args?.systemPrompt !== undefined) {
							updates.system_prompt = args.systemPrompt as string | null;
						}
						if (args?.chatBackend) updates.chat_backend = args.chatBackend as string;
						if (args?.n8nWebhookUrl !== undefined) {
							updates.n8n_webhook_url = (args.n8nWebhookUrl as string) || null;
						}
						if (args?.botRole) updates.bot_role = args.botRole as string;
						if (args?.botTone) updates.bot_tone = args.botTone as string;
						if (args?.botInstructions) updates.bot_instructions = args.botInstructions as string;

						const agent = await this.client.updateAgent(agentId, updates);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ agent }, null, 2),
								},
							],
						};
					}

					case 'delete_agent': {
						const agentId = args?.agentId as string;
						if (!agentId) {
							throw new McpError(ErrorCode.InvalidParams, 'agentId is required');
						}
						await this.client.deleteAgent(agentId);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ success: true, message: 'Agent deleted' }, null, 2),
								},
							],
						};
					}

					// Team operations
					case 'list_team_members': {
						const workspaceId = args?.workspaceId as string;
						if (!workspaceId) {
							throw new McpError(ErrorCode.InvalidParams, 'workspaceId is required');
						}
						const members = await this.client.listTeamMembers(workspaceId);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ members, count: members.length }, null, 2),
								},
							],
						};
					}

					case 'get_workspace_id': {
						const userId = args?.userId as string;
						if (!userId) {
							throw new McpError(ErrorCode.InvalidParams, 'userId is required');
						}
						const workspaceId = await this.client.getWorkspaceId(userId);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ userId, workspaceId }, null, 2),
								},
							],
						};
					}

					// Analytics operations
					case 'get_widget_events': {
						const widgetId = args?.widgetId as string | undefined;
						const from = args?.from as string | undefined;
						const to = args?.to as string | undefined;
						const limit = (args?.limit as number) || 500;
						const events = await this.client.getWidgetEvents(widgetId, from, to, limit);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ events, count: events.length }, null, 2),
								},
							],
						};
					}

					// Contact operations
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

					// Conversation operations
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

					// Training/document operations
					case 'get_widget_documents': {
						const widgetId = args?.widgetId as string;
						if (!widgetId) {
							throw new McpError(ErrorCode.InvalidParams, 'widgetId is required');
						}
						const documents = await this.client.getWidgetDocuments(widgetId);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ documents, count: documents.length }, null, 2),
								},
							],
						};
					}

					case 'count_widget_documents': {
						const widgetId = args?.widgetId as string;
						if (!widgetId) {
							throw new McpError(ErrorCode.InvalidParams, 'widgetId is required');
						}
						const count = await this.client.countWidgetDocuments(widgetId);
						return {
							content: [
								{
									type: 'text',
									text: JSON.stringify({ widgetId, documentCount: count }, null, 2),
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
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		console.error('ProfitBot MCP server running on stdio');
	}
}

// Start the server
const server = new ProfitBotMCPServer();
server.run().catch((error) => {
	console.error('Failed to start server:', error);
	process.exit(1);
});
