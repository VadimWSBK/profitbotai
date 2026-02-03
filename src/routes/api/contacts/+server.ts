import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { resolvePdfQuotesToSignedUrls } from '$lib/quote-pdf-urls.server';

/**
 * GET /api/contacts?widget_id=&q=
 * List contacts for widgets the user owns. Optional widget_id filter and q (search name/email).
 * pdf_quotes paths are resolved to signed URLs (roof_quotes bucket is private).
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
			roof_size_sqm,
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

	const rawRows = rows ?? [];
	const contactIds = rawRows.map((r: { id: string }) => r.id);
	let lastByContact: Record<string, string> = {};
	if (contactIds.length > 0) {
		const { data: lastContactRows } = await supabase.rpc('get_contact_last_contact_at', {
			p_contact_ids: contactIds
		});
		for (const row of lastContactRows ?? []) {
			const r = row as { contact_id: string; last_contact_at: string };
			if (r.last_contact_at) lastByContact[r.contact_id] = r.last_contact_at;
		}
	}

	const contacts = await Promise.all(
		rawRows.map(
			async (r: {
				id: string;
				conversation_id: string | null;
				widget_id: string | null;
				name: string | null;
				email: string | null;
				phone: string | null;
				address: string | null;
				roof_size_sqm: number | null;
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
				roofSizeSqm: r.roof_size_sqm != null ? Number(r.roof_size_sqm) : null,
				pdfQuotes: await resolvePdfQuotesToSignedUrls(r.pdf_quotes),
				createdAt: r.created_at,
				updatedAt: r.updated_at,
				lastConversationAt: lastByContact[r.id] ?? null
			})
		)
	);

	return json({ contacts });
};
