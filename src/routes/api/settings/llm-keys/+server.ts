import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { LLM_PROVIDERS } from '$lib/llm-providers';

const PROVIDER_IDS = LLM_PROVIDERS.map((p) => p.id);

/**
 * GET /api/settings/llm-keys – which providers have API keys set (no key values).
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		const supabase = getSupabaseClient(event);
		const { data, error } = await supabase
			.from('user_llm_keys')
			.select('provider')
			.eq('user_id', event.locals.user.id);
		if (error) {
			// Table might not exist yet
			return json({ providers: [] });
		}
		const providers = (data ?? []).map((r) => r.provider).filter((p) => PROVIDER_IDS.includes(p));
		return json({ providers });
	} catch {
		return json({ providers: [] });
	}
};

/**
 * PUT /api/settings/llm-keys – set or remove API keys.
 * Body: { openai?: string, anthropic?: string, google?: string }
 * Non-empty = set key; empty string or omit = remove key.
 */
export const PUT: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		const body = (await event.request.json().catch(() => ({}))) as Record<string, string | undefined>;
		const supabase = getSupabaseClient(event);
		const userId = event.locals.user.id;

		// Only update providers that appear in the body (so we don't clear other keys)
		for (const providerId of PROVIDER_IDS) {
			if (!(providerId in body)) continue;
			const value = body[providerId];
			const trimmed = typeof value === 'string' ? value.trim() : '';
			if (trimmed) {
				const { error } = await supabase.from('user_llm_keys').upsert(
					{ user_id: userId, provider: providerId, api_key: trimmed, updated_at: new Date().toISOString() },
					{ onConflict: 'user_id,provider' }
				);
				if (error) {
					console.error('user_llm_keys upsert error:', error);
					return json({ error: error.message }, { status: 500 });
				}
			} else {
				await supabase.from('user_llm_keys').delete().eq('user_id', userId).eq('provider', providerId);
			}
		}
		return json({ ok: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to save';
		console.error('PUT /api/settings/llm-keys:', e);
		return json({ error: msg }, { status: 500 });
	}
};
