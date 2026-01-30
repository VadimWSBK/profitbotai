import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/supabase.server';

/**
 * GET /api/widgets/[id] – fetch one widget (full config for editor).
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });

	try {
		const supabase = getSupabase();
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
				n8nWebhookUrl: data.n8n_webhook_url ?? ''
			},
			n8nWebhookUrl: data.n8n_webhook_url ?? '',
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
export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });

	try {
		const supabase = getSupabase();
		const body = await request.json().catch(() => ({}));
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
export const DELETE: RequestHandler = async ({ params }) => {
	const id = params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });

	try {
		const supabase = getSupabase();
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
