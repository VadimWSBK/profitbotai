import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/supabase.server';

/**
 * POST /api/widgets/[id]/contacts/pdf-quote
 * Body: { conversationId?: string, email?: string, pdfUrl: string }
 * Appends the PDF URL to the contact. Use conversationId (from chat) or email (works for both chat + Shopify).
 */
export const POST: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	if (!widgetId) return json({ error: 'Missing widget id' }, { status: 400 });

	let body: { conversationId?: string; email?: string; pdfUrl?: string };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() : '';
	const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
	const pdfUrl = typeof body?.pdfUrl === 'string' ? body.pdfUrl.trim() : '';
	if (!pdfUrl) return json({ error: 'Missing pdfUrl' }, { status: 400 });
	if (!conversationId && !email) {
		return json({ error: 'Provide conversationId or email' }, { status: 400 });
	}

	try {
		const supabase = getSupabase();
		if (conversationId) {
			const { error } = await supabase.rpc('append_pdf_quote_to_contact', {
				p_conversation_id: conversationId,
				p_widget_id: widgetId,
				p_pdf_url: pdfUrl
			});
			if (error) {
				console.error('append_pdf_quote_to_contact:', error);
				return json({ error: error.message }, { status: 500 });
			}
		} else {
			const { error } = await supabase.rpc('append_pdf_quote_by_email', {
				p_email: email,
				p_pdf_url: pdfUrl
			});
			if (error) {
				console.error('append_pdf_quote_by_email:', error);
				return json({ error: error.message }, { status: 500 });
			}
		}
		return json({ success: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to save PDF quote';
		console.error('POST /api/widgets/[id]/contacts/pdf-quote:', e);
		return json({ error: msg }, { status: 500 });
	}
};
