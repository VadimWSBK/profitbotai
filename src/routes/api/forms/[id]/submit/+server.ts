import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';
import {
	computeQuoteFromSettings,
	generatePdfFromDocDefinition,
	type QuoteSettings
} from '$lib/quote-pdf.server';

const BUCKET = 'roof_quotes';

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
 * POST /api/forms/[id]/submit – public. Submit form data, upsert contact, generate quote PDF, return download URL.
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

	// Upsert contact by email so PDF can be linked via storage trigger
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

	// Load quote settings for form owner
	const { data: settingsRow, error: settingsErr } = await admin
		.from('quote_settings')
		.select('*')
		.eq('user_id', ownerId)
		.maybeSingle();
	if (settingsErr || !settingsRow) {
		return json({
			error: 'Quote settings not found. The form owner must configure their quote template in the Quote page first.'
		}, { status: 400 });
	}

	const settings: QuoteSettings = {
		company: (settingsRow.company as QuoteSettings['company']) ?? {},
		bank_details: (settingsRow.bank_details as QuoteSettings['bank_details']) ?? {},
		line_items: (settingsRow.line_items as QuoteSettings['line_items']) ?? [],
		deposit_percent: Number(settingsRow.deposit_percent) ?? 40,
		tax_percent: Number(settingsRow.tax_percent) ?? 10,
		valid_days: Number(settingsRow.valid_days) ?? 30,
		logo_url: settingsRow.logo_url,
		barcode_url: settingsRow.barcode_url,
		barcode_title: settingsRow.barcode_title ?? 'Call Us or Visit Website',
		currency: settingsRow.currency ?? 'USD'
	};

	const customer = { name: name ?? '', email, phone: phone ?? '' };
	const roofSize = Math.max(0, Number(body?.roofSize) ?? 0);
	const computed = computeQuoteFromSettings(settings, roofSize);

	const payload = {
		customer,
		project: { roofSize, fullAddress },
		quote: {
			quoteDate: computed.quoteDate,
			validUntil: computed.validUntil,
			breakdownTotals: computed.breakdownTotals,
			subtotal: computed.subtotal,
			gst: computed.gst,
			total: computed.total
		}
	};

	let pdfBuffer: Buffer;
	try {
		pdfBuffer = await generatePdfFromDocDefinition(settings, payload);
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'PDF generation failed';
		console.error('generatePdfFromDocDefinition:', e);
		return json({ error: msg }, { status: 500 });
	}

	const ts = new Date().toISOString().replaceAll(/\D/g, '').slice(0, 14);
	const fileName = `form_${formId}/email_${email.replaceAll(/[@.]/g, '_')}_${ts}.pdf`;

	const { error: uploadErr } = await admin.storage.from(BUCKET).upload(fileName, pdfBuffer, {
		contentType: 'application/pdf',
		upsert: true,
		metadata: { email, form_id: formId }
	});
	if (uploadErr) {
		console.error('roof_quotes upload:', uploadErr);
		return json({ error: uploadErr.message }, { status: 500 });
	}

	const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(fileName, 3600);
	const pdfUrl = signed?.signedUrl ?? fileName;

	return json({ success: true, pdfUrl });
};
