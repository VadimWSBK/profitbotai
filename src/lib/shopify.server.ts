/**
 * Shopify integration helper.
 * Uses Admin REST API with a private app/custom app access token.
 */

import { getSupabaseClient } from '$lib/supabase.server';
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ShopifyConfig {
	shopDomain: string;
	accessToken: string;
	apiVersion: string;
}

const DEFAULT_API_VERSION = '2024-04';

function normalizeShopDomain(input: string): string {
	const trimmed = input.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
	return trimmed;
}

function normalizeApiVersion(input?: string | null): string {
	const v = (input ?? '').trim();
	return v || DEFAULT_API_VERSION;
}

export function getShopifyConfigFromRow(config: Record<string, unknown> | null): ShopifyConfig | null {
	if (!config) return null;
	const accessToken = typeof config.accessToken === 'string' ? config.accessToken.trim() : '';
	const shopDomain = typeof config.shopDomain === 'string' ? normalizeShopDomain(config.shopDomain) : '';
	const apiVersion = typeof config.apiVersion === 'string' ? normalizeApiVersion(config.apiVersion) : DEFAULT_API_VERSION;
	if (!accessToken || !shopDomain) return null;
	return { accessToken, shopDomain, apiVersion };
}

/**
 * Get the user's Shopify config if they have connected it.
 * Returns null if not connected.
 */
export async function getShopifyConfig(event: RequestEvent): Promise<ShopifyConfig | null> {
	const user = event.locals.user;
	if (!user || user.id === 'api-key') return null;
	const supabase = getSupabaseClient(event);
	const { data } = await supabase
		.from('user_integrations')
		.select('config')
		.eq('user_id', user.id)
		.eq('integration_type', 'shopify')
		.single();
	return getShopifyConfigFromRow((data?.config as Record<string, unknown> | null) ?? null);
}

/**
 * Get Shopify config for a user by ID (e.g. widget owner). Use with admin Supabase when no request context.
 */
export async function getShopifyConfigForUser(
	supabase: SupabaseClient,
	userId: string
): Promise<ShopifyConfig | null> {
	const { data } = await supabase
		.from('user_integrations')
		.select('config')
		.eq('user_id', userId)
		.eq('integration_type', 'shopify')
		.single();
	return getShopifyConfigFromRow((data?.config as Record<string, unknown> | null) ?? null);
}

type ShopifyRequestOptions = {
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
	body?: Record<string, unknown> | null;
	query?: Record<string, string | number | boolean | undefined | null>;
};

function buildUrl(shopDomain: string, apiVersion: string, path: string, query?: ShopifyRequestOptions['query']): string {
	const base = `https://${shopDomain}/admin/api/${apiVersion}/${path.replace(/^\/+/, '')}`;
	if (!query) return base;
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === null || value === '') continue;
		params.set(key, String(value));
	}
	const suffix = params.toString();
	return suffix ? `${base}?${suffix}` : base;
}

export async function shopifyRequest<T>(
	config: ShopifyConfig,
	path: string,
	opts: ShopifyRequestOptions = {}
): Promise<{ ok: boolean; data?: T; error?: string; status?: number; link?: string }> {
	try {
		const url = buildUrl(config.shopDomain, config.apiVersion, path, opts.query);
		const res = await fetch(url, {
			method: opts.method ?? 'GET',
			headers: {
				'Content-Type': 'application/json',
				'X-Shopify-Access-Token': config.accessToken
			},
			body: opts.body ? JSON.stringify(opts.body) : undefined
		});
		const status = res.status;
		const text = await res.text();
		const link = res.headers.get('link') ?? undefined;
		let json: unknown = null;
		if (text) {
			try {
				json = JSON.parse(text);
			} catch {
				json = null;
			}
		}
		if (!res.ok) {
			const errorDetail =
				typeof json === 'object' && json && 'errors' in json ? (json as { errors: unknown }).errors : null;
			let errorText = res.statusText || 'Shopify request failed';
			if (typeof errorDetail === 'string') {
				errorText = errorDetail;
			} else if (errorDetail) {
				errorText = JSON.stringify(errorDetail);
			}
			return { ok: false, error: errorText, status };
		}
		return { ok: true, data: json as T, status, link };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'Shopify request failed' };
	}
}

export type ShopifyDiscountCode = {
	code?: string | null;
	type?: string | null;
	amount?: string | null;
};

export type ShopifyOrderSummary = {
	id: number;
	name: string;
	email?: string | null;
	created_at?: string;
	financial_status?: string | null;
	fulfillment_status?: string | null;
	cancelled_at?: string | null;
	cancel_reason?: string | null;
	total_price?: string | null;
	currency?: string | null;
	order_status_url?: string | null;
	discount_codes?: ShopifyDiscountCode[] | null;
};

export async function searchOrders(
	config: ShopifyConfig,
	query: string,
	limit = 5
): Promise<{ orders?: ShopifyOrderSummary[]; error?: string }> {
	const q = query.trim();
	if (!q) return { orders: [] };
	const res = await shopifyRequest<{ orders: ShopifyOrderSummary[] }>(config, 'orders.json', {
		query: {
			status: 'any',
			limit,
			fields:
				'id,name,email,created_at,financial_status,fulfillment_status,cancelled_at,cancel_reason,total_price,currency,order_status_url',
			query: q
		}
	});
	if (!res.ok) return { error: res.error ?? 'Failed to search orders' };
	return { orders: res.data?.orders ?? [] };
}

export async function listRecentOrders(
	config: ShopifyConfig,
	limit = 5
): Promise<{ orders?: ShopifyOrderSummary[]; error?: string }> {
	const res = await shopifyRequest<{ orders: ShopifyOrderSummary[] }>(config, 'orders.json', {
		query: {
			status: 'any',
			limit,
			fields:
				'id,name,email,created_at,financial_status,fulfillment_status,cancelled_at,cancel_reason,total_price,currency,order_status_url'
		}
	});
	if (!res.ok) return { error: res.error ?? 'Failed to list orders' };
	return { orders: res.data?.orders ?? [] };
}

export type ShopifyDraftOrderInput = {
	email?: string;
	line_items: Array<{
		title?: string;
		variant_id?: number;
		quantity: number;
		price?: string;
	}>;
	note?: string;
	tags?: string;
	currency?: string;
};

export async function createDraftOrder(
	config: ShopifyConfig,
	input: ShopifyDraftOrderInput
): Promise<{ ok: boolean; draftOrderId?: number; name?: string; checkoutUrl?: string; error?: string }> {
	const res = await shopifyRequest<{ draft_order?: { id: number; name: string; invoice_url?: string } }>(
		config,
		'draft_orders.json',
		{
			method: 'POST',
			body: {
				draft_order: {
					email: input.email,
					line_items: input.line_items.map((item) => ({
						title: item.title,
						variant_id: item.variant_id,
						quantity: item.quantity,
						price: item.price
					})),
					note: input.note,
					tags: input.tags,
					currency: input.currency
				}
			}
		}
	);
	if (!res.ok) return { ok: false, error: res.error ?? 'Failed to create draft order' };
	const draft = res.data?.draft_order;
	if (!draft?.id) return { ok: false, error: 'Draft order not returned' };
	return {
		ok: true,
		draftOrderId: draft.id,
		name: draft.name,
		checkoutUrl: draft.invoice_url ?? undefined
	};
}

export async function cancelOrder(
	config: ShopifyConfig,
	orderId: number,
	opts?: { reason?: string; notify?: boolean; restock?: boolean }
): Promise<{ ok: boolean; error?: string }> {
	const res = await shopifyRequest<{ order?: { id: number } }>(config, `orders/${orderId}/cancel.json`, {
		method: 'POST',
		body: {
			reason: opts?.reason,
			notify: opts?.notify ?? false,
			restock: opts?.restock ?? false
		}
	});
	if (!res.ok) return { ok: false, error: res.error ?? 'Failed to cancel order' };
	return { ok: true };
}

type ShopifyOrderDetail = {
	id: number;
	line_items: Array<{ id: number; quantity: number }>;
	total_price: string;
	currency: string;
};

type ShopifyTransaction = {
	id: number;
	kind: string;
	gateway: string;
	amount: string;
};

export type ShopifyCustomerSummary = {
	id: number;
	email: string | null;
	first_name: string | null;
	last_name: string | null;
	phone: string | null;
	default_address?: {
		address1?: string | null;
		address2?: string | null;
		city?: string | null;
		province?: string | null;
		country?: string | null;
		zip?: string | null;
	} | null;
};

export async function listCustomers(
	config: ShopifyConfig,
	opts?: { limit?: number; pageInfo?: string }
): Promise<{
	customers?: ShopifyCustomerSummary[];
	nextPageInfo?: string;
	error?: string;
}> {
	const limit = Math.min(opts?.limit ?? 250, 250);
	const query: Record<string, string | number | undefined> = {
		limit,
		fields: 'id,email,first_name,last_name,phone,default_address'
	};
	if (opts?.pageInfo) query.page_info = opts.pageInfo;
	const res = await shopifyRequest<{ customers: ShopifyCustomerSummary[] }>(config, 'customers.json', {
		query
	});
	if (!res.ok) return { error: res.error ?? 'Failed to list customers' };
	const customers = res.data?.customers ?? [];
	let nextPageInfo: string | undefined;
	if (res.link) {
		const nextMatch = res.link.match(/<[^>]*[?&]page_info=([^>&]+)>;\s*rel="next"/);
		if (nextMatch) nextPageInfo = decodeURIComponent(nextMatch[1]);
	}
	return { customers, nextPageInfo };
}

export async function listOrdersForCustomer(
	config: ShopifyConfig,
	customerId: number
): Promise<{ orders?: ShopifyOrderSummary[]; error?: string }> {
	const res = await shopifyRequest<{ orders: ShopifyOrderSummary[] }>(
		config,
		`customers/${customerId}/orders.json`,
		{
			query: {
				status: 'any',
				limit: 250,
				fields:
					'id,name,email,created_at,financial_status,fulfillment_status,cancelled_at,cancel_reason,total_price,currency,order_status_url,discount_codes'
			}
		}
	);
	if (!res.ok) return { error: res.error ?? 'Failed to list orders for customer' };
	return { orders: res.data?.orders ?? [] };
}

export async function refundOrderFull(
	config: ShopifyConfig,
	orderId: number,
	opts?: { notify?: boolean; note?: string }
): Promise<{ ok: boolean; error?: string }> {
	const orderRes = await shopifyRequest<{ order: ShopifyOrderDetail }>(config, `orders/${orderId}.json`, {
		query: { fields: 'id,line_items,total_price,currency' }
	});
	if (!orderRes.ok || !orderRes.data?.order) {
		return { ok: false, error: orderRes.error ?? 'Failed to load order' };
	}
	const order = orderRes.data.order;
	const txRes = await shopifyRequest<{ transactions: ShopifyTransaction[] }>(
		config,
		`orders/${orderId}/transactions.json`
	);
	if (!txRes.ok) return { ok: false, error: txRes.error ?? 'Failed to load transactions' };
	const parentTx =
		(txRes.data?.transactions ?? []).find((t) => t.kind === 'capture') ??
		(txRes.data?.transactions ?? []).find((t) => t.kind === 'sale');
	if (!parentTx) return { ok: false, error: 'No sale transaction found to refund' };

	const refundLineItems = order.line_items.map((li) => ({
		line_item_id: li.id,
		quantity: li.quantity
	}));
	const calculateRes = await shopifyRequest<{ refund?: { refund_line_items: unknown[]; transactions: unknown[] } }>(
		config,
		`orders/${orderId}/refunds/calculate.json`,
		{
			method: 'POST',
			body: {
				refund: {
					notify: opts?.notify ?? false,
					currency: order.currency,
					refund_line_items: refundLineItems,
					shipping: { full_refund: true },
					transactions: [
						{
							amount: order.total_price,
							kind: 'refund',
							gateway: parentTx.gateway,
							parent_id: parentTx.id
						}
					],
					note: opts?.note
				}
			}
		}
	);
	if (!calculateRes.ok || !calculateRes.data?.refund) {
		return { ok: false, error: calculateRes.error ?? 'Failed to calculate refund' };
	}
	const createRes = await shopifyRequest<{ refund?: { id: number } }>(config, `orders/${orderId}/refunds.json`, {
		method: 'POST',
		body: { refund: calculateRes.data.refund }
	});
	if (!createRes.ok) return { ok: false, error: createRes.error ?? 'Failed to create refund' };
	return { ok: true };
}
