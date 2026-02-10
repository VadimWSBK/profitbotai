/**
 * Product pricing: one row per product; variants (size × color) in jsonb.
 * Used by agent rules, DIY checkout tool, and quote generation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '$lib/supabase.server';

export type ProductVariant = {
	shopifyVariantId: number | null;
	sizeLitres: number;
	/** Color option for this variant (e.g. "White", "Surfmist") */
	color: string | null;
	price: number;
	currency: string;
	coverageSqm: number;
	imageUrl: string | null;
};

export type ProductPricing = {
	id: string;
	name: string;
	description: string | null;
	/** Available color option names for this product (e.g. ["White", "Surfmist"]) */
	colors: string[] | null;
	shopifyProductId: number | null;
	sortOrder: number;
	/** Roof-kit product type; null = waterproof-sealant (backward compat) */
	productHandle: string | null;
	/** All variants (each size × color has its own variant ID and image) */
	variants: ProductVariant[];
};

/** Legacy single-variant shape for code that expects one variant per row. Use flattenProductVariants() to get this from ProductPricing[]. */
export type ProductPricingVariantRow = {
	id: string;
	name: string;
	sizeLitres: number;
	price: number;
	currency: string;
	coverageSqm: number;
	imageUrl: string | null;
	description: string | null;
	colors: string[] | null;
	shopifyProductId: number | null;
	shopifyVariantId: number | null;
	sortOrder: number;
	productHandle: string | null;
	/** When from a product with variants, the color for this variant */
	color: string | null;
};

const DEFAULT_PRODUCT: Omit<ProductPricing, 'id'> = {
	name: 'NetZero UltraTherm Roof Coating',
	description: null,
	colors: null,
	shopifyProductId: null,
	sortOrder: 0,
	productHandle: null,
	variants: [
		{ shopifyVariantId: null, sizeLitres: 15, color: null, price: 389.99, currency: 'AUD', coverageSqm: 2, imageUrl: null },
		{ shopifyVariantId: null, sizeLitres: 10, color: null, price: 285.99, currency: 'AUD', coverageSqm: 2, imageUrl: null },
		{ shopifyVariantId: null, sizeLitres: 5, color: null, price: 149.99, currency: 'AUD', coverageSqm: 2, imageUrl: null }
	]
};

function parseVariants(json: unknown): ProductVariant[] {
	if (!Array.isArray(json)) return [];
	return json.map((v) => {
		const raw = v as Record<string, unknown>;
		const imageUrl =
			(typeof raw?.imageUrl === 'string' ? raw.imageUrl : null) ??
			(typeof raw?.image_url === 'string' ? raw.image_url : null);
		return {
			shopifyVariantId: raw?.shopifyVariantId == null ? null : Number(raw.shopifyVariantId),
			sizeLitres: Number(raw?.sizeLitres) || 0,
			color: typeof raw?.color === 'string' ? raw.color : null,
			price: Number(raw?.price) || 0,
			currency: typeof raw?.currency === 'string' ? raw.currency : 'AUD',
			coverageSqm: Number(raw?.coverageSqm) || 0,
			imageUrl: imageUrl && imageUrl.trim() ? imageUrl.trim() : null
		};
	});
}

function mapRow(r: Record<string, unknown>): ProductPricing {
	const variantsJson = r.variants;
	const variants = parseVariants(variantsJson);
	const hasVariants = Array.isArray(variantsJson) && variants.length > 0;

	return {
		id: r.id as string,
		name: (r.name as string) ?? '',
		description: (r.description as string | null) ?? null,
		colors: Array.isArray(r.colors) ? (r.colors as string[]) : null,
		shopifyProductId: r.shopify_product_id == null ? null : Number(r.shopify_product_id),
		sortOrder: Number(r.sort_order) || 0,
		productHandle: (r.product_handle as string | null) ?? null,
		variants: hasVariants
			? variants
			: [
					{
						shopifyVariantId: r.shopify_variant_id == null ? null : Number(r.shopify_variant_id),
						sizeLitres: Number(r.size_litres) || 0,
						color: null,
						price: Number(r.price) || 0,
						currency: (r.currency as string) ?? 'AUD',
						coverageSqm: Number(r.coverage_sqm) || 0,
						imageUrl: (r.image_url as string | null) ?? null
					}
				]
	};
}

/** Fetch product pricing for a user. One row per product with variants in jsonb. */
export async function getProductPricingForUser(
	supabase: SupabaseClient,
	userId: string
): Promise<ProductPricing[]> {
	const { data: rows, error } = await supabase
		.from('product_pricing')
		.select('id, name, size_litres, price, currency, coverage_sqm, image_url, description, colors, shopify_product_id, shopify_variant_id, sort_order, product_handle, variants')
		.eq('created_by', userId)
		.order('sort_order', { ascending: true });

	if (error) {
		console.error('[product-pricing] getProductPricingForUser:', error);
		return [{ ...DEFAULT_PRODUCT, id: 'default-0' }];
	}

	if (!rows?.length) {
		return [{ ...DEFAULT_PRODUCT, id: 'default-0' }];
	}

	return rows.map((r) => mapRow(r));
}

/** Fetch via admin client (for agent tools where we have ownerId). */
export async function getProductPricingForOwner(ownerId: string): Promise<ProductPricing[]> {
	const admin = getSupabaseAdmin();
	const { data: rows, error } = await admin
		.from('product_pricing')
		.select('id, name, size_litres, price, currency, coverage_sqm, image_url, description, colors, shopify_product_id, shopify_variant_id, sort_order, product_handle, variants')
		.eq('created_by', ownerId)
		.order('sort_order', { ascending: true });

	if (error || !rows?.length) {
		return [{ ...DEFAULT_PRODUCT, id: 'default-0' }];
	}

	return rows.map((r) => mapRow(r));
}

/**
 * Get image URLs by size (15, 10, 5) from product_pricing for an owner.
 * One Supabase query, no external API. Use for Messages/widget enrichment when line items lack imageUrl.
 */
export async function getProductImageUrlsBySize(ownerId: string): Promise<Record<number, string>> {
	const products = await getProductPricingForOwner(ownerId);
	const result: Record<number, string> = {};
	const sizes = [15, 10, 5];
	for (const p of products) {
		for (const v of p.variants) {
			const size = v.sizeLitres;
			if (sizes.includes(size) && v.imageUrl?.trim() && !result[size]) result[size] = v.imageUrl.trim();
		}
	}
	return result;
}

/** Flatten products to one row per variant (for checkout/roof-kit that resolve by size). */
export function flattenProductVariants(products: ProductPricing[]): ProductPricingVariantRow[] {
	const out: ProductPricingVariantRow[] = [];
	let sortOrder = 0;
	for (const p of products) {
		for (const v of p.variants) {
			out.push({
				id: `${p.id}-${v.sizeLitres}-${v.color ?? ''}`,
				name: p.name + (v.sizeLitres > 0 ? ` ${v.sizeLitres}L` : ''),
				sizeLitres: v.sizeLitres,
				price: v.price,
				currency: v.currency,
				coverageSqm: v.coverageSqm,
				imageUrl: v.imageUrl,
				description: p.description,
				colors: p.colors,
				shopifyProductId: p.shopifyProductId,
				shopifyVariantId: v.shopifyVariantId,
				sortOrder: sortOrder++,
				productHandle: p.productHandle,
				color: v.color
			});
		}
	}
	return out;
}

/** Format product pricing as text for agent rules / system prompt. Lists each variant with size and color. */
export function formatProductPricingForAgent(products: ProductPricing[]): string {
	if (!products.length) return 'No product pricing configured.';
	const lines: string[] = [];
	for (const p of products) {
		const colorList = p.colors?.length ? ` [Colors: ${p.colors.join(', ')}]` : '';
		for (const v of p.variants) {
			const totalCoverage = v.coverageSqm * v.sizeLitres;
			const colorLabel = v.color ? ` ${v.color}` : '';
			lines.push(
				`${p.name} ${v.sizeLitres}L${colorLabel}: ${totalCoverage} m² (${v.coverageSqm} sqm/L) – $${v.price.toFixed(2)} ${v.currency}${colorList}`
			);
		}
	}
	return lines.join('. ');
}
