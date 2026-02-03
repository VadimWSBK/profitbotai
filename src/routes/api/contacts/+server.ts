import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { resolvePdfQuotesToSignedUrls } from '$lib/quote-pdf-urls.server';

/**
 * GET /api/contacts?widget_id=&q=&limit=&page=&has_shopify_order=&tag=
 * List contacts for widgets the user owns. Pagination: page (1-based), limit (default 10). Latest first.
 * Filters: widget_id, q (search name/email), has_shopify_order (true), tag (e.g. shopify).
 */
export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const widgetId = event.url.searchParams.get('widget_id') ?? undefined;
	const q = (event.url.searchParams.get('q') ?? '').trim().toLowerCase();
	const limitParam = event.url.searchParams.get('limit');
	const limit = Math.min(50, Math.max(1, Number.parseInt(limitParam ?? '10', 10) || 10));
	const pageParam = event.url.searchParams.get('page');
	const page = Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1);
	const hasShopifyOrder = event.url.searchParams.get('has_shopify_order') === 'true';
	const tag = (event.url.searchParams.get('tag') ?? '').trim() || undefined;

	const offset = (page - 1) * limit;
	const supabase = getSupabaseClient(event);

	const selectFields = `
		id,
		conversation_id,
		widget_id,
		name,
		email,
		phone,
		address,
		roof_size_sqm,
		pdf_quotes,
		shopify_orders,
		tags,
		created_at,
		updated_at,
		widgets(name)
	`;

	let query = supabase
		.from('contacts')
		.select(selectFields, { count: 'exact' })
		.order('updated_at', { ascending: false })
		.range(offset, offset + limit - 1);

	if (widgetId) query = query.eq('widget_id', widgetId);
	if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%`);
	if (hasShopifyOrder) query = query.neq('shopify_orders', '[]');
	if (tag) query = query.contains('tags', [tag]);

	const { data: rows, error, count } = await query;
	if (error) {
		console.error('GET /api/contacts:', error);
		return json({ error: error.message, contacts: [], totalCount: 0, page: 1, limit: 10 }, { status: 500 });
	}

	const rawRows = rows ?? [];
	const totalCount = count ?? 0;
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
				shopify_orders: unknown;
				tags: unknown;
				created_at: string;
				updated_at: string;
				widgets: { name: string } | { name: string }[] | null;
			}) => {
				const rawTags = r.tags;
				const tagsList: string[] = Array.isArray(rawTags)
					? (rawTags as unknown[]).filter((t): t is string => typeof t === 'string')
					: [];
				return {
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
					roofSizeSqm: r.roof_size_sqm == null ? null : Number(r.roof_size_sqm),
					pdfQuotes: await resolvePdfQuotesToSignedUrls(r.pdf_quotes),
					hasShopifyOrders: Array.isArray(r.shopify_orders) && r.shopify_orders.length > 0,
					tags: tagsList,
					createdAt: r.created_at,
					updatedAt: r.updated_at,
					lastConversationAt: lastByContact[r.id] ?? null
				};
			}
		)
	);

	return json({ contacts, totalCount, page, limit });
};
