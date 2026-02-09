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

/** GraphQL Admin API (e.g. for discount codes). Requires write_discounts scope for discount mutations. */
export async function shopifyGraphql<T = unknown>(
	config: ShopifyConfig,
	query: string,
	variables?: Record<string, unknown>
): Promise<{ ok: boolean; data?: T; errors?: Array<{ message?: string; field?: string[] }>; error?: string }> {
	try {
		const host = config.shopDomain.replace(/^https?:\/\//, '').split('/')[0];
		const url = `https://${host}/admin/api/${config.apiVersion}/graphql.json`;
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Shopify-Access-Token': config.accessToken
			},
			body: JSON.stringify({ query, variables: variables ?? {} })
		});
		const json = (await res.json()) as {
			data?: T;
			errors?: Array<{ message?: string; field?: string[] }>;
		};
		if (!res.ok) {
			return {
				ok: false,
				error: json.errors?.[0]?.message ?? res.statusText ?? 'GraphQL request failed',
				errors: json.errors
			};
		}
		if (json.errors?.length) {
			const msg = json.errors.map((e) => e.message ?? JSON.stringify(e)).join('; ');
			return { ok: false, data: json.data, errors: json.errors, error: msg };
		}
		return { ok: true, data: json.data };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'GraphQL request failed' };
	}
}

/** Discount codes used for chat-offered discounts; must exist in Shopify for cart/checkout ?discount= to work. */
export const CHAT_DISCOUNT_CODE_BY_PERCENT: Record<number, string> = { 10: 'CHAT10', 15: 'CHAT15' };

/**
 * Create a percentage-off discount code in Shopify (GraphQL). Use when the customer is offered a discount
 * so that the checkout link with ?discount=CODE actually applies. If the code already exists, returns ok (idempotent).
 * Requires Shopify app/integration to have write_discounts scope.
 */
export async function createChatDiscountCode(
	config: ShopifyConfig,
	percent: 10 | 15,
	options?: { expiresInDays?: number }
): Promise<{ ok: boolean; code?: string; error?: string }> {
	const code = CHAT_DISCOUNT_CODE_BY_PERCENT[percent];
	if (!code) return { ok: false, error: 'Only 10 or 15 percent supported' };

	const startsAt = new Date().toISOString();
	const endsAt = options?.expiresInDays
		? new Date(Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
		: null;

	const mutation = `
		mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
			discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
				codeDiscountNode {
					id
					codeDiscount {
						... on DiscountCodeBasic {
							codes(first: 5) { nodes { code } }
						}
					}
				}
				userErrors { field message }
			}
		}
	`;
	const variables = {
		basicCodeDiscount: {
			title: `Chat ${percent}% off`,
			code,
			startsAt,
			endsAt,
			context: { all: 'ALL' as const },
			customerGets: {
				value: { percentage: percent / 100 },
				items: { all: true }
			}
		}
	};

	const res = await shopifyGraphql<{
		discountCodeBasicCreate?: {
			codeDiscountNode?: { id?: string };
			userErrors?: Array<{ field?: string[]; message?: string }>;
		};
	}>(config, mutation, variables);

	if (!res.ok) {
		// Code might already exist (e.g. "Code has already been taken")
		const errMsg = (res.error ?? '').toLowerCase();
		if (errMsg.includes('already') || errMsg.includes('taken') || errMsg.includes('duplicate')) {
			return { ok: true, code };
		}
		return { ok: false, error: res.error };
	}

	const userErrors = res.data?.discountCodeBasicCreate?.userErrors ?? [];
	if (userErrors.length > 0) {
		const msg = userErrors.map((e) => e.message).filter(Boolean).join('; ');
		if (/already|taken|exists/i.test(msg)) return { ok: true, code };
		return { ok: false, error: msg };
	}

	return { ok: true, code };
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

export type ShopifyProductWithImage = {
	id: number;
	title: string;
	imageSrc: string | null;
	variants: Array<{ id: number; price: string; option1?: string | null; option2?: string | null; option3?: string | null }>;
};

/**
 * Fetch products from Shopify with images. Used for DIY checkout preview.
 * Returns products with id, title, featured image src, and variant prices.
 */
export async function listProductsWithImages(
	config: ShopifyConfig,
	limit = 100
): Promise<{ products?: ShopifyProductWithImage[]; error?: string }> {
	const res = await shopifyRequest<{ products?: Array<{
		id: number;
		title: string;
		image?: { src?: string } | null;
		variants?: Array<{ id: number; price: string; option1?: string | null; option2?: string | null; option3?: string | null }>;
	}> }>(config, 'products.json', {
		query: {
			limit,
			fields: 'id,title,image,variants'
		}
	});
	if (!res.ok) return { error: res.error ?? 'Failed to fetch products' };
	const raw = res.data?.products ?? [];
	const products: ShopifyProductWithImage[] = raw.map((p) => ({
		id: p.id,
		title: p.title ?? '',
		imageSrc: (p.image && typeof p.image === 'object' && p.image.src) ? p.image.src : null,
		variants: Array.isArray(p.variants)
			? p.variants.map((v) => ({
					id: v.id,
					price: String(v.price ?? ''),
					option1: v.option1 ?? null,
					option2: v.option2 ?? null,
					option3: v.option3 ?? null
				}))
			: []
	}));
	return { products };
}

/**
 * Resolve image URLs for DIY buckets (15L, 10L, 5L) by matching Shopify products.
 * Matches by title containing the size (e.g. "15L", "10L", "5L") and optionally by variant price.
 */
export async function getDiyProductImages(
	config: ShopifyConfig,
	bucketConfig: Array<{ size: number; price: string; title: string }>
): Promise<Record<number, string>> {
	const { products, error } = await listProductsWithImages(config, 100);
	const result: Record<number, string> = {};
	if (error || !products?.length) return result;

	const sizePatterns: Record<number, RegExp> = {
		15: /\b15\s*L\b|15L/i,
		10: /\b10\s*L\b|10L/i,
		5: /\b5\s*L\b|5L/i
	};

	for (const bucket of bucketConfig) {
		const pattern = sizePatterns[bucket.size];
		if (!pattern) continue;
		const priceNum = Number.parseFloat(bucket.price);
		const match = products.find((p) => {
			if (!pattern.test(p.title)) return false;
			const variantPrice = p.variants[0]?.price;
			if (!variantPrice) return true;
			const vp = Number.parseFloat(variantPrice);
			return Number.isFinite(vp) && Math.abs(vp - priceNum) < 1;
		}) ?? products.find((p) => pattern.test(p.title));
		if (match?.imageSrc) result[bucket.size] = match.imageSrc;
	}
	return result;
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
	/** Optional percentage discount (10 or 15) applied to the order */
	applied_discount?: {
		title?: string;
		description?: string;
		value_type: 'percentage';
		value: string;
		amount: string;
	};
};

export async function createDraftOrder(
	config: ShopifyConfig,
	input: ShopifyDraftOrderInput
): Promise<{ ok: boolean; draftOrderId?: number; name?: string; checkoutUrl?: string; error?: string }> {
	const draftOrderBody: Record<string, unknown> = {
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
	};
	if (input.applied_discount) {
		draftOrderBody.applied_discount = input.applied_discount;
	}
	const res = await shopifyRequest<{ draft_order?: { id: number; name: string; invoice_url?: string } }>(
		config,
		'draft_orders.json',
		{
			method: 'POST',
			body: { draft_order: draftOrderBody }
		}
	);
	if (!res.ok) return { ok: false, error: res.error ?? 'Failed to create draft order' };
	const draft = res.data?.draft_order;
	if (!draft?.id) return { ok: false, error: 'Draft order not returned' };
	
	// Build a proper checkout/cart permalink URL with variant IDs if available
	// Shopify cart permalink format: https://{shop}.myshopify.com/cart/{variant_id}:{quantity},{variant_id}:{quantity}
	// This creates a direct checkout link, not an invoice link
	let checkoutUrl: string | undefined;
	const itemsWithVariants = input.line_items.filter((item) => item.variant_id != null && item.variant_id > 0);
	
	if (itemsWithVariants.length > 0) {
		// Build cart permalink URL with variant IDs (this goes directly to checkout)
		const cartItems = itemsWithVariants.map((item) => `${item.variant_id}:${item.quantity}`).join(',');
		
		// Extract shop domain - handle both myshopify.com and custom domains
		let shopDomain = config.shopDomain.trim();
		// Remove protocol if present
		shopDomain = shopDomain.replace(/^https?:\/\//, '');
		// Remove trailing slashes and paths
		shopDomain = shopDomain.split('/')[0];
		
		// Determine if it's a myshopify.com domain or custom domain
		let baseUrl: string;
		if (shopDomain.includes('.myshopify.com')) {
			// Already a myshopify.com domain, use as-is
			baseUrl = `https://${shopDomain}`;
		} else if (shopDomain.includes('.')) {
			// Custom domain - we need to find the myshopify.com domain
			// For custom domains, we'll try to extract the shop name
			// If shopDomain is like "shop.example.com", we can't easily get the myshopify.com domain
			// So we'll use the custom domain and hope Shopify redirects correctly
			baseUrl = `https://${shopDomain}`;
		} else {
			// Just the shop name (e.g., "myshop")
			baseUrl = `https://${shopDomain}.myshopify.com`;
		}
		
		// Build the cart permalink URL (this goes directly to checkout)
		checkoutUrl = `${baseUrl}/cart/${cartItems}`;
		
		// Add discount code if applicable
		if (input.applied_discount && input.applied_discount.value) {
			const discountPercent = Number.parseFloat(input.applied_discount.value);
			const discountCode = CHAT_DISCOUNT_CODE_BY_PERCENT[discountPercent];
			if (discountCode) {
				checkoutUrl += `?discount=${encodeURIComponent(discountCode)}`;
			}
		}
	} else {
		// No variant IDs available - fall back to invoice URL as last resort
		// This should rarely happen if products are configured correctly
		checkoutUrl = draft.invoice_url ?? undefined;
	}
	
	return {
		ok: true,
		draftOrderId: draft.id,
		name: draft.name,
		checkoutUrl
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

export async function getOrder(
	config: ShopifyConfig,
	orderId: number
): Promise<{ order?: ShopifyOrderSummary & { line_items?: unknown[]; customer?: unknown }; error?: string }> {
	const res = await shopifyRequest<{ order: ShopifyOrderSummary & { line_items?: unknown[]; customer?: unknown } }>(
		config,
		`orders/${orderId}.json`,
		{
			query: {
				fields:
					'id,name,email,created_at,financial_status,fulfillment_status,cancelled_at,cancel_reason,total_price,currency,order_status_url,discount_codes,line_items,customer'
			}
		}
	);
	if (!res.ok) return { error: res.error ?? 'Failed to get order' };
	return { order: res.data?.order };
}

export async function getCustomer(
	config: ShopifyConfig,
	customerId: number
): Promise<{ customer?: ShopifyCustomerSummary & { orders_count?: number; total_spent?: string }; error?: string }> {
	const res = await shopifyRequest<{
		customer: ShopifyCustomerSummary & { orders_count?: number; total_spent?: string };
	}>(config, `customers/${customerId}.json`, {
		query: {
			fields: 'id,email,first_name,last_name,phone,default_address,orders_count,total_spent'
		}
	});
	if (!res.ok) return { error: res.error ?? 'Failed to get customer' };
	return { customer: res.data?.customer };
}

export async function getShopifyStatistics(
	config: ShopifyConfig,
	opts?: { days?: number }
): Promise<{
	statistics?: {
		totalOrders: number;
		totalRevenue: number;
		averageOrderValue: number;
		currency: string;
		recentOrders: ShopifyOrderSummary[];
	};
	error?: string;
}> {
	const days = opts?.days ?? 30;
	const sinceDate = new Date();
	sinceDate.setDate(sinceDate.getDate() - days);
	const sinceISO = sinceDate.toISOString();

	const res = await shopifyRequest<{ orders: ShopifyOrderSummary[] }>(config, 'orders.json', {
		query: {
			status: 'any',
			limit: 250,
			created_at_min: sinceISO,
			fields:
				'id,name,email,created_at,financial_status,fulfillment_status,cancelled_at,cancel_reason,total_price,currency,order_status_url'
		}
	});
	if (!res.ok) return { error: res.error ?? 'Failed to fetch orders for statistics' };

	const orders = res.data?.orders ?? [];
	const paidOrders = orders.filter(
		(o) => o.financial_status === 'paid' && !o.cancelled_at && o.total_price
	);
	const totalRevenue = paidOrders.reduce((sum, o) => {
		const price = Number.parseFloat(o.total_price ?? '0');
		return sum + (Number.isFinite(price) ? price : 0);
	}, 0);
	const totalOrders = paidOrders.length;
	const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
	const currency = paidOrders[0]?.currency ?? 'USD';

	return {
		statistics: {
			totalOrders,
			totalRevenue,
			averageOrderValue,
			currency,
			recentOrders: orders.slice(0, 10)
		}
	};
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
