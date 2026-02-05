#!/usr/bin/env node
/**
 * MCP Server for N8N
 * 
 * Exposes N8N workflows and executions as MCP tools, allowing AI assistants
 * to interact with your N8N instance through a single MCP connection.
 * 
 * Usage:
 *   npx tsx mcp-servers/n8n/index.ts
 * 
 * Environment variables:
 *   N8N_BASE_URL - Your N8N instance URL (e.g., https://n8n.example.com)
 *   N8N_API_KEY - Your N8N API key (from Settings > n8n API)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	ErrorCode,
	McpError,
} from '@modelcontextprotocol/sdk/types.js';

interface N8NWorkflow {
	id: string;
	name: string;
	active: boolean;
	createdAt: string;
	updatedAt: string;
	nodes?: unknown[];
	settings?: Record<string, unknown>;
	tags?: Array<{ id: string; name: string }>;
}

interface N8NExecution {
	id: string;
	finished: boolean;
	mode: string;
	retryOf?: string;
	retrySuccessId?: string;
	startedAt: string;
	stoppedAt?: string;
	workflowId: string;
	workflowData?: {
		name?: string;
	};
	data?: {
		resultData?: {
			runData?: Record<string, unknown[]>;
		};
	};
}

class N8NClient {
	private baseUrl: string;
	private apiKey: string;

	constructor(baseUrl: string, apiKey: string) {
		this.baseUrl = baseUrl.replace(/\/$/, '');
		this.apiKey = apiKey;
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown
	): Promise<T> {
		const url = `${this.baseUrl}/api/v1${path}`;
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'X-N8N-API-KEY': this.apiKey,
		};

		const response = await fetch(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			throw new Error(
				`N8N API error (${response.status}): ${errorText}`
			);
		}

		return response.json() as Promise<T>;
	}

	async listWorkflows(active?: boolean): Promise<N8NWorkflow[]> {
		const params = active !== undefined ? `?active=${active}` : '';
		const response = await this.request<{ data: N8NWorkflow[] }>(
			'GET',
			`/workflows${params}`
		);
		return response.data || [];
	}

	async getWorkflow(id: string): Promise<N8NWorkflow> {
		return this.request<N8NWorkflow>('GET', `/workflows/${id}`);
	}

	async executeWorkflow(
		id: string,
		inputData?: Record<string, unknown>
	): Promise<N8NExecution> {
		return this.request<N8NExecution>('POST', `/workflows/${id}/execute`, {
			inputData: inputData || {},
		});
	}

	async listExecutions(
		workflowId?: string,
		limit = 20
	): Promise<N8NExecution[]> {
		const params = new URLSearchParams();
		if (workflowId) params.append('workflowId', workflowId);
		params.append('limit', limit.toString());
		const query = params.toString();
		const response = await this.request<{ data: N8NExecution[] }>(
			'GET',
			`/executions${query ? `?${query}` : ''}`
		);
		return response.data || [];
	}

	async getExecution(id: string): Promise<N8NExecution> {
		return this.request<N8NExecution>('GET', `/executions/${id}`);
	}
}

class N8NMCPServer {
	private server: Server;
	private n8nClient: N8NClient;

	constructor() {
		const baseUrl = process.env.N8N_BASE_URL;
		const apiKey = process.env.N8N_API_KEY;

		if (!baseUrl || !apiKey) {
			throw new Error(
				'Missing required environment variables: N8N_BASE_URL and N8N_API_KEY'
			);
		}

		this.n8nClient = new N8NClient(baseUrl, apiKey);
		this.server = new Server(
			{
				name: 'n8n-mcp-server',
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
				{
					name: 'list_workflows',
					description:
						'List all workflows in N8N. Optionally filter by active status.',
					inputSchema: {
						type: 'object',
						properties: {
							active: {
								type: 'boolean',
								description:
									'Filter by active status. If true, only active workflows. If false, only inactive. If omitted, all workflows.',
							},
						},
					},
				},
				{
					name: 'get_workflow',
					description: 'Get details of a specific workflow by ID.',
					inputSchema: {
						type: 'object',
						properties: {
							workflowId: {
								type: 'string',
								description: 'The ID of the workflow to retrieve',
							},
						},
						required: ['workflowId'],
					},
				},
				{
					name: 'execute_workflow',
					description:
						'Execute a workflow by ID. Optionally provide input data.',
					inputSchema: {
						type: 'object',
						properties: {
							workflowId: {
								type: 'string',
								description: 'The ID of the workflow to execute',
							},
							inputData: {
								type: 'object',
								description:
									'Optional input data to pass to the workflow (JSON object)',
							},
						},
						required: ['workflowId'],
					},
				},
				{
					name: 'list_executions',
					description:
						'List workflow executions. Optionally filter by workflow ID.',
					inputSchema: {
						type: 'object',
						properties: {
							workflowId: {
								type: 'string',
								description:
									'Optional workflow ID to filter executions',
							},
							limit: {
								type: 'number',
								description:
									'Maximum number of executions to return (default: 20)',
								default: 20,
							},
						},
					},
				},
				{
					name: 'get_execution',
					description: 'Get details of a specific execution by ID.',
					inputSchema: {
						type: 'object',
						properties: {
							executionId: {
								type: 'string',
								description: 'The ID of the execution to retrieve',
							},
						},
						required: ['executionId'],
					},
				},
			],
		}));

		this.server.setRequestHandler(
			CallToolRequestSchema,
			async (request) => {
				const { name, arguments: args } = request.params;

				try {
					switch (name) {
						case 'list_workflows': {
							const workflows = await this.n8nClient.listWorkflows(
								args?.active as boolean | undefined
							);
							return {
								content: [
									{
										type: 'text',
										text: JSON.stringify(
											{
												workflows: workflows.map((w) => ({
													id: w.id,
													name: w.name,
													active: w.active,
													createdAt: w.createdAt,
													updatedAt: w.updatedAt,
													tags: w.tags,
												})),
												count: workflows.length,
											},
											null,
											2
										),
									},
								],
							};
						}

						case 'get_workflow': {
							const workflowId = args?.workflowId as string;
							if (!workflowId) {
								throw new McpError(
									ErrorCode.InvalidParams,
									'workflowId is required'
								);
							}
							const workflow = await this.n8nClient.getWorkflow(
								workflowId
							);
							return {
								content: [
									{
										type: 'text',
										text: JSON.stringify(workflow, null, 2),
									},
								],
							};
						}

						case 'execute_workflow': {
							const workflowId = args?.workflowId as string;
							const inputData = args?.inputData as
								| Record<string, unknown>
								| undefined;
							if (!workflowId) {
								throw new McpError(
									ErrorCode.InvalidParams,
									'workflowId is required'
								);
							}
							const execution = await this.n8nClient.executeWorkflow(
								workflowId,
								inputData
							);
							return {
								content: [
									{
										type: 'text',
										text: JSON.stringify(
											{
												executionId: execution.id,
												workflowId: execution.workflowId,
												finished: execution.finished,
												mode: execution.mode,
												startedAt: execution.startedAt,
												stoppedAt: execution.stoppedAt,
											},
											null,
											2
										),
									},
								],
							};
						}

						case 'list_executions': {
							const workflowId = args?.workflowId as
								| string
								| undefined;
							const limit = (args?.limit as number) || 20;
							const executions =
								await this.n8nClient.listExecutions(
									workflowId,
									limit
								);
							return {
								content: [
									{
										type: 'text',
										text: JSON.stringify(
											{
												executions: executions.map((e) => ({
													id: e.id,
													workflowId: e.workflowId,
													workflowName: e.workflowData?.name,
													finished: e.finished,
													mode: e.mode,
													startedAt: e.startedAt,
													stoppedAt: e.stoppedAt,
												})),
												count: executions.length,
											},
											null,
											2
										),
									},
								],
							};
						}

						case 'get_execution': {
							const executionId = args?.executionId as string;
							if (!executionId) {
								throw new McpError(
									ErrorCode.InvalidParams,
									'executionId is required'
								);
							}
							const execution = await this.n8nClient.getExecution(
								executionId
							);
							return {
								content: [
									{
										type: 'text',
										text: JSON.stringify(execution, null, 2),
									},
								],
							};
						}

						default:
							throw new McpError(
								ErrorCode.MethodNotFound,
								`Unknown tool: ${name}`
							);
					}
				} catch (error) {
					if (error instanceof McpError) {
						throw error;
					}
					const message =
						error instanceof Error
							? error.message
							: 'Unknown error occurred';
					throw new McpError(ErrorCode.InternalError, message);
				}
			}
		);
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
		console.error('N8N MCP server running on stdio');
	}
}

// Start the server
const server = new N8NMCPServer();
server.run().catch((error) => {
	console.error('Failed to start server:', error);
	process.exit(1);
});
