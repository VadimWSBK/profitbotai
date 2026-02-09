/**
 * Calculator config: backward-compatible wrapper for DIY Kit Builder.
 * @deprecated Prefer getDiyKitBuilderConfig / getDefaultKitBuilderConfig from $lib/diy-kit-builder.server
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RoofKitRoleHandles } from '$lib/roof-kit-calculator.server';
import { getDiyKitBuilderConfig } from '$lib/diy-kit-builder.server';

const ROOF_KIT_KEY = 'roof-kit';

/**
 * Get roof-kit config for a user. Returns role_handles (and coverage is in full config).
 * Used by DIY checkout when only role_handles are needed; for coverage use getDiyKitBuilderConfig.
 */
export async function getRoofKitCalculatorConfig(
	admin: SupabaseClient,
	ownerId: string
): Promise<RoofKitRoleHandles | null> {
	const cfg = await getDiyKitBuilderConfig(admin, ownerId, ROOF_KIT_KEY);
	return cfg ? cfg.role_handles : null;
}

export type { RoofKitRoleHandles } from '$lib/roof-kit-calculator.server';
