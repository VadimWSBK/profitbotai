import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { INTEGRATIONS } from '$lib/integrations';

const INTEGRATION_IDS = INTEGRATIONS.map((i) => i.id);

/**
 * DELETE /api/settings/integrations/[type] – remove integration.
 */
export const DELETE: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const type = event.params.type?.trim();
	if (!type || !INTEGRATION_IDS.includes(type as (typeof INTEGRATION_IDS)[number])) {
		return json({ error: 'Invalid integration type' }, { status: 400 });
	}
	try {
		const supabase = getSupabaseClient(event);
		await supabase
			.from('user_integrations')
			.delete()
			.eq('user_id', event.locals.user.id)
			.eq('integration_type', type);
		return json({ ok: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to remove';
		console.error('DELETE /api/settings/integrations/[type]:', e);
		return json({ error: msg }, { status: 500 });
	}
};
