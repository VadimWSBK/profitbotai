import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { INTEGRATIONS } from '$lib/integrations';

const INTEGRATION_IDS = INTEGRATIONS.map((i) => i.id);

/**
 * GET /api/settings/integrations – list connected integrations and masked config (e.g. Resend fromEmail).
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		const supabase = getSupabaseClient(event);
		const { data, error } = await supabase
			.from('user_integrations')
			.select('integration_type, config')
			.eq('user_id', event.locals.user.id);
		if (error) return json({ connected: [], configs: {} });
		const rows = data ?? [];
		const connected = rows
			.map((r) => r.integration_type)
			.filter((t) => INTEGRATION_IDS.includes(t as (typeof INTEGRATION_IDS)[number]));
		const configs: Record<string, { fromEmail?: string; shopDomain?: string; apiVersion?: string }> = {};
		for (const r of rows) {
			const config = r.config as { fromEmail?: string; shopDomain?: string; apiVersion?: string } | null;
			if (r.integration_type === 'resend' && config) {
				configs.resend = { fromEmail: typeof config.fromEmail === 'string' ? config.fromEmail : undefined };
			}
			if (r.integration_type === 'shopify' && config) {
				configs.shopify = {
					shopDomain: typeof config.shopDomain === 'string' ? config.shopDomain : undefined,
					apiVersion: typeof config.apiVersion === 'string' ? config.apiVersion : undefined
				};
			}
		}
		return json({ connected, configs });
	} catch {
		return json({ connected: [], configs: {} });
	}
};

/**
 * PUT /api/settings/integrations – save or update integration config.
 * Body: { type: 'resend', config: { apiKey?: string, fromEmail?: string } }
 * For Resend: apiKey required on first connect; fromEmail optional (use address on verified domain for sending to customers).
 * When updating Resend and only fromEmail is sent, existing apiKey is preserved.
 */
export const PUT: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		const body = (await event.request.json().catch(() => ({}))) as {
			type?: string;
			config?: Record<string, unknown>;
		};
		const type = body.type?.trim();
		let config = body.config ?? {};
		if (!type || !INTEGRATION_IDS.includes(type as (typeof INTEGRATION_IDS)[number])) {
			return json({ error: 'Invalid integration type' }, { status: 400 });
		}
		const supabase = getSupabaseClient(event);

		if (type === 'resend') {
			const apiKey = (config.apiKey as string)?.trim?.();
			const fromEmail = typeof config.fromEmail === 'string' ? config.fromEmail.trim() : undefined;
			// If apiKey provided, full config (connect or reconnect); otherwise merge fromEmail into existing (update flow)
			if (apiKey) {
				if (!apiKey.startsWith('re_')) {
					return json({ error: 'Invalid Resend API key format (should start with re_)' }, { status: 400 });
				}
				config = { apiKey, fromEmail };
			} else {
				const { data: existing } = await supabase
					.from('user_integrations')
					.select('config')
					.eq('user_id', event.locals.user.id)
					.eq('integration_type', 'resend')
					.single();
				const existingConfig = (existing?.config as { apiKey?: string; fromEmail?: string }) ?? {};
				config = {
					...existingConfig,
					...(fromEmail === undefined ? {} : { fromEmail: fromEmail || undefined })
				};
			}
		}

		if (type === 'shopify') {
			// Shopify uses OAuth; config is set via /api/settings/integrations/shopify/callback
			return json({ error: 'Use the Connect with Shopify button to connect your store via OAuth.' }, { status: 400 });
		}

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
