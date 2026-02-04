import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getSupabase, getSupabaseClient, getSupabaseAdmin } from '$lib/supabase.server';

/**
 * GET /api/widgets/[id] – fetch one widget (full config for editor).
 * Anonymous GET allowed for embed (Shopify, etc.); uses anon client + RLS policy.
 */
export const GET: RequestHandler = async (event) => {
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	// Allow anonymous GET for embed (visitors on Shopify etc. fetch widget config)
	const isAnonymousGet = !event.locals.user && event.request.method === 'GET';

	try {
		// Anonymous: anon client (RLS "Public can read widgets" allows it)
		const supabase = isAnonymousGet ? getSupabase() : getSupabaseClient(event);
		const { data, error } = await supabase
			.from('widgets')
			.select('*')
			.eq('id', id)
			.single();

		if (error) {
			if (error.code === 'PGRST116') return json({ error: 'Not found' }, { status: 404 });
			console.error('Supabase widget get error:', error);
			return json({ error: error.message }, { status: 500 });
		}

		// Map DB row to app WidgetConfig shape
		const config = (data.config as Record<string, unknown>) ?? {};
		let chatBackend = (config.chatBackend as string) ?? 'n8n';
		let n8nUrl =
			(data.n8n_webhook_url as string)?.trim() ||
			(chatBackend === 'n8n' ? (env.N8N_CHAT_WEBHOOK_URL ?? '').trim() : '') ||
			'';

		// When widget has an agent, use agent's chat backend so embed doesn't poll our API when agent is n8n.
		// Use admin client so anonymous embed load can read agent (RLS may block anon on agents).
		const agentId = (config.agentId as string)?.trim();
		if (agentId) {
			const admin = getSupabaseAdmin();
			const { data: agentRow } = await admin
				.from('agents')
				.select('chat_backend, n8n_webhook_url')
				.eq('id', agentId)
				.single();
			if (agentRow) {
				chatBackend = (agentRow.chat_backend as string) ?? chatBackend;
				const agentN8n = (agentRow.n8n_webhook_url as string)?.trim();
				n8nUrl =
					agentN8n ||
					(chatBackend === 'n8n' ? (env.N8N_CHAT_WEBHOOK_URL ?? '').trim() : '') ||
					n8nUrl;
			}
		}

		const widget = {
			id: data.id,
			name: data.name,
			displayMode: data.display_mode,
			config: {
				name: data.name,
				displayMode: data.display_mode,
				bubble: config.bubble ?? {},
				tooltip: config.tooltip ?? {},
				window: config.window ?? {},
				bot: config.bot ?? {},
				chatBackend,
				llmProvider: config.llmProvider ?? '',
				llmModel: config.llmModel ?? '',
				llmFallbackProvider: config.llmFallbackProvider ?? '',
				llmFallbackModel: config.llmFallbackModel ?? '',
				agentTakeoverTimeoutMinutes: (config.agentTakeoverTimeoutMinutes as number) ?? 5,
				n8nWebhookUrl: n8nUrl,
				webhookTriggers: (config.webhookTriggers as unknown[]) ?? [],
				agentId: (config.agentId as string) ?? '',
				agentAutonomy: Boolean(config.agentAutonomy)
			},
			n8nWebhookUrl: n8nUrl,
			createdAt: data.created_at,
			updatedAt: data.updated_at
		};
		return json(widget);
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to get widget';
		console.error('GET /api/widgets/[id]:', e);
		return json({ error: msg }, { status: 500 });
	}
};

/**
 * PATCH /api/widgets/[id] – update widget.
 * Body: { name?, display_mode?, config?, n8n_webhook_url? }
 */
export const PATCH: RequestHandler = async (event) => {
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const supabase = getSupabaseClient(event);
		const body = await event.request.json().catch(() => ({}));
		const updates: Record<string, unknown> = {};

		if (typeof body.name === 'string') updates.name = body.name;
		if (['popup', 'standalone', 'embedded'].includes(body.display_mode)) updates.display_mode = body.display_mode;
		if (body.config && typeof body.config === 'object') updates.config = body.config;
		if (typeof body.n8n_webhook_url === 'string') updates.n8n_webhook_url = body.n8n_webhook_url;

		if (Object.keys(updates).length === 0) {
			return json({ error: 'No fields to update' }, { status: 400 });
		}

		const { data, error } = await supabase
			.from('widgets')
			.update(updates)
			.eq('id', id)
			.select()
			.single();

		if (error) {
			if (error.code === 'PGRST116') return json({ error: 'Not found' }, { status: 404 });
			console.error('Supabase widget update error:', error);
			return json({ error: error.message }, { status: 500 });
		}

		return json({ widget: data });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to update widget';
		console.error('PATCH /api/widgets/[id]:', e);
		return json({ error: msg }, { status: 500 });
	}
};

/**
 * DELETE /api/widgets/[id] – delete widget (and its events via FK cascade).
 */
export const DELETE: RequestHandler = async (event) => {
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const supabase = getSupabaseClient(event);
		const { error } = await supabase.from('widgets').delete().eq('id', id);

		if (error) {
			if (error.code === 'PGRST116') return json({ error: 'Not found' }, { status: 404 });
			console.error('Supabase widget delete error:', error);
			return json({ error: error.message }, { status: 500 });
		}

		return new Response(null, { status: 204 });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to delete widget';
		console.error('DELETE /api/widgets/[id]:', e);
		return json({ error: msg }, { status: 500 });
	}
};
