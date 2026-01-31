import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { INTEGRATIONS } from '$lib/integrations';

const INTEGRATION_IDS = INTEGRATIONS.map((i) => i.id);

/**
 * GET /api/settings/integrations – list connected integrations (no secrets).
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		const supabase = getSupabaseClient(event);
		const { data, error } = await supabase
			.from('user_integrations')
			.select('integration_type')
			.eq('user_id', event.locals.user.id);
		if (error) return json({ connected: [] });
		const connected = (data ?? [])
			.map((r) => r.integration_type)
			.filter((t) => INTEGRATION_IDS.includes(t as (typeof INTEGRATION_IDS)[number]));
		return json({ connected });
	} catch {
		return json({ connected: [] });
	}
};

/**
 * PUT /api/settings/integrations – save or update integration config.
 * Body: { type: 'resend', config: { apiKey: string } }
 */
export const PUT: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		const body = (await event.request.json().catch(() => ({}))) as {
			type?: string;
			config?: Record<string, unknown>;
		};
		const type = body.type?.trim();
		const config = body.config ?? {};
		if (!type || !INTEGRATION_IDS.includes(type as (typeof INTEGRATION_IDS)[number])) {
			return json({ error: 'Invalid integration type' }, { status: 400 });
		}
		// For resend: require apiKey
		if (type === 'resend') {
			const apiKey = (config.apiKey as string)?.trim?.();
			if (!apiKey) return json({ error: 'API key is required' }, { status: 400 });
			if (!apiKey.startsWith('re_')) return json({ error: 'Invalid Resend API key format (should start with re_)' }, { status: 400 });
		}
		const supabase = getSupabaseClient(event);
		const { error } = await supabase.from('user_integrations').upsert(
			{
				user_id: event.locals.user.id,
				integration_type: type,
				config,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'user_id,integration_type' }
		);
		if (error) {
			console.error('user_integrations upsert error:', error);
			return json({ error: error.message }, { status: 500 });
		}
		return json({ ok: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to save';
		console.error('PUT /api/settings/integrations:', e);
		return json({ error: msg }, { status: 500 });
	}
};
