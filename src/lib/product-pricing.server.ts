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
	/** Coverage rate in square metres per litre (sqm/L) */
	coverageSqm: number;
	imageUrl: string | null;
	description: string | null;
	colors: string[] | null;
	shopifyProductId: number | null;
	shopifyVariantId: number | null;
	sortOrder: number;
	/** Roof-kit product type; null = waterproof-sealant (backward compat) */
	productHandle: string | null;
};

const DEFAULT_PRODUCTS: Omit<ProductPricing, 'id'>[] = [
	{ name: 'NetZero UltraTherm 15L Bucket', sizeLitres: 15, price: 389.99, currency: 'AUD', coverageSqm: 2, imageUrl: null, description: null, colors: null, shopifyProductId: null, shopifyVariantId: null, sortOrder: 0, productHandle: null },
	{ name: 'NetZero UltraTherm 10L Bucket', sizeLitres: 10, price: 285.99, currency: 'AUD', coverageSqm: 2, imageUrl: null, description: null, colors: null, shopifyProductId: null, shopifyVariantId: null, sortOrder: 1, productHandle: null },
	{ name: 'NetZero UltraTherm 5L Bucket', sizeLitres: 5, price: 149.99, currency: 'AUD', coverageSqm: 2, imageUrl: null, description: null, colors: null, shopifyProductId: null, shopifyVariantId: null, sortOrder: 2, productHandle: null }
];

/** Fetch product pricing for a user. Returns DB rows or defaults if empty. */
export async function getProductPricingForUser(
	supabase: SupabaseClient,
	userId: string
): Promise<ProductPricing[]> {
	const { data: rows, error } = await supabase
		.from('product_pricing')
		.select('id, name, size_litres, price, currency, coverage_sqm, image_url, description, colors, shopify_product_id, shopify_variant_id, sort_order, product_handle')
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

	return rows.map((r) => mapRow(r));
}

function mapRow(r: Record<string, unknown>): ProductPricing {
	return {
		id: r.id as string,
		name: (r.name as string) ?? '',
		sizeLitres: Number(r.size_litres) ?? 0,
		price: Number(r.price) ?? 0,
		currency: (r.currency as string) ?? 'AUD',
		coverageSqm: Number(r.coverage_sqm) ?? 0,
		imageUrl: (r.image_url as string | null) ?? null,
		description: (r.description as string | null) ?? null,
		colors: Array.isArray(r.colors) ? (r.colors as string[]) : null,
		shopifyProductId: r.shopify_product_id != null ? Number(r.shopify_product_id) : null,
		shopifyVariantId: r.shopify_variant_id != null ? Number(r.shopify_variant_id) : null,
		sortOrder: Number(r.sort_order) ?? 0,
		productHandle: (r.product_handle as string | null) ?? null
	};
}

/** Fetch via admin client (for agent tools where we have ownerId). */
export async function getProductPricingForOwner(ownerId: string): Promise<ProductPricing[]> {
	const admin = getSupabaseAdmin();
	const { data: rows, error } = await admin
		.from('product_pricing')
		.select('id, name, size_litres, price, currency, coverage_sqm, image_url, description, colors, shopify_product_id, shopify_variant_id, sort_order, product_handle')
		.eq('created_by', ownerId)
		.order('sort_order', { ascending: true })
		.order('size_litres', { ascending: false });

	if (error || !rows?.length) {
		return DEFAULT_PRODUCTS.map((p, i) => ({ ...p, id: `default-${i}` }));
	}

	return rows.map((r) => mapRow(r));
}

/** Format product pricing as text for agent rules / system prompt. */
export function formatProductPricingForAgent(products: ProductPricing[]): string {
	if (!products.length) return 'No product pricing configured.';
	return products
		.map((p) => {
			const totalCoverage = p.coverageSqm * p.sizeLitres;
			let line = `${p.sizeLitres}L covers ${totalCoverage} m² (${p.coverageSqm} sqm/L) – $${p.price.toFixed(2)} ${p.currency}`;
			if (p.colors?.length) line += ` [Colors: ${p.colors.join(', ')}]`;
			return line;
		})
		.join('. ');
}
