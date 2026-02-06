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
		const configs: Record<string, { fromEmail?: string; shopDomain?: string; apiVersion?: string; emailFooter?: { logoUrl?: string; websiteUrl?: string; websiteText?: string; phone?: string; email?: string } }> = {};
		for (const r of rows) {
			const config = r.config as { fromEmail?: string; shopDomain?: string; apiVersion?: string; emailFooter?: { logoUrl?: string; websiteUrl?: string; websiteText?: string; phone?: string; email?: string } } | null;
			if (r.integration_type === 'resend' && config) {
				configs.resend = {
					fromEmail: typeof config.fromEmail === 'string' ? config.fromEmail : undefined,
					emailFooter: config.emailFooter && typeof config.emailFooter === 'object' ? config.emailFooter : undefined
				};
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
			const emailFooter = config.emailFooter as { logoUrl?: string; websiteUrl?: string; websiteText?: string; phone?: string; email?: string } | undefined;
			// If apiKey provided, full config (connect or reconnect); otherwise merge into existing (update flow)
			if (apiKey) {
				if (!apiKey.startsWith('re_')) {
					return json({ error: 'Invalid Resend API key format (should start with re_)' }, { status: 400 });
				}
				config = { apiKey, fromEmail, ...(emailFooter ? { emailFooter } : {}) };
			} else {
				// Fetch existing config - if not found, return error (can't update non-existent integration)
				const { data: existing, error: fetchError } = await supabase
					.from('user_integrations')
					.select('config')
					.eq('user_id', event.locals.user.id)
					.eq('integration_type', 'resend')
					.maybeSingle();
				
				if (fetchError) {
					console.error('Error fetching existing resend config:', fetchError);
					return json({ error: 'Failed to load existing integration config' }, { status: 500 });
				}
				
				if (!existing) {
					return json({ error: 'Resend integration not found. Please connect Resend first.' }, { status: 400 });
				}
				
				const existingConfig = (existing.config as { apiKey?: string; fromEmail?: string; emailFooter?: { logoUrl?: string; websiteUrl?: string; websiteText?: string; phone?: string; email?: string } }) ?? {};
				if (!existingConfig.apiKey) {
					return json({ error: 'Resend integration is missing API key. Please reconnect.' }, { status: 400 });
				}
				
				config = {
					apiKey: existingConfig.apiKey, // Always preserve apiKey
					...(existingConfig.fromEmail ? { fromEmail: existingConfig.fromEmail } : {}),
					...(fromEmail === undefined ? {} : { fromEmail: fromEmail || undefined }),
					...(emailFooter === undefined ? (existingConfig.emailFooter ? { emailFooter: existingConfig.emailFooter } : {}) : { emailFooter })
				};
			}
		}

		if (type === 'shopify') {
			// Shopify uses OAuth; config is set via /api/settings/integrations/shopify/callback
			return json({ error: 'Use the Connect with Shopify button to connect your store via OAuth.' }, { status: 400 });
		}

		// Ensure user_id matches the authenticated user
		const userId = event.locals.user.id;
		if (!userId) {
			return json({ error: 'User not authenticated' }, { status: 401 });
		}
		
		const { error } = await supabase.from('user_integrations').upsert(
			{
				user_id: userId,
				integration_type: type,
				config,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'user_id,integration_type' }
		);
		if (error) {
			console.error('user_integrations upsert error:', error);
			// Provide more helpful error message for RLS violations
			if (error.code === '42501') {
				return json({ error: 'Permission denied. Please ensure you are logged in and have permission to manage integrations.' }, { status: 403 });
			}
			return json({ error: error.message }, { status: 500 });
		}
		return json({ ok: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to save';
		console.error('PUT /api/settings/integrations:', e);
		return json({ error: msg }, { status: 500 });
	}
};
