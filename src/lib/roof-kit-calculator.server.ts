/**
 * Roof-kit calculator: area (m²) → product breakdown.
 * Repurposed from LRDIY_LandingPages roof-kit calculator.
 * Uses corrugated/painted defaults only (concrete and raw metal toggles ignored).
 * Includes bonus kit (Brush Kit for area < 5 m², Brush + Roller Kit for area >= 5 m²).
 */

/** Corrugated profile rates (L/m² or m/m²) – same as LRDIY productConfig */
const CORRUGATED = {
	waterproofSealantPerM2: 1.5,
	thermalCoatingPerM2: 0.5,
	geoTextileMetersPerM2: 1,
	sealerPerM2: 1 / 8,
	etchPrimerPerM2: 1 / 6
} as const;

/** Coverage area for sealant/geo: 15% of total roof area (seams/cracks) */
const COVERAGE_FRACTION = 0.15;

/** Rapid-cure: 0.02 L per 1 L of waterproof sealant sold */
const RAPID_CURE_PER_SEALANT_LITRE = 0.02;

const ceil2 = (n: number) => Math.ceil(n * 100) / 100;

export type RoofKitLineItem = {
	handle: RoofKitHandle;
	/** Size in litres for buckets, or 0 for kits/rolls */
	sizeLitres: number;
	/** Label for display e.g. "15L", "100mm x 20m", "Brush + Roller Kit" */
	label: string;
	quantity: number;
};

export type RoofKitHandle =
	| 'waterproof-sealant'
	| 'protective-top-coat'
	| 'sealer'
	| 'geo-textile'
	| 'rapid-cure-spray'
	| 'brush-roller';

export type RoofKitBreakdown = {
	lineItems: RoofKitLineItem[];
	/** Total litres of sealant (for note) */
	sealantLitres: number;
	/** Total items count */
	totalItems: number;
};

/**
 * Optimal bucket combo for a given litres needed (price-minimising, same logic as LRDIY).
 * Variants sorted by size desc; max 3 of any size except the largest.
 */
function findOptimalBuckets(
	litresNeeded: number,
	variants: Array<{ size: number; price: number }>
): Array<{ size: number; quantity: number }> {
	if (!variants.length || litresNeeded <= 0) return [];
	const sorted = [...variants].sort((a, b) => b.size - a.size);
	const factor = 100;
	const needVol = Math.ceil(litresNeeded * factor);
	const biggest = Math.round(sorted[0].size * factor);
	const cap = needVol + biggest;

	type Entry = { cost: number; counts: number[] };
	const dp: (Entry | null)[] = Array(cap + 1).fill(null);
	dp[0] = { cost: 0, counts: Array(sorted.length).fill(0) };

	for (let vol = 0; vol <= cap; vol++) {
		const entry = dp[vol];
		if (!entry) continue;
		sorted.forEach((v, i) => {
			const nextVol = vol + Math.round(v.size * factor);
			if (nextVol > cap) return;
			const currentCount = entry.counts[i];
			const isLargest = i === 0;
			if (!isLargest && currentCount >= 3) return;
			const nextCost = entry.cost + v.price;
			const nextCounts = entry.counts.slice();
			nextCounts[i]++;
			const prev = dp[nextVol];
			if (!prev || nextCost < prev.cost) dp[nextVol] = { cost: nextCost, counts: nextCounts };
		});
	}

	let best: { vol: number; entry: Entry } | null = null;
	for (let vol = needVol; vol <= cap; vol++) {
		const entry = dp[vol];
		if (!entry && !best) continue;
		if (entry && (!best || entry.cost < best.entry.cost)) best = { vol, entry: entry! };
	}
	if (!best) return [];

	return sorted
		.map((v, i) => ({ size: v.size, quantity: best!.entry.counts[i] }))
		.filter((x) => x.quantity > 0);
}

/**
 * Compute roof-kit breakdown from area (m²).
 * Uses corrugated/painted only. Includes bonus kit.
 */
export function calculateRoofKitBreakdown(
	areaM2: number,
	/** Product variants per handle: size (L) and price for bucket products; single variant for kits/rolls */
	productVariants: {
		'waterproof-sealant': Array<{ size: number; price: number }>;
		'protective-top-coat': Array<{ size: number; price: number }>;
		sealer: Array<{ size: number; price: number }>;
		'geo-textile': Array<{ size: number; price: number }>;
		'rapid-cure-spray': Array<{ size: number; price: number }>;
		'brush-roller': Array<{ size: number; price: number }>;
	}
): RoofKitBreakdown {
	const lineItems: RoofKitLineItem[] = [];
	const coverageArea = ceil2(areaM2 * COVERAGE_FRACTION);

	// 1) Waterproof sealant: coverageArea × 1.5 L/m²
	const sealantLitres = ceil2(coverageArea * CORRUGATED.waterproofSealantPerM2);
	const sealantBuckets = findOptimalBuckets(sealantLitres, productVariants['waterproof-sealant']);
	sealantBuckets.forEach((b) => {
		lineItems.push({
			handle: 'waterproof-sealant',
			sizeLitres: b.size,
			label: `${b.size}L`,
			quantity: b.quantity
		});
	});

	// 2) Thermal coating: full area × 0.5 L/m²
	const thermalLitres = ceil2(areaM2 * CORRUGATED.thermalCoatingPerM2);
	const thermalBuckets = findOptimalBuckets(thermalLitres, productVariants['protective-top-coat']);
	thermalBuckets.forEach((b) => {
		lineItems.push({
			handle: 'protective-top-coat',
			sizeLitres: b.size,
			label: `${b.size}L`,
			quantity: b.quantity
		});
	});

	// 3) Sealer: coverage area / 8 L/m² (painted roof)
	const sealerLitres = ceil2(coverageArea * CORRUGATED.sealerPerM2);
	const sealerBuckets = findOptimalBuckets(sealerLitres, productVariants.sealer);
	sealerBuckets.forEach((b) => {
		lineItems.push({
			handle: 'sealer',
			sizeLitres: b.size,
			label: `${b.size}L`,
			quantity: b.quantity
		});
	});

	// 4) Geo-textile: 1 m per m² of coverage; optimal combo of 20m/50m/100m rolls
	const geoMetres = Math.ceil(coverageArea * CORRUGATED.geoTextileMetersPerM2);
	const geoRolls = findOptimalBuckets(geoMetres, productVariants['geo-textile']);
	geoRolls.forEach((b) => {
		lineItems.push({
			handle: 'geo-textile',
			sizeLitres: b.size,
			label: `${b.size}m Roll`,
			quantity: b.quantity
		});
	});

	// 5) Rapid-cure: 0.02 L per 1 L sealant
	const rapidLitres = ceil2(sealantLitres * RAPID_CURE_PER_SEALANT_LITRE);
	if (rapidLitres > 0 && productVariants['rapid-cure-spray'].length) {
		const sprayVariants = productVariants['rapid-cure-spray'];
		const bySize = sprayVariants.map((v) => ({ size: v.size, price: v.price }));
		const sprayBuckets = findOptimalBuckets(rapidLitres, bySize);
		sprayBuckets.forEach((b) => {
			lineItems.push({
				handle: 'rapid-cure-spray',
				sizeLitres: b.size,
				label: `${b.size}L Bottle`,
				quantity: b.quantity
			});
		});
	}

	// 6) Bonus kit: area < 5 → Brush Kit, area >= 5 → Brush + Roller Kit (use first variant if only one)
	const brushVariants = productVariants['brush-roller'];
	if (brushVariants.length) {
		const useBrushOnly = areaM2 < 5;
		// Prefer second variant for full kit (index 1), first for brush-only (index 0) when we have two
		const v =
			brushVariants.length >= 2
				? brushVariants[useBrushOnly ? 0 : 1]
				: brushVariants[0];
		lineItems.push({
			handle: 'brush-roller',
			sizeLitres: v.size ?? 0,
			label: useBrushOnly ? 'Brush Kit' : 'Brush + Roller Kit',
			quantity: 1
		});
	}

	const totalItems = lineItems.reduce((s, li) => s + li.quantity, 0);
	return {
		lineItems,
		sealantLitres,
		totalItems
	};
}

/**
 * Build product variants map from flat product list (e.g. from product_pricing with product_handle).
 * Products without a handle are treated as 'waterproof-sealant' for backward compatibility.
 */
export function productListToRoofKitVariants(
	products: Array<{
		productHandle?: string | null;
		sizeLitres: number;
		price: number;
	}>
): Parameters<typeof calculateRoofKitBreakdown>[1] {
	const byHandle: Record<string, Array<{ size: number; price: number }>> = {
		'waterproof-sealant': [],
		'protective-top-coat': [],
		sealer: [],
		'geo-textile': [],
		'rapid-cure-spray': [],
		'brush-roller': []
	};
	for (const p of products) {
		const handle = (p.productHandle?.trim() || 'waterproof-sealant') as keyof typeof byHandle;
		if (!byHandle[handle]) byHandle[handle] = [];
		byHandle[handle].push({ size: p.sizeLitres, price: p.price });
	}
	// Dedupe by size (keep cheapest per size)
	const dedupe = (arr: Array<{ size: number; price: number }>) => {
		const bySize = new Map<number, number>();
		arr.forEach(({ size, price }) => {
			if (!bySize.has(size) || price < bySize.get(size)!) bySize.set(size, price);
		});
		return Array.from(bySize.entries()).map(([size, price]) => ({ size, price }));
	};
	return {
		'waterproof-sealant': dedupe(byHandle['waterproof-sealant'] || []),
		'protective-top-coat': dedupe(byHandle['protective-top-coat'] || []),
		sealer: dedupe(byHandle['sealer'] || []),
		'geo-textile': dedupe(byHandle['geo-textile'] || []),
		'rapid-cure-spray': dedupe(byHandle['rapid-cure-spray'] || []),
		'brush-roller': dedupe(byHandle['brush-roller'] || [])
	};
}
