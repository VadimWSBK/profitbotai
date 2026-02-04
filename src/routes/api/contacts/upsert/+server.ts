import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/supabase.server';
import { emailsToJsonb, mergeEmailIntoList } from '$lib/contact-email-jsonb';

/**
 * POST /api/contacts/upsert
 * Body: { customer?: { name?, email?, phone? }, widgetId? } (email can be string or string[]).
 * Upserts a contact by email: updates if exists (adds email to list if new), creates if not.
 * Use from n8n webhook - single call, no conditional logic needed.
 */
export const POST: RequestHandler = async (event) => {
	let body: { customer?: { name?: string; email?: string | string[]; phone?: string }; widgetId?: string };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const customer = body?.customer ?? (body as unknown as { name?: string; email?: string | string[]; phone?: string });
	const emails = emailsToJsonb(customer?.email);
	if (emails.length === 0) return json({ error: 'Missing customer.email' }, { status: 400 });
	const primaryEmail = emails[0];

	const name = typeof customer?.name === 'string' ? customer.name.trim() : undefined;
	const phone = typeof customer?.phone === 'string' ? customer.phone.trim() : undefined;

	try {
		const supabase = getSupabase();
		const { data: existing } = await supabase
			.from('contacts')
			.select('id, email')
			.contains('email', [primaryEmail])
			.maybeSingle();

		if (existing) {
			const mergedEmails = emails.reduce(
				(acc, e) => mergeEmailIntoList(acc, e),
				mergeEmailIntoList(existing.email, null)
			);
			const updatePayload: Record<string, unknown> = { email: mergedEmails };
			if (name !== undefined) updatePayload.name = name;
			if (phone !== undefined) updatePayload.phone = phone;
			const { error } = await supabase.from('contacts').update(updatePayload).eq('id', existing.id);
			if (error) {
				console.error('contacts update:', error);
				return json({ error: error.message }, { status: 500 });
			}
			return json({ success: true, action: 'updated', id: existing.id });
		}

		if (!body.widgetId) return json({ error: 'Missing widgetId (required when creating a new contact)' }, { status: 400 });

		const { data: inserted, error } = await supabase
			.from('contacts')
			.insert({ widget_id: body.widgetId, email: emails, name: name ?? null, phone: phone ?? null })
			.select('id')
			.single();
		if (error) {
			console.error('contacts insert:', error);
			return json({ error: error.message }, { status: 500 });
		}
		return json({ success: true, action: 'created', id: inserted.id });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to upsert contact';
		console.error('POST /api/contacts/upsert:', e);
		return json({ error: msg }, { status: 500 });
	}
};
