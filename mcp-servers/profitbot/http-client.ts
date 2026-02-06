#!/usr/bin/env node
/**
 * ProfitBot MCP HTTP Client
 * 
 * This is a local wrapper that OpenClaw can run. It connects to the ProfitBot
 * HTTP API at app.profitbot.ai and translates between stdio MCP protocol and HTTP.
 * 
 * Usage:
 *   npx tsx mcp-servers/profitbot/http-client.ts
 * 
 * Environment variables:
 *   MCP_API_KEY - Your MCP API key (from ProfitBot dashboard)
 *   PROFITBOT_API_URL - Optional, defaults to https://app.profitbot.ai
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	ErrorCode,
	McpError,
} from '@modelcontextprotocol/sdk/types.js';

const PROFITBOT_API_URL = process.env.PROFITBOT_API_URL || 'https://app.profitbot.ai';
const MCP_API_KEY = process.env.MCP_API_KEY;

if (!MCP_API_KEY) {
	throw new Error('Missing required environment variable: MCP_API_KEY');
}

async function callProfitBotAPI(action: string, params: Record<string, unknown>): Promise<unknown> {
	const response = await fetch(`${PROFITBOT_API_URL}/api/mcp`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-MCP-API-Key': MCP_API_KEY,
		},
		body: JSON.stringify({ action, ...params }),
	});

	const data = await response.json();

	if (!response.ok) {
		throw new Error(data.error || `HTTP ${response.status}`);
	}

	if (!data.success) {
		throw new Error(data.error || 'API call failed');
	}

	return data.data;
}

class ProfitBotMCPClient {
	private server: Server;

	constructor() {
		this.server = new Server(
			{
				name: 'profitbot-mcp-http-client',
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

	private setupToolHandlers() {
		this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: [
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
				{
					name: 'send_email',
					description: 'Send an email to a contact. Requires either conversationId or contactId.',
					inputSchema: {
						type: 'object',
						properties: {
							conversationId: {
								type: 'string',
								description: 'The ID of the conversation (optional if contactId provided)',
							},
							contactId: {
								type: 'string',
								description: 'The ID of the contact (optional if conversationId provided)',
							},
							subject: {
								type: 'string',
								description: 'Email subject',
							},
							body: {
								type: 'string',
								description: 'Email body content',
							},
						},
						required: ['subject', 'body'],
					},
				},
				{
					name: 'list_email_templates',
					description: 'List all email templates for the current workspace.',
					inputSchema: {
						type: 'object',
						properties: {},
					},
				},
				{
					name: 'get_email_template',
					description: 'Get details of a specific email template by ID.',
					inputSchema: {
						type: 'object',
						properties: {
							templateId: {
								type: 'string',
								description: 'The ID of the template to retrieve',
							},
						},
						required: ['templateId'],
					},
				},
				{
					name: 'create_email_template',
					description: 'Create a new email template.',
					inputSchema: {
						type: 'object',
						properties: {
							name: {
								type: 'string',
								description: 'Template name',
							},
							subject: {
								type: 'string',
								description: 'Email subject template',
							},
							body: {
								type: 'string',
								description: 'Email body template',
							},
						},
						required: ['name'],
					},
				},
				{
					name: 'update_email_template',
					description: 'Update an email template (name, subject, or body).',
					inputSchema: {
						type: 'object',
						properties: {
							templateId: {
								type: 'string',
								description: 'The ID of the template to update',
							},
							name: {
								type: 'string',
								description: 'New template name',
							},
							subject: {
								type: 'string',
								description: 'New email subject template',
							},
							body: {
								type: 'string',
								description: 'New email body template',
							},
						},
						required: ['templateId'],
					},
				},
				{
					name: 'delete_email_template',
					description: 'Delete an email template.',
					inputSchema: {
						type: 'object',
						properties: {
							templateId: {
								type: 'string',
								description: 'The ID of the template to delete',
							},
						},
						required: ['templateId'],
					},
				},
				{
					name: 'list_emails',
					description: 'List emails for a contact or conversation. Supports pagination.',
					inputSchema: {
						type: 'object',
						properties: {
							contactId: {
								type: 'string',
								description: 'Filter by contact ID (optional if conversationId provided)',
							},
							conversationId: {
								type: 'string',
								description: 'Filter by conversation ID (optional if contactId provided)',
							},
							limit: {
								type: 'number',
								description: 'Number of emails per page (default: 50, max: 100)',
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
					name: 'get_email',
					description: 'Get details of a specific email by ID.',
					inputSchema: {
						type: 'object',
						properties: {
							emailId: {
								type: 'string',
								description: 'The ID of the email to retrieve',
							},
						},
						required: ['emailId'],
					},
				},
			],
		}));

		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			const { name, arguments: args } = request.params;

			try {
				// Map MCP tool names to API actions
				const actionMap: Record<string, string> = {
					list_widgets: 'list_widgets',
					get_widget: 'get_widget',
					list_leads: 'list_leads',
					get_lead: 'get_lead',
					move_lead: 'move_lead',
					list_lead_stages: 'list_lead_stages',
					create_lead_stage: 'create_lead_stage',
					update_lead_stage: 'update_lead_stage',
					delete_lead_stage: 'delete_lead_stage',
					list_conversations: 'list_conversations',
					get_conversation: 'get_conversation',
					send_message: 'send_message',
					get_conversation_messages: 'get_conversation_messages',
					list_contacts: 'list_contacts',
					get_contact: 'get_contact',
					send_email: 'send_email',
					list_email_templates: 'list_email_templates',
					get_email_template: 'get_email_template',
					create_email_template: 'create_email_template',
					update_email_template: 'update_email_template',
					delete_email_template: 'delete_email_template',
					list_emails: 'list_emails',
					get_email: 'get_email',
				};

				const action = actionMap[name];
				if (!action) {
					throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
				}

				// Pass arguments directly to API (both use camelCase)
				const params: Record<string, unknown> = args || {};

				const result = await callProfitBotAPI(action, params);

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(result, null, 2),
						},
					],
				};
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
		console.error(`ProfitBot MCP HTTP client running (connecting to ${PROFITBOT_API_URL})`);
	}
}

// Start the server
const client = new ProfitBotMCPClient();
client.run().catch((error) => {
	console.error('Failed to start client:', error);
	process.exit(1);
});
