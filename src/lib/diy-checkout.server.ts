/**
 * Shared DIY checkout logic: create Shopify draft order and return structured preview.
 * Used by the agent tool (direct LLM) and by the n8n-callable API.
 */

import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getProductPricingForOwner } from '$lib/product-pricing.server';
import {
	createDraftOrder,
	getDiyProductImages,
	getShopifyConfigForUser
} from '$lib/shopify.server';

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
	products: Array<{ sizeLitres: number }>
): { countsBySize: Record<number, number>; litres: number } {
	const litres = Math.ceil(roofSqm / 2);
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
	let countsBySize: Record<number, number> = {};
	let litres = 0;

	if (roof_size_sqm != null && roof_size_sqm >= 1) {
		const calc = calculateBucketsFromRoofSize(Number(roof_size_sqm), products);
		countsBySize = calc.countsBySize;
		litres = calc.litres;
	} else if (
		(count_15l ?? 0) > 0 ||
		(count_10l ?? 0) > 0 ||
		(count_5l ?? 0) > 0
	) {
		const sorted = [...products].sort((a, b) => b.sizeLitres - a.sizeLitres);
		const explicitCounts = [Math.max(0, count_15l ?? 0), Math.max(0, count_10l ?? 0), Math.max(0, count_5l ?? 0)];
		sorted.forEach((p, i) => {
			if (i < 3 && explicitCounts[i] > 0) countsBySize[p.sizeLitres] = explicitCounts[i];
		});
		litres = Object.entries(countsBySize).reduce((sum, [size, qty]) => sum + Number(size) * qty, 0);
	} else {
		return { ok: false, error: 'Provide roof_size_sqm or at least one bucket count (count_15l, count_10l, count_5l).' };
	}

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

	const lineItems: Array<{
		title: string;
		quantity: number;
		price: string;
		imageUrl?: string;
		variantId?: number;
	}> = [];
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
	const result = await createDraftOrder(config, {
		email: email?.trim() || undefined,
		line_items: lineItems.map((li) => ({
			title: li.title,
			quantity: li.quantity,
			price: li.price,
			variant_id: li.variantId
		})),
		note: `DIY quote: ${litres}L total (${noteParts})`,
		tags: 'diy,chat',
		currency,
		applied_discount: appliedDiscount
	});

	if (!result.ok) return { ok: false, error: result.error ?? 'Failed to create checkout link' };
	if (!result.checkoutUrl) return { ok: false, error: 'Checkout link was not returned by Shopify.' };

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
			checkoutUrl: result.checkoutUrl,
			lineItemsUI,
			summary
		}
	};
}
