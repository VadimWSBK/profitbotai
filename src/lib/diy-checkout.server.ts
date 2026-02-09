/**
 * Shared DIY checkout logic: create Shopify draft order or cart URL and return structured preview.
 * Uses roof-kit calculator (LRDIY logic) when roof_size_sqm is provided; otherwise bucket counts.
 * Cart URL format matches LRDIY_LandingPages (same checkout link creation logic).
 */

import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getProductPricingForOwner } from '$lib/product-pricing.server';
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
	productListToRoofKitVariants,
	type RoofKitLineItem
} from '$lib/roof-kit-calculator.server';

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
};

function calculateBucketsFromRoofSize(
	roofSqm: number,
	products: Array<{ sizeLitres: number; coverageSqm: number }>
): { countsBySize: Record<number, number>; litres: number } {
	// coverageSqm is now sqm/L rate. Use the first product's rate (they should all be the same) or default to 2.
	const sqmPerLitre = products[0]?.coverageSqm || 2;
	const litres = Math.ceil(roofSqm / sqmPerLitre);
	const sorted = [...products].sort((a, b) => b.sizeLitres - a.sizeLitres);
	const countsBySize: Record<number, number> = {};
	let remaining = litres;
	for (const p of sorted) {
		const size = p.sizeLitres;
		countsBySize[size] = 0;
		while (remaining >= size) {
			countsBySize[size]++;
			remaining -= size;
		}
	}
	if (remaining > 0 && sorted.length > 0) {
		const smallest = sorted.at(-1)!.sizeLitres;
		countsBySize[smallest] = (countsBySize[smallest] ?? 0) + 1;
	}
	return { countsBySize, litres };
}

/** Resolve roof-kit breakdown to checkout line items using product_pricing (match by handle + size). */
function resolveRoofKitToLineItems(
	kitItems: RoofKitLineItem[],
	products: ProductPricing[],
	imageBySize: Record<number, string>
): Array<{ title: string; quantity: number; price: string; imageUrl?: string; variantId?: number }> {
	const out: Array<{ title: string; quantity: number; price: string; imageUrl?: string; variantId?: number }> = [];
	for (const item of kitItems) {
		const handle = item.handle;
		const productsForHandle = products.filter(
			(p) => (p.productHandle ?? 'waterproof-sealant') === handle
		);
		// Match by sizeLitres; for brush-roller prefer label match if we have two variants
		let match = productsForHandle.find((p) => p.sizeLitres === item.sizeLitres);
		if (!match && handle === 'brush-roller' && productsForHandle.length) {
			const brushOnly = item.label.toLowerCase().includes('brush kit') && !item.label.toLowerCase().includes('roller');
			match = brushOnly
				? productsForHandle.find((p) => p.name.toLowerCase().includes('brush') && !p.name.toLowerCase().includes('roller')) ?? productsForHandle[0]
				: productsForHandle.find((p) => p.name.toLowerCase().includes('roller')) ?? productsForHandle[productsForHandle.length - 1];
		}
		if (!match) continue;
		out.push({
			title: match.name,
			quantity: item.quantity,
			price: match.price.toFixed(2),
			imageUrl: match.imageUrl ?? imageBySize[match.sizeLitres],
			variantId: match.shopifyVariantId ?? undefined
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

	const { roof_size_sqm, count_15l, count_10l, count_5l, discount_percent, email } = input;
	let lineItems: Array<{
		title: string;
		quantity: number;
		price: string;
		imageUrl?: string;
		variantId?: number;
	}> = [];
	let litres = 0;
	let notePrefix = 'DIY quote';

	let imageBySize: Record<number, string> = {};
	try {
		imageBySize = await getDiyProductImages(
			config,
			products.map((p) => ({ size: p.sizeLitres, price: String(p.price), title: p.name }))
		);
	} catch {
		// ignore
	}
	if (!imageBySize[15] && env.DIY_PRODUCT_IMAGE_15L?.trim()) imageBySize[15] = env.DIY_PRODUCT_IMAGE_15L.trim();
	if (!imageBySize[10] && env.DIY_PRODUCT_IMAGE_10L?.trim()) imageBySize[10] = env.DIY_PRODUCT_IMAGE_10L.trim();
	if (!imageBySize[5] && env.DIY_PRODUCT_IMAGE_5L?.trim()) imageBySize[5] = env.DIY_PRODUCT_IMAGE_5L.trim();

	if (roof_size_sqm != null && roof_size_sqm >= 1) {
		// Roof-kit calculator (LRDIY logic): area → sealant, thermal, sealer, geo, rapid-cure, bonus kit. Corrugated/painted only.
		const variants = productListToRoofKitVariants(
			products.map((p) => ({
				productHandle: p.productHandle,
				sizeLitres: p.sizeLitres,
				price: p.price
			}))
		);
		const breakdown = calculateRoofKitBreakdown(Number(roof_size_sqm), variants);
		litres = breakdown.sealantLitres;
		notePrefix = `Roof-Kit ${roof_size_sqm}m²`;
		lineItems = resolveRoofKitToLineItems(breakdown.lineItems, products, imageBySize);
	} else if (
		(count_15l ?? 0) > 0 ||
		(count_10l ?? 0) > 0 ||
		(count_5l ?? 0) > 0
	) {
		const countsBySize: Record<number, number> = {};
		const sorted = [...products].sort((a, b) => b.sizeLitres - a.sizeLitres);
		const explicitCounts = [Math.max(0, count_15l ?? 0), Math.max(0, count_10l ?? 0), Math.max(0, count_5l ?? 0)];
		sorted.forEach((p, i) => {
			if (i < 3 && explicitCounts[i] > 0) countsBySize[p.sizeLitres] = explicitCounts[i];
		});
		litres = Object.entries(countsBySize).reduce((sum, [size, qty]) => sum + Number(size) * qty, 0);
		for (const p of products) {
			const qty = countsBySize[p.sizeLitres] ?? 0;
			if (qty > 0) {
				lineItems.push({
					title: p.name,
					quantity: qty,
					price: p.price.toFixed(2),
					imageUrl: p.imageUrl ?? imageBySize[p.sizeLitres],
					variantId: p.shopifyVariantId ?? undefined
				});
			}
		}
	} else {
		return { ok: false, error: 'Provide roof_size_sqm or at least one bucket count (count_15l, count_10l, count_5l).' };
	}

	if (lineItems.length === 0) {
		return { ok: false, error: 'No items to add. Provide roof_size_sqm or bucket counts.' };
	}

	const currency = products[0]?.currency ?? 'AUD';
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
			return {
				imageUrl: li.imageUrl ?? null,
				title: li.title,
				variant,
				quantity: li.quantity,
				unitPrice: fmt(unitPrice),
				lineTotal: fmt(lineTotal)
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
				summary
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
			return {
				imageUrl: li.imageUrl ?? null,
				title: li.title,
				variant,
				quantity,
				unitPrice: fmt(unitPrice),
				lineTotal: fmt(lineTotal)
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
				summary
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
		return {
			imageUrl: li.imageUrl ?? null,
			title: li.title,
			variant,
			quantity,
			unitPrice: fmt(unitPrice),
			lineTotal: fmt(lineTotal)
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
			summary
		}
	};
}
