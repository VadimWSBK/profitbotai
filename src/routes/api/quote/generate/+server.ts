import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';
import {
	buildQuoteHtml,
	computeQuoteFromSettings,
	generatePdfFromHtml,
	type QuoteSettings
} from '$lib/quote-pdf.server';

const BUCKET = 'roof_quotes';

export type GenerateBody = {
	/** Required unless sample is true (dashboard preview). */
	widgetId?: string;
	conversationId?: string;
	email?: string;
	customer?: { name?: string; email?: string; phone?: string };
	project?: { roofSize?: number; fullAddress?: string };
	/** Override line items; otherwise use settings + project.roofSize */
	lineItems?: { desc: string; price: number; fixed: boolean; total?: number }[];
	/** If true, generate a sample PDF from current user's settings (no contact link). Requires session auth. */
	sample?: boolean;
};

/**
 * POST /api/quote/generate
 * Generates a quote PDF from saved template + payload, uploads to roof_quotes, links to contact.
 * Auth: session (dashboard) or X-API-Key (external automation). When using API key, widgetId is required.
 * Body: { widgetId, conversationId?, email?, customer?, project?, lineItems? }
 * Chat (Direct LLM) triggers quote internally via generateQuoteForConversation; this endpoint is for dashboard sample and server-to-server.
 */
export const POST: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: GenerateBody;
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const isSample = body?.sample === true;
	const widgetId = typeof body?.widgetId === 'string' ? body.widgetId.trim() : '';
	const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() : undefined;
	const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined;

	if (!isSample) {
		if (!widgetId) return json({ error: 'Missing widgetId' }, { status: 400 });
		if (!conversationId && !email) {
			return json({ error: 'Provide conversationId or email to link the quote to a contact' }, { status: 400 });
		}
	}
	// Sample mode requires session (no API key)
	if (isSample && event.locals.user.id === 'api-key') {
		return json({ error: 'Sample PDF requires dashboard login' }, { status: 401 });
	}

	const admin = getSupabaseAdmin();

	let ownerId: string;
	if (isSample) {
		ownerId = event.locals.user.id;
	} else {
		const { data: widget, error: widgetErr } = await admin
			.from('widgets')
			.select('id, created_by')
			.eq('id', widgetId)
			.single();
		if (widgetErr || !widget) return json({ error: 'Widget not found' }, { status: 404 });
		ownerId = widget.created_by as string;
		if (!ownerId) return json({ error: 'Widget has no owner' }, { status: 400 });
		const isApiKey = event.locals.user.id === 'api-key';
		if (!isApiKey && event.locals.user.id !== ownerId) {
			return json({ error: 'You do not own this widget' }, { status: 403 });
		}
	}

	// Load quote settings for widget owner
	const { data: settingsRow, error: settingsErr } = await admin
		.from('quote_settings')
		.select('*')
		.eq('user_id', ownerId)
		.maybeSingle();
	if (settingsErr || !settingsRow) {
		return json({ error: 'Quote settings not found. Configure your quote template in the Quote page first.' }, { status: 400 });
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

	// Load contact if conversationId (skip for sample)
	let customer = body.customer ?? {};
	let project = body.project ?? {};
	if (!isSample && conversationId && widgetId) {
		const { data: contact } = await admin
			.from('contacts')
			.select('name, email, phone, address')
			.eq('conversation_id', conversationId)
			.eq('widget_id', widgetId)
			.maybeSingle();
		if (contact) {
			customer = { name: contact.name ?? '', email: contact.email ?? '', phone: contact.phone ?? '' };
			if (contact.address) project = { ...project, fullAddress: contact.address };
		}
	} else if (!isSample && email) {
		customer = { ...customer, email };
	} else if (isSample) {
		customer = { name: 'Sample Customer', email: 'sample@example.com', phone: '+1 234 567 8900' };
		project = { roofSize: 100, fullAddress: '123 Sample St, City' };
	}

	const roofSize = Math.max(0, Number(project?.roofSize) ?? 0);
	const computed = computeQuoteFromSettings(settings, roofSize, { lineItems: body.lineItems });

	const payload = {
		customer,
		project: { roofSize, fullAddress: project?.fullAddress },
		quote: {
			quoteDate: computed.quoteDate,
			validUntil: computed.validUntil,
			breakdownTotals: computed.breakdownTotals,
			subtotal: computed.subtotal,
			gst: computed.gst,
			total: computed.total
		}
	};

	const html = buildQuoteHtml(settings, payload);

	let pdfBuffer: Buffer;
	try {
		pdfBuffer = await generatePdfFromHtml(html);
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'PDF generation failed';
		console.error('generatePdfFromHtml:', e);
		return json({
			error: msg,
			hint: 'Set PUPPETEER_EXECUTABLE_PATH to your Chrome/Chromium binary (e.g. /Applications/Google Chrome.app/Contents/MacOS/Google Chrome on macOS).'
		}, { status: 500 });
	}

	const customerName = (customer.name || customer.email || 'Customer').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
	const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
	const fileName = isSample
		? `samples/${ownerId}/quote_${customerName}_${ts}.pdf`
		: conversationId
			? `${conversationId}/quote_${customerName}_${ts}.pdf`
			: `email_${email?.replace(/[@.]/g, '_') ?? 'unknown'}_${ts}.pdf`;

	const metadata: Record<string, string> = {};
	if (!isSample) {
		metadata.widget_id = widgetId;
		if (conversationId) metadata.conversation_id = conversationId;
		if (email) metadata.email = email;
	}

	const { error: uploadErr } = await admin.storage.from(BUCKET).upload(fileName, pdfBuffer, {
		contentType: 'application/pdf',
		upsert: true,
		metadata
	});
	if (uploadErr) {
		console.error('roof_quotes upload:', uploadErr);
		return json({ error: uploadErr.message }, { status: 500 });
	}

	// For sample or for linking: return signed URL so client can download (bucket may be private)
	const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(fileName, 3600);
	const pdfUrl = signed?.signedUrl ?? fileName;

	return json({ success: true, pdfUrl, fileName });
};
