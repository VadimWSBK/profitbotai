/**
 * Quote PDF: generate PDF from HTML via Puppeteer. Server-only.
 */

import { buildQuoteHtml, computeQuoteFromSettings } from '$lib/quote-html';
import type { QuoteSettings } from '$lib/quote-html';
import type { SupabaseClient } from '@supabase/supabase-js';

export { buildQuoteHtml, computeQuoteFromSettings } from '$lib/quote-html';
export type { QuoteSettings, QuotePayload, QuoteCompany, QuoteBankDetails, QuoteLineItem } from '$lib/quote-html';

const BUCKET = 'roof_quotes';

/**
 * Generate a quote PDF for a conversation and upload to roof_quotes. Storage trigger will link to contact.
 * Returns signed URL for the new PDF or an error message.
 */
export async function generateQuoteForConversation(
	admin: SupabaseClient,
	conversationId: string,
	widgetId: string,
	contact: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null },
	extracted: { roofSize?: number } | null
): Promise<{ signedUrl?: string; error?: string }> {
	const ownerId = (await admin.from('widgets').select('created_by').eq('id', widgetId).single()).data?.created_by as string | undefined;
	if (!ownerId) return { error: 'Widget has no owner' };

	const { data: settingsRow } = await admin.from('quote_settings').select('*').eq('user_id', ownerId).maybeSingle();
	if (!settingsRow) return { error: 'Quote settings not found' };

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

	const customer = { name: contact.name ?? '', email: contact.email ?? '', phone: contact.phone ?? '' };
	const project = { roofSize: extracted?.roofSize ?? 0, fullAddress: contact.address ?? '' };
	const roofSize = Math.max(0, project.roofSize);
	const computed = computeQuoteFromSettings(settings, roofSize);
	const payload = {
		customer,
		project,
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
		return { error: e instanceof Error ? e.message : 'PDF generation failed' };
	}

	const customerName = (customer.name || customer.email || 'Customer').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
	const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
	const fileName = `${conversationId}/quote_${customerName}_${ts}.pdf`;
	const { error: uploadErr } = await admin.storage.from(BUCKET).upload(fileName, pdfBuffer, {
		contentType: 'application/pdf',
		upsert: true,
		metadata: { conversation_id: conversationId, widget_id: widgetId }
	});
	if (uploadErr) return { error: uploadErr.message };

	const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(fileName, 3600);
	return { signedUrl: signed?.signedUrl ?? undefined };
}

/**
 * Generate PDF buffer from HTML. Requires Chromium (PUPPETEER_EXECUTABLE_PATH or system Chrome).
 */
export async function generatePdfFromHtml(html: string): Promise<Buffer> {
	const puppeteer = await import('puppeteer-core');
	const env = await import('$env/dynamic/private').then((m) => m.env);
	const executablePath =
		env.PUPPETEER_EXECUTABLE_PATH ||
		(process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);

	if (!executablePath) {
		throw new Error(
			'PDF generation requires Chromium. Set PUPPETEER_EXECUTABLE_PATH to your Chrome/Chromium binary, or install Puppeteer with Chromium.'
		);
	}

	const browser = await puppeteer.default.launch({
		headless: true,
		executablePath,
		args: ['--no-sandbox', '--disable-setuid-sandbox']
	});

	try {
		const page = await browser.newPage();
		await page.setContent(html, { waitUntil: 'networkidle0' });
		const pdfBuffer = await page.pdf({
			format: 'A4',
			printBackground: true,
			margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
		});
		return Buffer.from(pdfBuffer);
	} finally {
		await browser.close();
	}
}
