import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/analytics?widget_id=... – list events for a widget (or all). Admin only (RLS).
 * Optional: from=iso, to=iso for date range.
 */
export const GET: RequestHandler = async (event) => {
	try {
		if (!event.locals.user) return json({ error: 'Unauthorized', events: [] }, { status: 401 });
		const supabase = getSupabaseClient(event);
		const url = event.url;
		const widgetId = url.searchParams.get('widget_id');
		const from = url.searchParams.get('from');
		const to = url.searchParams.get('to');

		let query = supabase
			.from('widget_events')
			.select('id, widget_id, event_type, session_id, metadata, created_at')
			.order('created_at', { ascending: false })
			.limit(500);

		if (widgetId) query = query.eq('widget_id', widgetId);
		if (from) query = query.gte('created_at', from);
		if (to) query = query.lte('created_at', to);

		const { data, error } = await query;

		if (error) {
			console.error('Supabase analytics query error:', error);
			return json({ error: error.message, events: [] }, { status: 500 });
		}

		const events = (data ?? []).map((row) => ({
			id: row.id,
			widgetId: row.widget_id,
			eventType: row.event_type,
			sessionId: row.session_id,
			metadata: row.metadata ?? {},
			createdAt: row.created_at
		}));

		return json({ events });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to fetch analytics';
		console.error('GET /api/analytics:', e);
		return json({ error: msg, events: [] }, { status: 500 });
	}
};
