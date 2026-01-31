import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/contacts?widget_id=&q=
 * List contacts for widgets the user owns. Optional widget_id filter and q (search name/email).
 */
export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const widgetId = event.url.searchParams.get('widget_id') ?? undefined;
	const q = (event.url.searchParams.get('q') ?? '').trim().toLowerCase();

	const supabase = getSupabaseClient(event);
	let query = supabase
		.from('contacts')
		.select(
			`
			id,
			conversation_id,
			widget_id,
			name,
			email,
			phone,
			address,
			pdf_quotes,
			created_at,
			updated_at,
			widgets(name)
		`
		)
		.order('updated_at', { ascending: false });

	if (widgetId) query = query.eq('widget_id', widgetId);
	if (q) {
		query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%`);
	}

	const { data: rows, error } = await query;
	if (error) {
		console.error('GET /api/contacts:', error);
		return json({ error: error.message, contacts: [] }, { status: 500 });
	}

	const contacts = (rows ?? []).map(
		(r: {
			id: string;
			conversation_id: string | null;
			widget_id: string | null;
			name: string | null;
			email: string | null;
			phone: string | null;
			address: string | null;
			pdf_quotes: unknown;
			created_at: string;
			updated_at: string;
			widgets: { name: string } | { name: string }[] | null;
		}) => ({
			id: r.id,
			conversationId: r.conversation_id,
			widgetId: r.widget_id,
			widgetName: (() => {
				if (!r.widgets) return null;
				const w = r.widgets;
				return Array.isArray(w) ? w[0]?.name ?? null : (w as { name: string }).name ?? null;
			})(),
			name: r.name ?? null,
			email: r.email ?? null,
			phone: r.phone ?? null,
			address: r.address ?? null,
			pdfQuotes: Array.isArray(r.pdf_quotes) ? r.pdf_quotes : [],
			createdAt: r.created_at,
			updatedAt: r.updated_at
		})
	);

	return json({ contacts });
};
