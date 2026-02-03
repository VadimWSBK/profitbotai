import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { resolvePdfQuotesToSignedUrls } from '$lib/quote-pdf-urls.server';
import { getTagAddedWorkflows, runTagAddedWorkflow } from '$lib/run-workflow.server';

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
			street_address,
			city,
			state,
			postcode,
			country,
			note,
			roof_size_sqm,
			pdf_quotes,
			shopify_orders,
			tags,
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
		street_address: string | null;
		city: string | null;
		state: string | null;
		postcode: string | null;
		country: string | null;
		note: string | null;
		roof_size_sqm: number | null;
		pdf_quotes: unknown;
		shopify_orders: unknown;
		tags: unknown;
		created_at: string;
		updated_at: string;
		widgets: { name: string } | { name: string }[] | null;
	};

	const pdfQuotes = await resolvePdfQuotesToSignedUrls(r.pdf_quotes);
	const shopifyOrders = Array.isArray(r.shopify_orders) ? r.shopify_orders : [];
	const rawTags = r.tags;
	const tags: string[] = Array.isArray(rawTags)
		? (rawTags as unknown[]).filter((t): t is string => typeof t === 'string')
		: [];

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
		streetAddress: r.street_address ?? null,
		city: r.city ?? null,
		state: r.state ?? null,
		postcode: r.postcode ?? null,
		country: r.country ?? null,
		note: r.note ?? null,
		roofSizeSqm: r.roof_size_sqm == null ? null : Number(r.roof_size_sqm),
		pdfQuotes,
		shopifyOrders,
		tags,
		createdAt: r.created_at,
		updatedAt: r.updated_at
	};

	return json({ contact });
};

/** Body: name?, email?, phone?, address?, streetAddress?, city?, state?, postcode?, country?, note?, tags? */
export const PATCH: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = event.params.id;
	if (!id) return json({ error: 'Missing contact id' }, { status: 400 });

	let body: Record<string, unknown>;
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const supabase = getSupabaseClient(event);
	const updates: Record<string, unknown> = {};

	if (typeof body.name === 'string') updates.name = body.name.trim() || null;
	if (typeof body.email === 'string') updates.email = body.email.trim() || null;
	if (typeof body.phone === 'string') updates.phone = body.phone.trim() || null;
	if (typeof body.address === 'string') updates.address = body.address.trim() || null;
	if (typeof body.streetAddress === 'string') updates.street_address = body.streetAddress.trim() || null;
	if (typeof body.city === 'string') updates.city = body.city.trim() || null;
	if (typeof body.state === 'string') updates.state = body.state.trim() || null;
	if (typeof body.postcode === 'string') updates.postcode = body.postcode.trim() || null;
	if (typeof body.country === 'string') updates.country = body.country.trim() || null;
	if (typeof body.note === 'string') updates.note = body.note.trim() || null;
	if (Array.isArray(body.tags)) {
		updates.tags = (body.tags as unknown[]).filter((t): t is string => typeof t === 'string');
	}

	if (Object.keys(updates).length === 0) {
		return json({ error: 'No valid fields to update' }, { status: 400 });
	}

	// Fetch contact before update to detect newly added tags (for "Tag added" workflows)
	let tagsAdded: string[] = [];
	let contactBefore: { widget_id: string | null; conversation_id: string | null; name: string | null; email: string | null; phone: string | null; address: string | null } | null = null;
	if (Array.isArray(updates.tags)) {
		const { data: before } = await supabase
			.from('contacts')
			.select('widget_id, conversation_id, name, email, phone, address, tags')
			.eq('id', id)
			.maybeSingle();
		if (before) {
			contactBefore = before as typeof contactBefore & { tags: unknown };
			const oldTags: string[] = Array.isArray((before as { tags?: unknown }).tags)
				? ((before as { tags: unknown[] }).tags as unknown[]).filter((t): t is string => typeof t === 'string')
				: [];
			const newTags = updates.tags as string[];
			tagsAdded = newTags.filter((t) => !oldTags.includes(t));
		}
	}

	const { data: row, error } = await supabase
		.from('contacts')
		.update(updates)
		.eq('id', id)
		.select('id')
		.maybeSingle();

	if (error) {
		console.error('PATCH /api/contacts/[id]:', error);
		return json({ error: error.message }, { status: 500 });
	}
	if (!row) return json({ error: 'Contact not found' }, { status: 404 });

	// Run "Tag added" workflows for each newly added tag
	if (tagsAdded.length > 0 && contactBefore?.widget_id) {
		const widgetId = contactBefore.widget_id;
		const { data: widgetRow } = await supabase
			.from('widgets')
			.select('created_by')
			.eq('id', widgetId)
			.single();
		const ownerId = (widgetRow as { created_by: string } | null)?.created_by;
		if (ownerId) {
			const contact = {
				name: contactBefore.name ?? null,
				email: contactBefore.email ?? null,
				phone: contactBefore.phone ?? null,
				address: contactBefore.address ?? null
			};
			for (const tag of tagsAdded) {
				const workflows = await getTagAddedWorkflows(supabase, widgetId, tag);
				for (const w of workflows) {
					runTagAddedWorkflow(supabase, w, {
						contactId: id,
						widgetId,
						ownerId,
						contact,
						conversationId: contactBefore.conversation_id ?? null,
						tagAdded: tag
					}).catch((e) => console.error('[PATCH contact] runTagAddedWorkflow:', e));
				}
			}
		}
	}

	return json({ success: true });
};
