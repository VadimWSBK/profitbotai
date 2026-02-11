/**
 * ProfitBot MCP Server - SSE / Streamable HTTP
 *
 * Exposes ProfitBot tools via the MCP protocol for ElevenLabs Conversational AI
 * and other MCP clients that support SSE or Streamable HTTP transport.
 *
 * Use this endpoint when connecting your ElevenLabs voice agent to ProfitBot
 * so callers can request quotes, DIY pricing, and checkout links.
 *
 * Auth: X-MCP-API-Key header or Authorization: Bearer <MCP_API_KEY>
 * Optional context headers (for telephony): X-Widget-Id, X-Conversation-Id
 *
 * URL: https://app.profitbot.ai/api/mcp/sse
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

const PROFITBOT_MCP_ACTIONS = [
	'list_widgets',
	'get_widget',
	'list_leads',
	'get_lead',
	'move_lead',
	'list_lead_stages',
	'list_conversations',
	'get_conversation',
	'send_message',
	'get_conversation_messages',
	'list_contacts',
	'get_contact',
	'send_email',
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
	'shopify_cancel_order',
	'shopify_refund_order',
	'shopify_list_customers',
	'shopify_get_customer',
	'shopify_get_customer_orders',
	'shopify_get_statistics',
	'shopify_list_products',
] as const;

function getApiKeyFromRequest(request: Request): string | null {
	const auth = request.headers.get('Authorization');
	if (auth?.startsWith('Bearer ')) {
		return auth.slice(7).trim() || null;
	}
	const key = request.headers.get('X-MCP-API-Key');
	return key?.trim() || null;
}

async function callProfitBotMCP(
	baseUrl: string,
	apiKey: string,
	action: string,
	params: Record<string, unknown>,
	extraHeaders?: Record<string, string>
): Promise<unknown> {
	const url = `${baseUrl}/api/mcp`;
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'X-MCP-API-Key': apiKey,
		...extraHeaders,
	};

	const response = await fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify({ action, ...params }),
	});

	const data = await response.json().catch(() => ({}));

	if (!response.ok) {
		throw new Error((data as { error?: string }).error || `HTTP ${response.status}`);
	}
	if (!(data as { success?: boolean }).success) {
		throw new Error((data as { error?: string }).error || 'API call failed');
	}
	return (data as { data?: unknown }).data;
}

function createProfitBotMcpServer(baseUrl: string, apiKey: string, extraHeaders: Record<string, string>) {
	const server = new McpServer(
		{
			name: 'profitbot-elevenlabs',
			version: '1.0.0',
		},
		{ capabilities: { tools: {} } }
	);

	const callApi = (action: string, params: Record<string, unknown>) =>
		callProfitBotMCP(baseUrl, apiKey, action, params, extraHeaders);

	// Pricing-focused tools for voice agents
	server.registerTool(
		'list_widgets',
		{
			title: 'List Widgets',
			description: 'List all widgets for the workspace. Use widgetId when generating quotes or DIY checkout.',
			inputSchema: {},
		},
		async () => {
			const data = await callApi('list_widgets', {});
			return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
		}
	);

	server.registerTool(
		'get_product_pricing',
		{
			title: 'Get Product Pricing',
			description:
				'Get DIY product pricing (15L, 10L, 5L buckets) for a widget. Use before creating DIY checkout. Requires widgetId or conversationId.',
			inputSchema: {
				widgetId: z.string().optional().describe('Widget ID'),
				conversationId: z.string().optional().describe('Conversation ID (from call context)'),
			},
		},
		async (args) => {
			const data = await callApi('get_product_pricing', args || {});
			return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
		}
	);

	server.registerTool(
		'generate_quote',
		{
			title: 'Generate Quote',
			description:
				'Generate a PDF quote for a customer. Returns PDF URL and total. Use when a caller requests a quote. Requires widgetId and conversationId or email.',
			inputSchema: {
				widgetId: z.string().describe('Widget ID'),
				conversationId: z.string().optional().describe('Conversation ID (from call)'),
				email: z.string().email().optional().describe('Customer email'),
				customer: z
					.object({
						name: z.string().optional(),
						email: z.string().optional(),
						phone: z.string().optional(),
					})
					.optional(),
				project: z
					.object({
						roofSize: z.number().optional(),
						fullAddress: z.string().optional(),
					})
					.optional(),
				lineItems: z.array(z.unknown()).optional(),
				images: z.array(z.string()).optional(),
			},
		},
		async (args) => {
			const data = await callApi('generate_quote', (args || {}) as Record<string, unknown>);
			return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
		}
	);

	server.registerTool(
		'create_diy_checkout',
		{
			title: 'Create DIY Checkout',
			description:
				'Create a DIY checkout link with product quantities. Use when a caller wants to buy products (e.g. roof coating). Requires widgetId/conversationId and roof_size_sqm or product counts.',
			inputSchema: {
				widgetId: z.string().optional().describe('Widget ID'),
				conversationId: z.string().optional().describe('Conversation ID (from call)'),
				roof_size_sqm: z.number().min(1).optional().describe('Roof area in sqm'),
				count_15l: z.number().min(0).optional().describe('Number of 15L buckets'),
				count_10l: z.number().min(0).optional().describe('Number of 10L buckets'),
				count_5l: z.number().min(0).optional().describe('Number of 5L buckets'),
				discount_percent: z.number().min(1).max(20).optional().describe('Discount 1-20%'),
				email: z.string().email().optional().describe('Customer email'),
			},
		},
		async (args) => {
			const data = await callApi('create_diy_checkout', (args || {}) as Record<string, unknown>);
			return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
		}
	);

	server.registerTool(
		'get_contact',
		{
			title: 'Get Contact',
			description: 'Get contact details by ID (name, email, phone, address).',
			inputSchema: {
				contactId: z.string().describe('Contact ID'),
			},
		},
		async (args) => {
			const data = await callApi('get_contact', (args || {}) as Record<string, unknown>);
			return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
		}
	);

	server.registerTool(
		'get_conversation',
		{
			title: 'Get Conversation',
			description: 'Get conversation details. Use conversationId from call context.',
			inputSchema: {
				conversationId: z.string().describe('Conversation ID'),
			},
		},
		async (args) => {
			const data = await callApi('get_conversation', (args || {}) as Record<string, unknown>);
			return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
		}
	);

	server.registerTool(
		'get_conversation_messages',
		{
			title: 'Get Conversation Messages',
			description: 'Get message history for a conversation.',
			inputSchema: {
				conversationId: z.string().describe('Conversation ID'),
				limit: z.number().optional().describe('Max messages (default 50)'),
			},
		},
		async (args) => {
			const data = await callApi('get_conversation_messages', (args || {}) as Record<string, unknown>);
			return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
		}
	);

	server.registerTool(
		'list_contacts',
		{
			title: 'List Contacts',
			description: 'List contacts with optional search.',
			inputSchema: {
				widgetId: z.string().optional(),
				search: z.string().optional(),
				limit: z.number().optional(),
				page: z.number().optional(),
			},
		},
		async (args) => {
			const data = await callApi('list_contacts', (args || {}) as Record<string, unknown>);
			return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
		}
	);

	server.registerTool(
		'send_message',
		{
			title: 'Send Message',
			description: 'Send a message to a conversation (e.g. follow-up after call).',
			inputSchema: {
				conversationId: z.string().describe('Conversation ID'),
				content: z.string().describe('Message content'),
			},
		},
		async (args) => {
			const data = await callApi('send_message', (args || {}) as Record<string, unknown>);
			return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
		}
	);

	// Generic tool for any other ProfitBot action (forward to API)
	server.registerTool(
		'mcp_call',
		{
			title: 'MCP Call (Advanced)',
			description: `Call any ProfitBot MCP action. Actions: ${PROFITBOT_MCP_ACTIONS.join(', ')}`,
			inputSchema: {
				action: z.string().describe('Action name'),
				params: z.record(z.unknown()).optional().describe('Action parameters'),
			},
		},
		async (args) => {
			if (!args?.action) throw new Error('action required');
			if (!PROFITBOT_MCP_ACTIONS.includes(args.action as (typeof PROFITBOT_MCP_ACTIONS)[number])) {
				throw new Error(`Invalid action. Allowed: ${PROFITBOT_MCP_ACTIONS.join(', ')}`);
			}
			const params = (args.params as Record<string, unknown>) || {};
			const data = await callApi(args.action, params);
			return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
		}
	);

	return server;
}

function getBaseUrl(request: Request): string {
	// Use request URL origin so it works in dev and production
	try {
		const url = new URL(request.url);
		return url.origin;
	} catch {
		return 'https://app.profitbot.ai';
	}
}

export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
export const OPTIONS = handleCors;

async function handleCors(): Promise<Response> {
	return new Response(null, {
		status: 204,
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MCP-API-Key, mcp-session-id, Last-Event-ID, mcp-protocol-version, X-Widget-Id, X-Conversation-Id',
			'Access-Control-Max-Age': '86400',
		},
	});
}

async function handleMcpRequest(event: import('./$types').RequestEvent): Promise<Response> {
	// CORS
	if (event.request.method === 'OPTIONS') {
		return handleCors();
	}

	const apiKey = getApiKeyFromRequest(event.request);
	if (!apiKey) {
		return new Response(
			JSON.stringify({
				jsonrpc: '2.0',
				error: { code: -32001, message: 'Missing X-MCP-API-Key or Authorization: Bearer header' },
				id: null,
			}),
			{
				status: 401,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				},
			}
		);
	}

	// Pass through context headers for telephony (ElevenLabs can set these per agent)
	const extraHeaders: Record<string, string> = {};
	const widgetId = event.request.headers.get('X-Widget-Id') || event.request.headers.get('x-widget-id');
	const conversationId =
		event.request.headers.get('X-Conversation-Id') || event.request.headers.get('x-conversation-id');
	if (widgetId) extraHeaders['X-Widget-Id'] = widgetId;
	if (conversationId) extraHeaders['X-Conversation-Id'] = conversationId;

	// Vercel serverless: reject GET immediately. SSE requires long-lived connections
	// which timeout (300s). ElevenLabs supports Streamable HTTP (POST-only) - use that.
	if (event.request.method === 'GET') {
		return new Response(
			JSON.stringify({
				error: 'Use POST for MCP requests. This server uses Streamable HTTP (JSON) for serverless compatibility.',
				jsonrpc: '2.0',
			}),
			{
				status: 405,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
					Allow: 'POST, OPTIONS',
				},
			}
		);
	}

	const baseUrl = getBaseUrl(event.request);
	const server = createProfitBotMcpServer(baseUrl, apiKey, extraHeaders);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined, // Stateless - works with serverless
		enableJsonResponse: true, // JSON responses, no SSE - avoids long-lived connections on Vercel
	});

	await server.connect(transport);

	// Clone request so body can be read (SvelteKit may have consumed it)
	let req: Request = event.request;
	if (event.request.method === 'POST' && event.request.body) {
		const body = await event.request.text();
		req = new Request(event.request.url, {
			method: event.request.method,
			headers: event.request.headers,
			body,
		});
	}

	const response = await transport.handleRequest(req);

	// Add CORS to response
	const newHeaders = new Headers(response.headers);
	newHeaders.set('Access-Control-Allow-Origin', '*');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders,
	});
}
