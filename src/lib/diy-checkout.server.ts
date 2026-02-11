/**
 * Shared DIY checkout logic: create Shopify draft order or cart URL and return structured preview.
 * Uses roof-kit calculator (LRDIY logic) when roof_size_sqm is provided; otherwise bucket counts.
 * Cart URL format matches LRDIY_LandingPages (same checkout link creation logic).
 */

import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import { flattenProductVariants, getProductPricingForOwner } from '$lib/product-pricing.server';
import type { ProductPricing } from '$lib/product-pricing.server';
import {
	buildShopifyCartUrl,
	createDraftOrder,
	FIXED_DISCOUNT_CODE_BY_PERCENT,
	getDiyProductImages,
	getShopifyConfigForUser
} from '$lib/shopify.server';
import {
	calculateRoofKitBreakdown,
	findOptimalBuckets,
	productListToRoofKitVariants,
	type RoofKitLineItem,
	type RoofKitRoleHandles
} from '$lib/roof-kit-calculator.server';
import { getDefaultKitBuilderConfig } from '$lib/diy-kit-builder.server';

export type DiyCheckoutInput = {
	roof_size_sqm?: number;
	count_15l?: number;
	count_10l?: number;
	count_5l?: number;
	discount_percent?: number;
	email?: string;
};

export type DiyCheckoutResult = {
	checkoutUrl: string;
	lineItemsUI: Array<{
		imageUrl: string | null;
		title: string;
		variant: string | null;
		quantity: number;
		unitPrice: string;
		lineTotal: string;
	}>;
	summary: {
		totalItems: number;
		subtotal: string;
		total: string;
		currency: string;
		discountPercent?: number;
		discountAmount?: string;
	};
	/** Style overrides from kit builder (checkout button, qty badge). */
	styleOverrides?: { checkoutButtonColor?: string; qtyBadgeBackgroundColor?: string };
};

/** Cost-optimized bucket selection (LRIDY-style DP). Returns counts by size and litres needed. */
function calculateBucketsFromRoofSize(
	roofSqm: number,
	products: Array<{ sizeLitres: number; coverageSqm: number; price: number }>
): { countsBySize: Record<number, number>; litres: number } {
	const sqmPerLitre = products[0]?.coverageSqm || 2;
	const litresNeeded = Math.ceil((roofSqm / sqmPerLitre) * 100) / 100;
	const variants = products.map((p) => ({ size: p.sizeLitres, price: p.price }));
	const buckets = findOptimalBuckets(litresNeeded, variants);
	const countsBySize: Record<number, number> = {};
	for (const b of buckets) {
		countsBySize[b.size] = (countsBySize[b.size] ?? 0) + b.quantity;
	}
	return { countsBySize, litres: litresNeeded };
}

const normHandle = (h: string | null | undefined) => h?.trim().toLowerCase() ?? '';

/** Map (product_handle, role) -> display_name from kit product_entries. */
function displayNameMap(
	productEntries: Array<{ product_handle?: string; role?: string; display_name?: string | null }>
): Map<string, string> {
	const m = new Map<string, string>();
	for (const e of productEntries) {
		const h = e.product_handle?.trim();
		const r = e.role?.trim();
		const d = e.display_name?.trim();
		if (h && r && d) m.set(normHandle(h) + '|' + r, d);
	}
	return m;
}

/** Map product_handle -> display_name (first entry per handle). Used when handle|role lookup misses. */
function displayNameByHandleOnly(
	productEntries: Array<{ product_handle?: string; role?: string; display_name?: string | null }>
): Map<string, string> {
	const m = new Map<string, string>();
	for (const e of productEntries) {
		const h = e.product_handle?.trim();
		const d = e.display_name?.trim();
		if (h && d && !m.has(normHandle(h))) m.set(normHandle(h), d);
	}
	return m;
}

/** Resolve roof-kit breakdown to checkout line items (match by role → handles from config, then size). */
function resolveRoofKitToLineItems(
	kitItems: RoofKitLineItem[],
	products: ProductPricing[],
	roleHandles: RoofKitRoleHandles,
	imageBySize: Record<number, string>,
	productEntries?: Array<{ product_handle?: string; role?: string; display_name?: string | null }>
): Array<{ title: string; quantity: number; price: string; imageUrl?: string; variantId?: number; productHandle?: string | null }> {
	const displayByHandleRole = productEntries?.length ? displayNameMap(productEntries) : new Map<string, string>();
	const displayByHandle = productEntries?.length ? displayNameByHandleOnly(productEntries) : new Map<string, string>();
	const out: Array<{ title: string; quantity: number; price: string; imageUrl?: string; variantId?: number; productHandle?: string | null }> = [];
	for (const item of kitItems) {
		const handlesForRole = roleHandles[item.role];
		const handleSet = new Set(
			Array.isArray(handlesForRole) ? handlesForRole.filter(Boolean).map((h) => normHandle(h)) : []
		);
		const productsForRole = products.filter((p) => handleSet.has(normHandle(p.productHandle)));
		let product: ProductPricing | undefined = productsForRole.find((p) =>
			p.variants.some((v) => v.sizeLitres === item.sizeLitres)
		);
		if (!product && item.role === 'brushRoller' && productsForRole.length) {
			const brushOnly = item.label.toLowerCase().includes('brush kit') && !item.label.toLowerCase().includes('roller');
			product = brushOnly
				? productsForRole.find((p) => p.name.toLowerCase().includes('brush') && !p.name.toLowerCase().includes('roller')) ?? productsForRole[0]
				: productsForRole.find((p) => p.name.toLowerCase().includes('roller')) ?? productsForRole.at(-1);
		}
		if (!product) continue;
		const variant = product.variants.find((v) => v.sizeLitres === item.sizeLitres) ?? product.variants[0];
		if (!variant) continue;
		const key = normHandle(product.productHandle ?? '') + '|' + item.role;
		// Prefer "Name in checkout" from kit builder: handle|role first, then handle-only fallback
		let customName = displayByHandleRole.get(key)?.trim() || displayByHandle.get(normHandle(product.productHandle ?? ''))?.trim();
		// Strip trailing variant (e.g. " 15L") so we always append the correct size once: "{chosen name} {variant size}"
		if (customName) customName = customName.replace(/\s*\d+\s*L\s*$/i, '').trim() || customName;
		const baseName = customName || product.name;
		const sizeSuffix = variant.sizeLitres > 0 ? ` ${variant.sizeLitres}L` : '';
		const title = baseName + sizeSuffix;
		out.push({
			title,
			quantity: item.quantity,
			price: variant.price.toFixed(2),
			imageUrl: variant.imageUrl ?? imageBySize[variant.sizeLitres],
			variantId: variant.shopifyVariantId ?? undefined,
			productHandle: product.productHandle ?? undefined
		});
	}
	return out;
}

/**
 * Create a DIY checkout for the given owner. Returns structured preview for widget/n8n.
 * Requires Shopify connected and product pricing configured.
 */
export async function createDiyCheckoutForOwner(
	admin: SupabaseClient,
	ownerId: string,
	input: DiyCheckoutInput
): Promise<{ ok: true; data: DiyCheckoutResult } | { ok: false; error: string }> {
	const config = await getShopifyConfigForUser(admin, ownerId);
	if (!config) {
		return { ok: false, error: 'Shopify is not connected. Connect Shopify in Settings → Integrations.' };
	}

	const products = await getProductPricingForOwner(ownerId);
	if (!products.length) {
		return { ok: false, error: 'No product pricing configured. Add products in Settings → Product Pricing.' };
	}

	const kitConfig = await getDefaultKitBuilderConfig(admin, ownerId);
	const styleOverrides: DiyCheckoutResult['styleOverrides'] = {};
	if (kitConfig?.checkout_button_color?.trim()) {
		styleOverrides.checkoutButtonColor = kitConfig.checkout_button_color.trim();
	}
	if (kitConfig?.qty_badge_background_color?.trim()) {
		styleOverrides.qtyBadgeBackgroundColor = kitConfig.qty_badge_background_color.trim();
	}

	const { roof_size_sqm, count_15l, count_10l, count_5l, discount_percent, email } = input;
	let lineItems: Array<{
		title: string;
		quantity: number;
		price: string;
		imageUrl?: string;
		variantId?: number;
		productHandle?: string | null;
	}> = [];
	let litres = 0;
	let notePrefix = 'DIY quote';

	const flat = flattenProductVariants(products);
	// Optional display names from kit config (first entry per handle wins)
	const displayNameByHandle = new Map<string, string>();
	if (kitConfig?.product_entries?.length) {
		for (const e of kitConfig.product_entries) {
			const h = e.product_handle?.trim();
			const d = e.display_name?.trim();
			if (h && d && !displayNameByHandle.has(normHandle(h))) displayNameByHandle.set(normHandle(h), d);
		}
	}
	// Unique (productHandle, sizeLitres) with first variant's price for roof-kit
	const roofKitOptions = products.flatMap((p) => {
		const seen = new Set<number>();
		return p.variants
			.filter((v) => !seen.has(v.sizeLitres) && (seen.add(v.sizeLitres), true))
			.map((v) => ({ productHandle: p.productHandle, sizeLitres: v.sizeLitres, price: v.price }));
	});

	let imageBySize: Record<number, string> = {};
	try {
		imageBySize = await getDiyProductImages(
			config,
			flat.map((row) => ({
				size: row.sizeLitres,
				price: String(row.price),
				title: row.name,
				product_handle: row.productHandle ?? undefined
			}))
		);
	} catch {
		// ignore
	}
	if (!imageBySize[15] && env.DIY_PRODUCT_IMAGE_15L?.trim()) imageBySize[15] = env.DIY_PRODUCT_IMAGE_15L.trim();
	if (!imageBySize[10] && env.DIY_PRODUCT_IMAGE_10L?.trim()) imageBySize[10] = env.DIY_PRODUCT_IMAGE_10L.trim();
	if (!imageBySize[5] && env.DIY_PRODUCT_IMAGE_5L?.trim()) imageBySize[5] = env.DIY_PRODUCT_IMAGE_5L.trim();

	if (roof_size_sqm != null && roof_size_sqm >= 1) {
		const roleHandles = kitConfig?.role_handles;
		const hasRoleConfig =
			roleHandles &&
			Object.values(roleHandles).some((arr) => Array.isArray(arr) && arr.length > 0);

		if (hasRoleConfig && roleHandles) {
			const variants = productListToRoofKitVariants(roofKitOptions, roleHandles);
			const breakdown = calculateRoofKitBreakdown(
				Number(roof_size_sqm),
				variants,
				kitConfig?.coverage_overrides ?? {}
			);
			litres = breakdown.sealantLitres;
			notePrefix = `${kitConfig?.name ?? 'DIY'} ${roof_size_sqm}m²`;
			lineItems = resolveRoofKitToLineItems(breakdown.lineItems, products, roleHandles, imageBySize, kitConfig.product_entries);
		}

		// Fallback: no calculator config or roof-kit yielded no items → simple coating-only (litres = roof/2, any bucket product).
		if (lineItems.length === 0) {
			const bucketSizes = flat.filter((r) => r.sizeLitres >= 1);
			const seenSize = new Set<number>();
			const firstPerSize = bucketSizes.filter((r) => {
				if (seenSize.has(r.sizeLitres)) return false;
				seenSize.add(r.sizeLitres);
				return true;
			});
			if (firstPerSize.length > 0) {
				const { countsBySize, litres: fallbackLitres } = calculateBucketsFromRoofSize(
					Number(roof_size_sqm),
					firstPerSize.map((r) => ({
						sizeLitres: r.sizeLitres,
						coverageSqm: r.coverageSqm || 2,
						price: r.price
					}))
				);
				litres = fallbackLitres;
				notePrefix = `DIY ${roof_size_sqm}m²`;
				for (const row of firstPerSize) {
					const qty = countsBySize[row.sizeLitres] ?? 0;
					if (qty > 0) {
						let customName = row.productHandle ? displayNameByHandle.get(normHandle(row.productHandle)) : undefined;
						if (customName) customName = customName.replace(/\s*\d+\s*L\s*$/i, '').trim() || customName;
						const sizeSuffix = row.sizeLitres > 0 ? ` ${row.sizeLitres}L` : '';
						const title = customName ? customName + sizeSuffix : row.name;
						lineItems.push({
							title,
							quantity: qty,
							price: row.price.toFixed(2),
							imageUrl: row.imageUrl ?? imageBySize[row.sizeLitres],
							variantId: row.shopifyVariantId ?? undefined,
							productHandle: row.productHandle ?? undefined
						});
					}
				}
			}
		}
	} else if (
		(count_15l ?? 0) > 0 ||
		(count_10l ?? 0) > 0 ||
		(count_5l ?? 0) > 0
	) {
		const countsBySize: Record<number, number> = {
			15: Math.max(0, count_15l ?? 0),
			10: Math.max(0, count_10l ?? 0),
			5: Math.max(0, count_5l ?? 0)
		};
		litres = Object.entries(countsBySize).reduce((sum, [size, qty]) => sum + Number(size) * qty, 0);
		// One variant per size (first from flattened list)
		const seenSize = new Set<number>();
		for (const row of flat) {
			const qty = countsBySize[row.sizeLitres] ?? 0;
			if (qty > 0 && !seenSize.has(row.sizeLitres)) {
				seenSize.add(row.sizeLitres);
				let customName = row.productHandle ? displayNameByHandle.get(normHandle(row.productHandle)) : undefined;
				if (customName) customName = customName.replace(/\s*\d+\s*L\s*$/i, '').trim() || customName;
				const sizeSuffix = row.sizeLitres > 0 ? ` ${row.sizeLitres}L` : '';
				const title = customName ? customName + sizeSuffix : row.name;
				lineItems.push({
					title,
					quantity: qty,
					price: row.price.toFixed(2),
					imageUrl: row.imageUrl ?? imageBySize[row.sizeLitres],
					variantId: row.shopifyVariantId ?? undefined,
					productHandle: row.productHandle ?? undefined
				});
			}
		}
	} else {
		return { ok: false, error: 'Provide roof_size_sqm or at least one bucket count (count_15l, count_10l, count_5l).' };
	}

	if (lineItems.length === 0) {
		return { ok: false, error: 'No items to add. Provide roof_size_sqm or bucket counts.' };
	}

	const currency = products[0]?.variants?.[0]?.currency ?? flat[0]?.currency ?? 'AUD';
	const subtotal = lineItems.reduce((sum, li) => sum + Number.parseFloat(li.price) * li.quantity, 0);
	let appliedDiscount:
		| { title: string; description: string; value_type: 'percentage'; value: string; amount: string }
		| undefined;
	if (discount_percent != null && discount_percent >= 1 && discount_percent <= 20) {
		const amount = Math.round((subtotal * discount_percent) / 100 * 100) / 100;
		appliedDiscount = {
			title: `${discount_percent}% off`,
			description: `Chat discount - ${discount_percent}% off`,
			value_type: 'percentage',
			value: String(discount_percent),
			amount: amount.toFixed(2)
		};
	}
	const discountAmount = appliedDiscount ? Number.parseFloat(appliedDiscount.amount) : 0;
	const total = Math.round((subtotal - discountAmount) * 100) / 100;

	const noteParts = lineItems.map((li) => `${li.quantity}× ${li.title}`).join(', ');
	const orderNote = `${notePrefix}: ${litres}L sealant (${noteParts})`;
	const totalItems = lineItems.reduce((sum, li) => sum + li.quantity, 0);
	const itemsWithVariants = lineItems.filter((li) => li.variantId != null && li.variantId > 0);
	const allHaveVariantIds = itemsWithVariants.length === lineItems.length && lineItems.length > 0;
	const discountCode =
		discount_percent != null && discount_percent >= 1 && discount_percent <= 20
			? FIXED_DISCOUNT_CODE_BY_PERCENT[discount_percent] ?? undefined
			: undefined;

	// Same checkout link creation as LRDIY: cart permalink when all items have variant IDs
	if (allHaveVariantIds && config.shopDomain) {
		const cartUrl = buildShopifyCartUrl(
			config.shopDomain,
			lineItems.map((li) => ({ variantId: li.variantId!, quantity: li.quantity })),
			{ discountCode, note: orderNote }
		);
		const fmt = (n: number) => n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		const lineItemsUI = lineItems.map((li) => {
			const unitPrice = Number(li.price);
			const lineTotal = unitPrice * li.quantity;
			const variantMatch = /\d+\s*L\b|\d+\s*m\b/i.exec(li.title);
			const variant = variantMatch ? variantMatch[0].trim() : null;
			const imageUrl =
				li.imageUrl && String(li.imageUrl).trim() ? String(li.imageUrl).trim() : null;
			return {
				imageUrl,
				title: li.title,
				variant,
				quantity: li.quantity,
				unitPrice: fmt(unitPrice),
				lineTotal: fmt(lineTotal),
				...(li.productHandle != null && li.productHandle !== '' && { product_handle: li.productHandle })
			};
		});
		const summary = {
			totalItems,
			subtotal: fmt(subtotal),
			total: fmt(total),
			currency,
			...(appliedDiscount
				? {
						discountPercent: Number(appliedDiscount.value),
						discountAmount: fmt(discountAmount)
					}
				: {})
		};
		return {
			ok: true,
			data: {
				checkoutUrl: cartUrl,
				lineItemsUI,
				summary,
				...(Object.keys(styleOverrides).length > 0 && { styleOverrides })
			}
		};
	}

	// Fallback: draft order (when variant IDs missing or cart URL not desired)
	const result = await createDraftOrder(config, {
		email: email?.trim() || undefined,
		line_items: lineItems.map((li) => ({
			title: li.title,
			quantity: li.quantity,
			price: li.price,
			variant_id: li.variantId
		})),
		note: orderNote,
		tags: 'diy,chat',
		currency,
		applied_discount: appliedDiscount
	});

	// If variant is unavailable/invalid (wrong ID, deleted, unpublished, etc.), retry without variant_id (custom line items).
	// Shopify can return various messages: "no longer available", "could not be found", "variant not found", "unavailable", etc.
	// Note: Retry yields an invoice link, not a cart permalink, but the customer can still complete purchase.
	const variantErrorPatterns = [
		'no longer available',
		'not found',
		'could not be found',
		'unavailable',
		'variant',
		'invalid variant',
		'does not exist',
		'merchandise'
	];
	const isVariantError =
		!result.ok &&
		result.error &&
		variantErrorPatterns.some((p) => String(result.error).toLowerCase().includes(p));
	if (isVariantError) {
		console.warn('[DIY Checkout] Draft order failed (likely variant issue), retrying without variant_id. Error:', result.error);
		const retryResult = await createDraftOrder(config, {
			email: email?.trim() || undefined,
			line_items: lineItems.map((li) => ({
				title: li.title,
				quantity: li.quantity,
				price: li.price
				// Omit variant_id - Shopify will create custom line items
			})),
			note: orderNote,
			tags: 'diy,chat',
			currency,
			applied_discount: appliedDiscount
		});
		if (!retryResult.ok) {
			return { ok: false, error: retryResult.error ?? 'Failed to create checkout link. Product may be unavailable in Shopify.' };
		}
		// Use retry result - it has the same structure as result
		// Note: Without variant IDs, this will be an invoice link, not a checkout link
		if (!retryResult.checkoutUrl) return { ok: false, error: 'Checkout link was not returned by Shopify.' };
		
		// Warn if we're falling back to invoice link due to missing variant IDs
		if (itemsWithVariants.length === 0) {
			console.warn('[DIY Checkout] No variant IDs configured in product pricing. Using invoice link instead of checkout link. Configure shopifyVariantId in product pricing to get proper checkout links.');
		}
		
		const fmt = (n: number) => n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		const totalItems = lineItems.reduce((sum, li) => sum + li.quantity, 0);

		const lineItemsUI = lineItems.map((li) => {
			const unitPrice = Number(li.price);
			const quantity = li.quantity;
			const lineTotal = unitPrice * quantity;
			const variantMatch = /\d+\s*L\b/i.exec(li.title);
			const variant = variantMatch ? variantMatch[0].trim() : null;
			const imageUrl =
				li.imageUrl && String(li.imageUrl).trim() ? String(li.imageUrl).trim() : null;
			return {
				imageUrl,
				title: li.title,
				variant,
				quantity,
				unitPrice: fmt(unitPrice),
				lineTotal: fmt(lineTotal),
				...(li.productHandle != null && li.productHandle !== '' && { product_handle: li.productHandle })
			};
		});

		const summary = {
			totalItems,
			subtotal: fmt(subtotal),
			total: fmt(total),
			currency,
			...(appliedDiscount
				? {
						discountPercent: Number(appliedDiscount.value),
						discountAmount: fmt(discountAmount)
					}
				: {})
		};

		return {
			ok: true,
			data: {
				checkoutUrl: retryResult.checkoutUrl,
				lineItemsUI,
				summary,
				...(Object.keys(styleOverrides).length > 0 && { styleOverrides })
			}
		};
	}

	if (!result.ok) return { ok: false, error: result.error ?? 'Failed to create checkout link' };
	if (!result.checkoutUrl) return { ok: false, error: 'Checkout link was not returned by Shopify.' };

	const fmt = (n: number) => n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

	const lineItemsUI = lineItems.map((li) => {
		const unitPrice = Number(li.price);
		const quantity = li.quantity;
		const lineTotal = unitPrice * quantity;
		const variantMatch = /\d+\s*L\b/i.exec(li.title);
		const variant = variantMatch ? variantMatch[0].trim() : null;
		const imageUrl =
			li.imageUrl && String(li.imageUrl).trim() ? String(li.imageUrl).trim() : null;
		return {
			imageUrl,
			title: li.title,
			variant,
			quantity,
			unitPrice: fmt(unitPrice),
			lineTotal: fmt(lineTotal),
			...(li.productHandle != null && li.productHandle !== '' && { product_handle: li.productHandle })
		};
	});

	const summary = {
		totalItems,
		subtotal: fmt(subtotal),
		total: fmt(total),
		currency,
		...(appliedDiscount
			? {
					discountPercent: Number(appliedDiscount.value),
					discountAmount: fmt(discountAmount)
				}
			: {})
	};

	return {
		ok: true,
		data: {
			checkoutUrl: result.checkoutUrl,
			lineItemsUI,
			summary,
			...(Object.keys(styleOverrides).length > 0 && { styleOverrides })
		}
	};
}

/** Bucket breakdown for display only. No Shopify call. AI uses this for "how much" questions instead of calculating. */
export type BucketBreakdownResult = {
	lineItemsUI: Array<{ title: string; quantity: number; unitPrice: string; lineTotal: string }>;
	summary: { totalItems: number; subtotal: string; total: string; currency: string };
	litres: number;
	roofSizeSqm: number;
};

export async function calculateBucketBreakdownForOwner(
	admin: SupabaseClient,
	ownerId: string,
	input: { roof_size_sqm: number; discount_percent?: number }
): Promise<{ ok: true; data: BucketBreakdownResult } | { ok: false; error: string }> {
	const { roof_size_sqm, discount_percent } = input;
	if (roof_size_sqm == null || roof_size_sqm < 1) {
		return { ok: false, error: 'roof_size_sqm is required and must be at least 1.' };
	}

	const products = await getProductPricingForOwner(ownerId);
	if (!products.length) {
		return { ok: false, error: 'No product pricing configured. Add products in Settings → Product Pricing.' };
	}

	const kitConfig = await getDefaultKitBuilderConfig(admin, ownerId);
	const flat = flattenProductVariants(products);
	const displayNameByHandle = new Map<string, string>();
	if (kitConfig?.product_entries?.length) {
		for (const e of kitConfig.product_entries) {
			const h = e.product_handle?.trim();
			const d = e.display_name?.trim();
			if (h && d && !displayNameByHandle.has(normHandle(h))) displayNameByHandle.set(normHandle(h), d);
		}
	}
	const roofKitOptions = products.flatMap((p) => {
		const seen = new Set<number>();
		return p.variants
			.filter((v) => !seen.has(v.sizeLitres) && (seen.add(v.sizeLitres), true))
			.map((v) => ({ productHandle: p.productHandle, sizeLitres: v.sizeLitres, price: v.price }));
	});
	const imageBySize: Record<number, string> = {};

	let lineItems: Array<{ title: string; quantity: number; price: string }> = [];
	let litres = 0;

	const roleHandles = kitConfig?.role_handles;
	const hasRoleConfig =
		roleHandles && Object.values(roleHandles).some((arr) => Array.isArray(arr) && arr.length > 0);

	if (hasRoleConfig && roleHandles) {
		const variants = productListToRoofKitVariants(roofKitOptions, roleHandles);
		const breakdown = calculateRoofKitBreakdown(
			Number(roof_size_sqm),
			variants,
			kitConfig?.coverage_overrides ?? {}
		);
		litres = breakdown.sealantLitres;
		const resolved = resolveRoofKitToLineItems(
			breakdown.lineItems,
			products,
			roleHandles,
			imageBySize,
			kitConfig.product_entries
		);
		lineItems = resolved.map((r) => ({ title: r.title, quantity: r.quantity, price: r.price }));
	}

	if (lineItems.length === 0) {
		const bucketSizes = flat.filter((r) => r.sizeLitres >= 1);
		const seenSize = new Set<number>();
		const firstPerSize = bucketSizes.filter((r) => {
			if (seenSize.has(r.sizeLitres)) return false;
			seenSize.add(r.sizeLitres);
			return true;
		});
		if (firstPerSize.length > 0) {
			const { countsBySize, litres: fallbackLitres } = calculateBucketsFromRoofSize(
				Number(roof_size_sqm),
				firstPerSize.map((r) => ({
					sizeLitres: r.sizeLitres,
					coverageSqm: r.coverageSqm || 2,
					price: r.price
				}))
			);
			litres = fallbackLitres;
			for (const row of firstPerSize) {
				const qty = countsBySize[row.sizeLitres] ?? 0;
				if (qty > 0) {
					let customName = row.productHandle ? displayNameByHandle.get(normHandle(row.productHandle)) : undefined;
					if (customName) customName = customName.replace(/\s*\d+\s*L\s*$/i, '').trim() || customName;
					const sizeSuffix = row.sizeLitres > 0 ? ` ${row.sizeLitres}L` : '';
					lineItems.push({
						title: customName ? customName + sizeSuffix : row.name,
						quantity: qty,
						price: row.price.toFixed(2)
					});
				}
			}
		}
	}

	if (lineItems.length === 0) return { ok: false, error: 'No items calculated. Check product pricing and DIY kit config.' };

	const currency = products[0]?.variants?.[0]?.currency ?? flat[0]?.currency ?? 'AUD';
	const subtotal = lineItems.reduce((sum, li) => sum + Number.parseFloat(li.price) * li.quantity, 0);
	let discountAmount = 0;
	if (discount_percent != null && discount_percent >= 1 && discount_percent <= 20) {
		discountAmount = Math.round((subtotal * discount_percent) / 100 * 100) / 100;
	}
	const total = Math.round((subtotal - discountAmount) * 100) / 100;
	const fmt = (n: number) => n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

	const lineItemsUI = lineItems.map((li) => {
		const unitPrice = Number(li.price);
		const lineTotal = unitPrice * li.quantity;
		return { title: li.title, quantity: li.quantity, unitPrice: fmt(unitPrice), lineTotal: fmt(lineTotal) };
	});

	const totalItems = lineItems.reduce((s, li) => s + li.quantity, 0);
	const summary: {
		totalItems: number;
		subtotal: string;
		total: string;
		currency: string;
		discountPercent?: number;
		discountAmount?: string;
	} = {
		totalItems,
		subtotal: fmt(subtotal),
		total: fmt(total),
		currency
	};
	if (discount_percent != null && discount_percent >= 1 && discountAmount > 0) {
		summary.discountPercent = discount_percent;
		summary.discountAmount = fmt(discountAmount);
	}

	return {
		ok: true,
		data: {
			lineItemsUI,
			summary,
			litres,
			roofSizeSqm: roof_size_sqm
		}
	};
}
