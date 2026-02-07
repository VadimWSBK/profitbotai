import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';

/**
 * POST /api/forms/[id]/save-contact – public.
 * Lightweight early-save: upserts the contact (name, email, phone) without
 * running the full form workflow. This lets us capture essential contact data
 * as soon as the user finishes the contact-info step, even if they abandon
 * later steps. The final /submit endpoint will upsert again with full address
 * data and trigger the workflow.
 */
export const POST: RequestHandler = async (event) => {
	const formId = event.params.id;
	if (!formId) return json({ error: 'Missing form id' }, { status: 400 });

	let body: { name?: string; email?: string; phone?: string };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
	if (!email) return json({ error: 'Email is required' }, { status: 400 });

	const admin = getSupabaseAdmin();

	// Verify the form exists
	const { data: form, error: formErr } = await admin
		.from('quote_forms')
		.select('id')
		.eq('id', formId)
		.single();
	if (formErr || !form) {
		return json({ error: 'Form not found' }, { status: 404 });
	}

	const name = typeof body?.name === 'string' ? body.name.trim() : null;
	const phone = typeof body?.phone === 'string' ? body.phone.trim() : null;

	await admin.rpc('upsert_contact_by_email', {
		p_email: email,
		p_name: name,
		p_phone: phone,
		p_address: undefined
	});

	return json({ success: true });
};
