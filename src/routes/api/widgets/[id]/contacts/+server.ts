import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient, getSupabaseAdmin } from '$lib/supabase.server';
import { getPrimaryEmail, parseEmailsFromDb, emailsToJsonb } from '$lib/contact-email-jsonb';

/**
 * GET /api/widgets/[id]/contacts?conversationId=...
 * Returns the current contact for this widget + conversation. For n8n "Get current contact" tool.
 * Auth: session or X-API-Key.
 */
export const GET: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	if (!widgetId) return json({ error: 'Missing widget id' }, { status: 400 });
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const conversationId = event.url.searchParams.get('conversationId')?.trim();
	if (!conversationId) return json({ error: 'Missing query parameter conversationId' }, { status: 400 });

	try {
		const supabase = user.id === 'api-key' ? getSupabaseAdmin() : getSupabaseClient(event);
		const { data, error } = await supabase
			.from('contacts')
			.select('id, name, email, phone, address, street_address, city, state, postcode, country, roof_size_sqm, conversation_id, widget_id, created_at')
			.eq('conversation_id', conversationId)
			.eq('widget_id', widgetId)
			.maybeSingle();
		if (error) {
			console.error('contacts get:', error);
			return json({ error: error.message }, { status: 500 });
		}
		if (!data) return json({ contact: null });
		const emails = parseEmailsFromDb(data.email);
		return json({
			contact: {
				id: data.id,
				name: data.name ?? null,
				email: getPrimaryEmail(data.email) ?? null,
				emails: emails.length > 0 ? emails : null,
				phone: data.phone ?? null,
				address: data.address ?? null,
				streetAddress: data.street_address ?? null,
				city: data.city ?? null,
				state: data.state ?? null,
				postcode: data.postcode ?? null,
				country: data.country ?? null,
				roofSizeSqm: data.roof_size_sqm != null ? Number(data.roof_size_sqm) : null,
				conversationId: data.conversation_id,
				widgetId: data.widget_id,
				createdAt: data.created_at
			}
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to get contact';
		console.error('GET /api/widgets/[id]/contacts:', e);
		return json({ error: msg }, { status: 500 });
	}
};

/**
 * PATCH /api/widgets/[id]/contacts
 * Body: { conversationId, name?, email?, phone?, address?, street_address?, city?, state?, postcode?, country?, roof_size_sqm? }
 * Updates contact fields. Address can be one field (address) or split: street_address, city, state, postcode, country.
 */
export const PATCH: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	if (!widgetId) return json({ error: 'Missing widget id' }, { status: 400 });
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: {
		conversationId?: string;
		name?: string;
		email?: string;
		emails?: string[];
		phone?: string;
		address?: string;
		street_address?: string;
		city?: string;
		state?: string;
		postcode?: string;
		country?: string;
		roof_size_sqm?: number;
	};
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() : '';
	if (!conversationId) return json({ error: 'Missing conversationId' }, { status: 400 });

	const updates: Record<string, string | number | string[]> = {};
	// Only update string fields when a non-empty value is sent (so n8n can send all params and empty = leave existing)
	if (typeof body?.name === 'string') { const v = body.name.trim(); if (v) updates.name = v; }
	if (Array.isArray(body?.emails)) {
		const arr = emailsToJsonb(body.emails);
		if (arr.length > 0) updates.email = arr;
	} else if (typeof body?.email === 'string') {
		const v = body.email.trim();
		if (v) updates.email = emailsToJsonb(v);
	}
	if (typeof body?.phone === 'string') { const v = body.phone.trim(); if (v) updates.phone = v; }
	if (typeof body?.address === 'string') { const v = body.address.trim(); if (v) updates.address = v; }
	if (typeof body?.street_address === 'string') { const v = body.street_address.trim(); if (v) updates.street_address = v; }
	if (typeof body?.city === 'string') { const v = body.city.trim(); if (v) updates.city = v; }
	if (typeof body?.state === 'string') { const v = body.state.trim(); if (v) updates.state = v; }
	if (typeof body?.postcode === 'string') { const v = body.postcode.trim(); if (v) updates.postcode = v; }
	if (typeof body?.country === 'string') { const v = body.country.trim(); if (v) updates.country = v; }
	if (typeof body?.roof_size_sqm === 'number' && body.roof_size_sqm >= 0) updates.roof_size_sqm = body.roof_size_sqm;
	if (Object.keys(updates).length === 0) {
		return json({ error: 'No fields to update (name, email, phone, address, street_address, city, state, postcode, country, roof_size_sqm)' }, { status: 400 });
	}

	try {
		const supabase = user.id === 'api-key' ? getSupabaseAdmin() : getSupabaseClient(event);
		const { error } = await supabase
			.from('contacts')
			.update(updates)
			.eq('conversation_id', conversationId)
			.eq('widget_id', widgetId);
		if (error) {
			console.error('contacts update:', error);
			return json({ error: error.message }, { status: 500 });
		}
		return json({ success: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to update contact';
		console.error('PATCH /api/widgets/[id]/contacts:', e);
		return json({ error: msg }, { status: 500 });
	}
};
