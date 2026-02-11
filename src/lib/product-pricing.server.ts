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

/** Infer size (L) from image URL or text when variant has no sizeLitres (e.g. "5L_NetZero" or "_15L."). */
function inferSizeLitres(imageUrl: string | null, fallback: number): number {
	if (!imageUrl || typeof imageUrl !== 'string') return fallback;
	const re1 = /\b(15|10|5)\s*L\b/i;
	const re2 = /[-_/](15|10|5)\s*L(?:[-_/.]|$)/i;
	const m = re1.exec(imageUrl) ?? re2.exec(imageUrl);
	return m ? Number.parseInt(m[1], 10) : fallback;
}

function parseVariants(json: unknown): ProductVariant[] {
	if (!Array.isArray(json)) return [];
	return json.map((v) => {
		const raw = v as Record<string, unknown>;
		const imageUrl =
			(typeof raw?.imageUrl === 'string' ? raw.imageUrl : null) ??
			(typeof raw?.image_url === 'string' ? raw.image_url : null);
		let sizeLitres = Number(raw?.sizeLitres) || Number(raw?.size_litres) || 0;
		if (sizeLitres === 0 && imageUrl) sizeLitres = inferSizeLitres(imageUrl, 0);
		const coverageSqm = Number(raw?.coverageSqm) || Number(raw?.coverage_sqm) || 0;
		return {
			shopifyVariantId: raw?.shopifyVariantId == null ? null : Number(raw.shopifyVariantId),
			sizeLitres,
			color: typeof raw?.color === 'string' ? raw.color : null,
			price: Number(raw?.price) || 0,
			currency: typeof raw?.currency === 'string' ? raw.currency : 'AUD',
			coverageSqm,
			imageUrl: imageUrl?.trim() || null
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
	const sizes = new Set([15, 10, 5]);
	for (const p of products) {
		for (const v of p.variants) {
			const size = v.sizeLitres;
			if (sizes.has(size) && v.imageUrl?.trim() && !result[size]) result[size] = v.imageUrl.trim();
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

/** Format product pricing as compact text for agent system prompt. Prevents token bloat from repeating color lists per variant. */
export function formatProductPricingForAgent(products: ProductPricing[]): string {
	if (!products.length) return 'No product pricing configured.';
	const parts: string[] = [];
	for (const p of products) {
		// Group variants by size to avoid repeating product name and color list per variant
		const bySize = new Map<number, { white?: number; colours: number[]; currency: string; coverageSqm: number }>();
		for (const v of p.variants) {
			if (!bySize.has(v.sizeLitres)) {
				bySize.set(v.sizeLitres, { colours: [], currency: v.currency, coverageSqm: v.coverageSqm });
			}
			const entry = bySize.get(v.sizeLitres)!;
			if (!v.color || v.color.toLowerCase() === 'white') {
				entry.white = v.price;
			} else {
				entry.colours.push(v.price);
			}
		}
		const sizeLines: string[] = [];
		for (const [sizeLitres, { white, colours, currency, coverageSqm }] of Array.from(bySize.entries()).sort(
			(a, b) => b[0] - a[0]
		)) {
			const totalCoverage = coverageSqm * sizeLitres;
			const priceParts: string[] = [];
			if (white != null) priceParts.push(`White $${white.toFixed(2)}`);
			const uniqueColourPrices = [...new Set(colours)];
			if (uniqueColourPrices.length) priceParts.push(`colours $${uniqueColourPrices[0].toFixed(2)}`);
			if (priceParts.length === 0 && p.variants.some((v) => v.sizeLitres === sizeLitres)) {
				const v = p.variants.find((x) => x.sizeLitres === sizeLitres)!;
				priceParts.push(`$${v.price.toFixed(2)}`);
			}
			sizeLines.push(`${sizeLitres}L: ${totalCoverage} m² (${coverageSqm} sqm/L) – ${priceParts.join(', ')} ${currency}`);
		}
		let out = `${p.name}. ${sizeLines.join('. ')}`;
		if (p.colors?.length) out += ` Colours: ${p.colors.join(', ')}.`;
		parts.push(out);
	}
	return parts.join(' ');
}
