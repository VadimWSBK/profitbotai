/**
 * Roof-kit calculator: area (m²) → product breakdown by role.
 * Uses corrugated/painted defaults only. Includes bonus kit (Brush / Brush + Roller).
 * Product assignment to roles is configurable via calculator_config (role_handles);
 * no hardcoded Shopify handles.
 */

/** Corrugated profile rates (L/m² or m/m²) – configurable per shop later if needed */
const CORRUGATED = {
	sealantPerM2: 1.5,
	thermalPerM2: 0.5,
	geoTextileMetersPerM2: 1,
	sealerPerM2: 1 / 8,
	etchPrimerPerM2: 1 / 6
} as const;

/** Coverage area for sealant/geo: 15% of total roof area (seams/cracks) */
const COVERAGE_FRACTION = 0.15;

/** Rapid-cure: 0.02 L per 1 L of waterproof sealant sold */
const RAPID_CURE_PER_SEALANT_LITRE = 0.02;

const ceil2 = (n: number) => Math.ceil(n * 100) / 100;

/** Internal role keys for the roof-kit calculator. Mapping to product handles is in calculator_config. */
export type RoofKitRole =
	| 'sealant'
	| 'thermal'
	| 'sealer'
	| 'geo'
	| 'rapidCure'
	| 'brushRoller';

export const ROOF_KIT_ROLES: readonly RoofKitRole[] = [
	'sealant',
	'thermal',
	'sealer',
	'geo',
	'rapidCure',
	'brushRoller'
] as const;

/** Config shape: each role maps to an array of product handles (from Shopify). */
export type RoofKitRoleHandles = Partial<Record<RoofKitRole, string[]>>;

/** Optional coverage overrides per role (L/m² or m/m² for geo; rapidCure = L per L sealant). Null = use default. */
export type RoofKitCoverageOverrides = Partial<Record<RoofKitRole, number>>;

export type RoofKitLineItem = {
	/** Role in the calculator; resolve to product via role_handles config */
	role: RoofKitRole;
	/** Size in litres for buckets, or 0 for kits/rolls */
	sizeLitres: number;
	/** Label for display e.g. "15L", "Brush + Roller Kit" */
	label: string;
	quantity: number;
};

export type RoofKitBreakdown = {
	lineItems: RoofKitLineItem[];
	sealantLitres: number;
	totalItems: number;
};

/** Variants per role (size + price). Built from products + role_handles. */
export type RoofKitVariantsByRole = Record<RoofKitRole, Array<{ size: number; price: number }>>;

/** Cost-optimized bucket selection (DP). Same logic as LRIDY caravan-calculator findOptimalCombo. */
export function findOptimalBuckets(
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
	const dp: (Entry | null)[] = new Array(cap + 1).fill(null);
	dp[0] = { cost: 0, counts: new Array(sorted.length).fill(0) };

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
		if (entry && (!best || entry.cost < best.entry.cost)) best = { vol, entry };
	}
	if (!best) return [];

	return sorted
		.map((v, i) => ({ size: v.size, quantity: best!.entry.counts[i] }))
		.filter((x) => x.quantity > 0);
}

/**
 * Compute roof-kit breakdown from area (m²).
 * productVariants: size+price variants per role.
 * coverageOverrides: optional L/m² (or m/m² for geo) per role; rapidCure = L per L sealant.
 */
export function calculateRoofKitBreakdown(
	areaM2: number,
	productVariants: RoofKitVariantsByRole,
	coverageOverrides?: RoofKitCoverageOverrides
): RoofKitBreakdown {
	const lineItems: RoofKitLineItem[] = [];
	const coverageArea = ceil2(areaM2 * COVERAGE_FRACTION);
	const cov = coverageOverrides ?? {};

	const sealantRate = cov.sealant ?? CORRUGATED.sealantPerM2;
	const sealantLitres = ceil2(coverageArea * sealantRate);
	const sealantBuckets = findOptimalBuckets(sealantLitres, productVariants.sealant);
	sealantBuckets.forEach((b) => {
		lineItems.push({ role: 'sealant', sizeLitres: b.size, label: `${b.size}L`, quantity: b.quantity });
	});

	const thermalRate = cov.thermal ?? CORRUGATED.thermalPerM2;
	const thermalLitres = ceil2(areaM2 * thermalRate);
	const thermalBuckets = findOptimalBuckets(thermalLitres, productVariants.thermal);
	thermalBuckets.forEach((b) => {
		lineItems.push({ role: 'thermal', sizeLitres: b.size, label: `${b.size}L`, quantity: b.quantity });
	});

	const sealerRate = cov.sealer ?? CORRUGATED.sealerPerM2;
	const sealerLitres = ceil2(coverageArea * sealerRate);
	const sealerBuckets = findOptimalBuckets(sealerLitres, productVariants.sealer);
	sealerBuckets.forEach((b) => {
		lineItems.push({ role: 'sealer', sizeLitres: b.size, label: `${b.size}L`, quantity: b.quantity });
	});

	const geoRate = cov.geo ?? CORRUGATED.geoTextileMetersPerM2;
	const geoMetres = Math.ceil(coverageArea * geoRate);
	const geoRolls = findOptimalBuckets(geoMetres, productVariants.geo);
	geoRolls.forEach((b) => {
		lineItems.push({ role: 'geo', sizeLitres: b.size, label: `${b.size}m Roll`, quantity: b.quantity });
	});

	const rapidRate = cov.rapidCure ?? RAPID_CURE_PER_SEALANT_LITRE;
	const rapidLitres = ceil2(sealantLitres * rapidRate);
	if (rapidLitres > 0 && productVariants.rapidCure.length) {
		const sprayBuckets = findOptimalBuckets(rapidLitres, productVariants.rapidCure);
		sprayBuckets.forEach((b) => {
			lineItems.push({ role: 'rapidCure', sizeLitres: b.size, label: `${b.size}L Bottle`, quantity: b.quantity });
		});
	}

	const brushVariants = productVariants.brushRoller;
	if (brushVariants.length) {
		const useBrushOnly = areaM2 < 5;
		const v =
			brushVariants.length >= 2
				? brushVariants[useBrushOnly ? 0 : 1]
				: brushVariants[0];
		lineItems.push({
			role: 'brushRoller',
			sizeLitres: v.size ?? 0,
			label: useBrushOnly ? 'Brush Kit' : 'Brush + Roller Kit',
			quantity: 1
		});
	}

	const totalItems = lineItems.reduce((s, li) => s + li.quantity, 0);
	return { lineItems, sealantLitres, totalItems };
}

const emptyRoleVariants = (): RoofKitVariantsByRole => ({
	sealant: [],
	thermal: [],
	sealer: [],
	geo: [],
	rapidCure: [],
	brushRoller: []
});

/**
 * Build role → variants from products and role_handles config.
 * Normalizes handles to lowercase for matching.
 */
export function productListToRoofKitVariants(
	products: Array<{ productHandle?: string | null; sizeLitres: number; price: number }>,
	roleHandles: RoofKitRoleHandles
): RoofKitVariantsByRole {
	const out = emptyRoleVariants();
	const norm = (h: string) => h.trim().toLowerCase();
	const byRole = new Map<RoofKitRole, Set<string>>();
	for (const role of ROOF_KIT_ROLES) {
		const handles = roleHandles[role];
		const set = new Set<string>();
		if (Array.isArray(handles)) {
			for (const h of handles) if (h?.trim()) set.add(norm(h));
		}
		byRole.set(role, set);
	}

	for (const p of products) {
		const handle = p.productHandle?.trim();
		if (!handle) continue;
		const key = norm(handle);
		for (const role of ROOF_KIT_ROLES) {
			if (byRole.get(role)!.has(key)) {
				out[role].push({ size: p.sizeLitres, price: p.price });
				break;
			}
		}
	}

	const dedupe = (arr: Array<{ size: number; price: number }>) => {
		const bySize = new Map<number, number>();
		arr.forEach(({ size, price }) => {
			if (!bySize.has(size) || price < bySize.get(size)!) bySize.set(size, price);
		});
		return Array.from(bySize.entries()).map(([size, price]) => ({ size, price }));
	};

	return {
		sealant: dedupe(out.sealant),
		thermal: dedupe(out.thermal),
		sealer: dedupe(out.sealer),
		geo: dedupe(out.geo),
		rapidCure: dedupe(out.rapidCure),
		brushRoller: dedupe(out.brushRoller)
	};
}
