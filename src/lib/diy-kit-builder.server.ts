/**
 * DIY Kit Builder: configurable kit builders with products and coverage per product.
 * Each kit builder has a key (e.g. roof-kit, caravan-kit), name, and product_entries.
 * product_entries: [{ product_handle, role, coverage_per_sqm? }] — coverage overrides default for that role.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
	RoofKitRole,
	RoofKitRoleHandles,
	RoofKitCoverageOverrides
} from '$lib/roof-kit-calculator.server';
import { ROOF_KIT_ROLES } from '$lib/roof-kit-calculator.server';

export type DiyKitBuilderProductEntry = {
	product_handle: string;
	role: RoofKitRole;
	/** Optional L/m² (or m/m² for geo). Overrides default for this role. */
	coverage_per_sqm?: number | null;
};

export type DiyKitBuilderConfig = {
	id: string;
	calculator_key: string;
	name: string;
	product_entries: DiyKitBuilderProductEntry[];
	/** Derived: role → handles (for calculator). Built from product_entries. */
	role_handles: RoofKitRoleHandles;
	/** Derived: role → coverage override. First product in role with coverage_per_sqm set. */
	coverage_overrides: RoofKitCoverageOverrides;
	/** Checkout button background color (e.g. #C8892D). */
	checkout_button_color?: string | null;
	/** Qty badge background color (e.g. #195A2A). */
	qty_badge_background_color?: string | null;
};

const DEFAULT_KIT_KEY = 'roof-kit';

function normHandle(h: string) {
	return h?.trim().toLowerCase() ?? '';
}

/**
 * Build role_handles and coverage_overrides from product_entries.
 */
function fromProductEntries(
	entries: DiyKitBuilderProductEntry[]
): { role_handles: RoofKitRoleHandles; coverage_overrides: RoofKitCoverageOverrides } {
	const role_handles: RoofKitRoleHandles = {};
	const coverage_overrides: RoofKitCoverageOverrides = {};
	for (const role of ROOF_KIT_ROLES) {
		role_handles[role] = [];
	}
	for (const e of entries) {
		const handle = e.product_handle?.trim();
		const role = e.role;
		if (!handle || !ROOF_KIT_ROLES.includes(role)) continue;
		const list = role_handles[role];
		if (Array.isArray(list) && !list.includes(handle)) list.push(handle);
		if (
			e.coverage_per_sqm != null &&
			Number.isFinite(Number(e.coverage_per_sqm)) &&
			!(role in coverage_overrides)
		) {
			coverage_overrides[role] = Number(e.coverage_per_sqm);
		}
	}
	return { role_handles, coverage_overrides };
}

/**
 * List all DIY kit builders for a user.
 */
export async function listDiyKitBuilders(
	admin: SupabaseClient,
	ownerId: string
): Promise<DiyKitBuilderConfig[]> {
	const { data: rows, error } = await admin
		.from('calculator_config')
		.select('id, calculator_key, name, product_entries, role_handles, checkout_button_color, qty_badge_background_color')
		.eq('created_by', ownerId)
		.order('calculator_key', { ascending: true });

	if (error) return [];
	const list = (rows ?? []) as Array<{
		id: string;
		calculator_key: string;
		name: string;
		product_entries: unknown;
		role_handles: unknown;
		checkout_button_color?: string | null;
		qty_badge_background_color?: string | null;
	}>;
	return list.map((r) => {
		const entries = Array.isArray(r.product_entries)
			? (r.product_entries as DiyKitBuilderProductEntry[])
			: [];
		const { role_handles, coverage_overrides } = fromProductEntries(entries);
		const legacy = (r.role_handles as RoofKitRoleHandles) ?? {};
		const mergedHandles: RoofKitRoleHandles = {};
		for (const role of ROOF_KIT_ROLES) {
			mergedHandles[role] = (role_handles[role]?.length ? role_handles[role] : legacy[role]) ?? [];
		}
		return {
			id: r.id,
			calculator_key: r.calculator_key,
			name: r.name || r.calculator_key,
			product_entries: entries,
			role_handles: mergedHandles,
			coverage_overrides,
			checkout_button_color: r.checkout_button_color ?? null,
			qty_badge_background_color: r.qty_badge_background_color ?? null
		};
	});
}

/**
 * Get one DIY kit builder config by key. Used by DIY checkout to run the right kit.
 * Returns role_handles + coverage_overrides for the calculator; product_entries for display/edit.
 */
export async function getDiyKitBuilderConfig(
	admin: SupabaseClient,
	ownerId: string,
	calculatorKey: string
): Promise<DiyKitBuilderConfig | null> {
	const { data, error } = await admin
		.from('calculator_config')
		.select('id, calculator_key, name, product_entries, role_handles, checkout_button_color, qty_badge_background_color')
		.eq('created_by', ownerId)
		.eq('calculator_key', calculatorKey)
		.maybeSingle();

	if (error || !data) return null;
	const r = data as {
		id: string;
		calculator_key: string;
		name: string;
		product_entries: unknown;
		role_handles: unknown;
		checkout_button_color?: string | null;
		qty_badge_background_color?: string | null;
	};
	const entries = Array.isArray(r.product_entries)
		? (r.product_entries as DiyKitBuilderProductEntry[])
		: [];
	const { role_handles, coverage_overrides } = fromProductEntries(entries);
	const legacy = (r.role_handles as RoofKitRoleHandles) ?? {};
	const mergedHandles: RoofKitRoleHandles = {};
	for (const role of ROOF_KIT_ROLES) {
		mergedHandles[role] = (role_handles[role]?.length ? role_handles[role] : legacy[role]) ?? [];
	}
	return {
		id: r.id,
		calculator_key: r.calculator_key,
		name: r.name || r.calculator_key,
		product_entries: entries,
		role_handles: mergedHandles,
		coverage_overrides,
		checkout_button_color: r.checkout_button_color ?? null,
		qty_badge_background_color: r.qty_badge_background_color ?? null
	};
}

/**
 * Get config for the default roof kit (used by chat/checkout when no key specified).
 */
export async function getDefaultKitBuilderConfig(
	admin: SupabaseClient,
	ownerId: string
): Promise<DiyKitBuilderConfig | null> {
	const cfg = await getDiyKitBuilderConfig(admin, ownerId, DEFAULT_KIT_KEY);
	if (cfg) return cfg;
	const list = await listDiyKitBuilders(admin, ownerId);
	return list.length > 0 ? list[0] : null;
}

/**
 * Save a DIY kit builder (create or update by calculator_key).
 */
export async function saveDiyKitBuilderConfig(
	admin: SupabaseClient,
	ownerId: string,
	calculatorKey: string,
	payload: {
		name: string;
		product_entries: DiyKitBuilderProductEntry[];
		checkout_button_color?: string | null;
		qty_badge_background_color?: string | null;
	}
): Promise<{ error?: string }> {
	const { error } = await admin
		.from('calculator_config')
		.upsert(
			{
				created_by: ownerId,
				calculator_key: calculatorKey,
				name: payload.name || calculatorKey,
				product_entries: payload.product_entries ?? [],
				role_handles: {}, // derived from product_entries at read time
				checkout_button_color: payload.checkout_button_color ?? null,
				qty_badge_background_color: payload.qty_badge_background_color ?? null,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'created_by,calculator_key' }
		);

	if (error) return { error: error.message };
	return {};
}

/**
 * Delete a DIY kit builder.
 */
export async function deleteDiyKitBuilderConfig(
	admin: SupabaseClient,
	ownerId: string,
	calculatorKey: string
): Promise<{ error?: string }> {
	const { error } = await admin
		.from('calculator_config')
		.delete()
		.eq('created_by', ownerId)
		.eq('calculator_key', calculatorKey);

	if (error) return { error: error.message };
	return {};
}

export { DEFAULT_KIT_KEY };
