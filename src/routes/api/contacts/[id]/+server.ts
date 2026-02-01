import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { resolvePdfQuotesToSignedUrls } from '$lib/quote-pdf-urls.server';

/**
 * GET /api/contacts/[id]
 * Single contact with full details. RLS ensures user can only read contacts for their widgets.
 * pdf_quotes may store paths (roof_quotes bucket is private); resolves to signed URLs for display.
 */
export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = event.params.id;
	if (!id) return json({ error: 'Missing contact id' }, { status: 400 });

	const supabase = getSupabaseClient(event);
	const { data: row, error } = await supabase
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
		.eq('id', id)
		.maybeSingle();

	if (error) {
		console.error('GET /api/contacts/[id]:', error);
		return json({ error: error.message }, { status: 500 });
	}
	if (!row) return json({ error: 'Contact not found' }, { status: 404 });

	const r = row as {
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
	};

	const pdfQuotes = await resolvePdfQuotesToSignedUrls(r.pdf_quotes);

	const contact = {
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
		pdfQuotes,
		createdAt: r.created_at,
		updatedAt: r.updated_at
	};

	return json({ contact });
};
