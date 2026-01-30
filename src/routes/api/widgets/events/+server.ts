import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/supabase.server';

/**
 * POST /api/widgets/events – record an analytics event.
 * Body: { widget_id: string, event_type: string, session_id?: string, metadata?: object }
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const supabase = getSupabase();
		const body = await request.json().catch(() => ({}));
		const widget_id = body.widget_id;
		const event_type = body.event_type;

		if (typeof widget_id !== 'string' || !widget_id) {
			return json({ error: 'widget_id is required' }, { status: 400 });
		}
		if (typeof event_type !== 'string' || !event_type) {
			return json({ error: 'event_type is required' }, { status: 400 });
		}

		const session_id = typeof body.session_id === 'string' ? body.session_id : null;
		const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};

		const { error } = await supabase.from('widget_events').insert({
			widget_id,
			event_type,
			session_id,
			metadata
		});

		if (error) {
			console.error('Supabase widget_events insert error:', error);
			return json({ error: error.message }, { status: 500 });
		}

		return json({ ok: true }, { status: 201 });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to record event';
		console.error('POST /api/widgets/events:', e);
		return json({ error: msg }, { status: 500 });
	}
};
