/**
 * Product pricing: DIY bucket products per user.
 * Used by agent rules, DIY checkout tool, and quote generation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '$lib/supabase.server';

export type ProductPricing = {
	id: string;
	name: string;
	sizeLitres: number;
	price: number;
	currency: string;
	coverageSqm: number;
	imageUrl: string | null;
	shopifyProductId: number | null;
	shopifyVariantId: number | null;
	sortOrder: number;
};

const DEFAULT_PRODUCTS: Omit<ProductPricing, 'id'>[] = [
	{ name: 'NetZero UltraTherm 15L Bucket', sizeLitres: 15, price: 389.99, currency: 'AUD', coverageSqm: 30, imageUrl: null, shopifyProductId: null, shopifyVariantId: null, sortOrder: 0 },
	{ name: 'NetZero UltraTherm 10L Bucket', sizeLitres: 10, price: 285.99, currency: 'AUD', coverageSqm: 20, imageUrl: null, shopifyProductId: null, shopifyVariantId: null, sortOrder: 1 },
	{ name: 'NetZero UltraTherm 5L Bucket', sizeLitres: 5, price: 149.99, currency: 'AUD', coverageSqm: 10, imageUrl: null, shopifyProductId: null, shopifyVariantId: null, sortOrder: 2 }
];

/** Fetch product pricing for a user. Returns DB rows or defaults if empty. */
export async function getProductPricingForUser(
	supabase: SupabaseClient,
	userId: string
): Promise<ProductPricing[]> {
	const { data: rows, error } = await supabase
		.from('product_pricing')
		.select('id, name, size_litres, price, currency, coverage_sqm, image_url, shopify_product_id, shopify_variant_id, sort_order')
		.eq('created_by', userId)
		.order('sort_order', { ascending: true })
		.order('size_litres', { ascending: false });

	if (error) {
		console.error('[product-pricing] getProductPricingForUser:', error);
		return DEFAULT_PRODUCTS.map((p, i) => ({ ...p, id: `default-${i}` }));
	}

	if (!rows?.length) {
		return DEFAULT_PRODUCTS.map((p, i) => ({ ...p, id: `default-${i}` }));
	}

	return rows.map((r) => ({
		id: r.id as string,
		name: (r.name as string) ?? '',
		sizeLitres: Number(r.size_litres) ?? 0,
		price: Number(r.price) ?? 0,
		currency: (r.currency as string) ?? 'AUD',
		coverageSqm: Number(r.coverage_sqm) ?? 0,
		imageUrl: (r.image_url as string | null) ?? null,
		shopifyProductId: r.shopify_product_id != null ? Number(r.shopify_product_id) : null,
		shopifyVariantId: r.shopify_variant_id != null ? Number(r.shopify_variant_id) : null,
		sortOrder: Number(r.sort_order) ?? 0
	}));
}

/** Fetch via admin client (for agent tools where we have ownerId). */
export async function getProductPricingForOwner(ownerId: string): Promise<ProductPricing[]> {
	const admin = getSupabaseAdmin();
	const { data: rows, error } = await admin
		.from('product_pricing')
		.select('id, name, size_litres, price, currency, coverage_sqm, image_url, shopify_product_id, shopify_variant_id, sort_order')
		.eq('created_by', ownerId)
		.order('sort_order', { ascending: true })
		.order('size_litres', { ascending: false });

	if (error || !rows?.length) {
		return DEFAULT_PRODUCTS.map((p, i) => ({ ...p, id: `default-${i}` }));
	}

	return rows.map((r) => ({
		id: r.id as string,
		name: (r.name as string) ?? '',
		sizeLitres: Number(r.size_litres) ?? 0,
		price: Number(r.price) ?? 0,
		currency: (r.currency as string) ?? 'AUD',
		coverageSqm: Number(r.coverage_sqm) ?? 0,
		imageUrl: (r.image_url as string | null) ?? null,
		shopifyProductId: r.shopify_product_id != null ? Number(r.shopify_product_id) : null,
		shopifyVariantId: r.shopify_variant_id != null ? Number(r.shopify_variant_id) : null,
		sortOrder: Number(r.sort_order) ?? 0
	}));
}

/** Format product pricing as text for agent rules / system prompt. */
export function formatProductPricingForAgent(products: ProductPricing[]): string {
	if (!products.length) return 'No product pricing configured.';
	return products
		.map((p) => `${p.sizeLitres}L covers ${p.coverageSqm} m² – $${p.price.toFixed(2)} ${p.currency}`)
		.join('. ');
}
