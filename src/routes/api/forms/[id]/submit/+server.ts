import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';
import { getFormWorkflow, runFormWorkflow } from '$lib/run-workflow.server';

export type SubmitBody = {
	name?: string;
	email?: string;
	phone?: string;
	street_address?: string;
	post_code?: string;
	city?: string;
	state?: string;
	roofSize?: number;
};

/**
 * POST /api/forms/[id]/submit – public. Submit form data, upsert contact, run form workflow (if any).
 * Quote generation and email are handled by the workflow (Form submit trigger + Generate quote / Send email actions).
 */
export const POST: RequestHandler = async (event) => {
	const formId = event.params.id;
	if (!formId) return json({ error: 'Missing form id' }, { status: 400 });

	let body: SubmitBody;
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
	if (!email) return json({ error: 'Email is required' }, { status: 400 });

	const admin = getSupabaseAdmin();

	const { data: form, error: formErr } = await admin
		.from('quote_forms')
		.select('id, user_id')
		.eq('id', formId)
		.single();
	if (formErr || !form) {
		return json({ error: 'Form not found' }, { status: 404 });
	}
	const ownerId = form.user_id as string;

	const name = typeof body?.name === 'string' ? body.name.trim() : null;
	const phone = typeof body?.phone === 'string' ? body.phone.trim() : null;
	const addressParts = [
		typeof body?.street_address === 'string' ? body.street_address.trim() : '',
		typeof body?.post_code === 'string' ? body.post_code.trim() : '',
		typeof body?.city === 'string' ? body.city.trim() : '',
		typeof body?.state === 'string' ? body.state.trim() : ''
	].filter(Boolean);
	const fullAddress = addressParts.join(', ') || undefined;

	await admin.rpc('upsert_contact_by_email', {
		p_email: email,
		p_name: name,
		p_phone: phone,
		p_address: fullAddress
	});

	let pdfUrl: string | undefined;
	const workflow = await getFormWorkflow(admin, formId);
	if (workflow) {
		const result = await runFormWorkflow(admin, workflow, {
			formId,
			ownerId,
			contact: { name, email, phone, address: fullAddress ?? null },
			roofSize: Math.max(0, Number(body?.roofSize) ?? 0) || undefined
		});
		pdfUrl = result.pdfUrl;
	}

	return json({ success: true, pdfUrl: pdfUrl ?? undefined });
};
