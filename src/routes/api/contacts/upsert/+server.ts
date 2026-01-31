import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/supabase.server';

/**
 * POST /api/contacts/upsert
 * Body: { customer?: { name?, email?, phone? }, ... }
 * Upserts a contact by email: updates if exists, creates if not.
 * Use from n8n webhook - single call, no conditional logic needed.
 */
export const POST: RequestHandler = async (event) => {
	let body: { customer?: { name?: string; email?: string; phone?: string } };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const customer = body?.customer ?? (body as unknown as { name?: string; email?: string; phone?: string });
	const email = typeof customer?.email === 'string' ? customer.email.trim().toLowerCase() : '';
	if (!email) return json({ error: 'Missing customer.email' }, { status: 400 });

	const name = typeof customer?.name === 'string' ? customer.name.trim() : undefined;
	const phone = typeof customer?.phone === 'string' ? customer.phone.trim() : undefined;

	try {
		const supabase = getSupabase();
		const { data: existing } = await supabase
			.from('contacts')
			.select('id')
			.eq('email', email)
			.maybeSingle();

		if (existing) {
			const updates: Record<string, string> = {};
			if (name !== undefined) updates.name = name;
			if (phone !== undefined) updates.phone = phone;
			if (Object.keys(updates).length === 0) {
				return json({ success: true, action: 'no_change', id: existing.id });
			}
			const { error } = await supabase.from('contacts').update(updates).eq('id', existing.id);
			if (error) {
				console.error('contacts update:', error);
				return json({ error: error.message }, { status: 500 });
			}
			return json({ success: true, action: 'updated', id: existing.id });
		}

		const { data: inserted, error } = await supabase
			.from('contacts')
			.insert({ email, name: name ?? null, phone: phone ?? null })
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
