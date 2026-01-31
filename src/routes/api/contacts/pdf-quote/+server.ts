import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/supabase.server';

/**
 * POST /api/contacts/pdf-quote
 * Body: { email: string, pdfUrl: string }
 * Appends the PDF URL to all contacts with that email.
 * Use from n8n when you have the email (Chat or Shopify flow) - no widget/conversation needed.
 */
export const POST: RequestHandler = async (event) => {
	let body: { email?: string; pdfUrl?: string };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
	const pdfUrl = typeof body?.pdfUrl === 'string' ? body.pdfUrl.trim() : '';
	if (!email || !pdfUrl) {
		return json({ error: 'Missing email or pdfUrl' }, { status: 400 });
	}

	try {
		const supabase = getSupabase();
		const { error } = await supabase.rpc('append_pdf_quote_by_email', {
			p_email: email,
			p_pdf_url: pdfUrl
		});
		if (error) {
			console.error('append_pdf_quote_by_email:', error);
			return json({ error: error.message }, { status: 500 });
		}
		return json({ success: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to save PDF quote';
		console.error('POST /api/contacts/pdf-quote:', e);
		return json({ error: msg }, { status: 500 });
	}
};
