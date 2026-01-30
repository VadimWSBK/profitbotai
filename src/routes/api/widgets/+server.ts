import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/supabase.server';

type WidgetListItem = { id: string; name: string; tags: string[]; createdAt: string };

function formatDate(iso: string): string {
	const d = new Date(iso);
	const day = d.getDate();
	const suffix = day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th';
	return `${day}${suffix} ${d.toLocaleString('en-GB', { month: 'short', year: 'numeric' })}`;
}

function rowToListItem(row: { id: string; name: string; display_mode: string; created_at: string }): WidgetListItem {
	return {
		id: row.id,
		name: row.name,
		tags: [row.display_mode.charAt(0).toUpperCase() + row.display_mode.slice(1)],
		createdAt: formatDate(row.created_at)
	};
}

/**
 * GET /api/widgets – list widgets from Supabase.
 */
export const GET: RequestHandler = async () => {
	try {
		const supabase = getSupabase();
		const { data, error } = await supabase
			.from('widgets')
			.select('id, name, display_mode, created_at')
			.order('updated_at', { ascending: false });

		if (error) {
			console.error('Supabase widgets list error:', error);
			return json({ widgets: [], error: error.message }, { status: 500 });
		}

		const widgets: WidgetListItem[] = (data ?? []).map(rowToListItem);
		return json({ widgets });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to list widgets';
		console.error('GET /api/widgets:', e);
		return json({ widgets: [], error: msg }, { status: 500 });
	}
};

/**
 * POST /api/widgets – create a widget.
 * Body: { name?, display_mode?, config?, n8n_webhook_url? }
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const supabase = getSupabase();
		const body = await request.json().catch(() => ({}));
		const name = typeof body.name === 'string' ? body.name : 'My Chat Widget';
		const display_mode = ['popup', 'standalone', 'embedded'].includes(body.display_mode)
			? body.display_mode
			: 'popup';
		const config = body.config && typeof body.config === 'object' ? body.config : {};
		const n8n_webhook_url = typeof body.n8n_webhook_url === 'string' ? body.n8n_webhook_url : '';

		const { data, error } = await supabase
			.from('widgets')
			.insert({ name, display_mode, config, n8n_webhook_url })
			.select('id, name, display_mode, created_at')
			.single();

		if (error) {
			console.error('Supabase widget create error:', error);
			return json({ error: error.message }, { status: 500 });
		}

		return json({ widget: rowToListItem(data) }, { status: 201 });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to create widget';
		console.error('POST /api/widgets:', e);
		return json({ error: msg }, { status: 500 });
	}
};
