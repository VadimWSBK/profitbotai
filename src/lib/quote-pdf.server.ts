/**
 * Quote PDF: generate PDF via pdfmake (pure JS, no Chromium). Server-only.
 */

import { computeQuoteFromSettings } from '$lib/quote-html';
import { buildQuoteDocDefinition } from '$lib/quote-pdfmake.server';
import type { QuoteSettings } from '$lib/quote-html';
import type { SupabaseClient } from '@supabase/supabase-js';

export { buildQuoteHtml, computeQuoteFromSettings } from '$lib/quote-html';
export type { QuoteSettings, QuotePayload, QuoteCompany, QuoteBankDetails, QuoteLineItem } from '$lib/quote-html';

const BUCKET = 'roof_quotes';

/**
 * Generate a quote PDF for a conversation and upload to roof_quotes. Storage trigger will link to contact.
 * Returns signed URL and storage path for the new PDF, or an error message.
 * Caller should append the public URL to the contact (storage trigger may not receive custom metadata).
 * Pass ownerId when already known (e.g. from chat) to avoid a second widget lookup.
 */
export async function generateQuoteForConversation(
	admin: SupabaseClient,
	conversationId: string,
	widgetId: string,
	contact: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null },
	extracted: { roofSize?: number } | null,
	ownerIdFromCaller?: string
): Promise<{ signedUrl?: string; storagePath?: string; error?: string }> {
	let ownerId: string | undefined = ownerIdFromCaller;
	if (!ownerId) {
		const row = (await admin.from('widgets').select('created_by').eq('id', widgetId).single()).data;
		ownerId = row?.created_by as string | undefined;
	}
	if (!ownerId) {
		console.error('[quote-pdf] Widget has no owner', { widgetId });
		return { error: 'Widget has no owner' };
	}

	let settingsRow = (await admin.from('quote_settings').select('*').eq('user_id', ownerId).maybeSingle()).data;
	if (!settingsRow) {
		// Create default quote_settings so first-time quote generation works (owner may not have visited Quote page yet)
		const { error: upsertErr } = await admin.from('quote_settings').upsert(
			{
				user_id: ownerId,
				company: {},
				bank_details: {},
				line_items: [],
				deposit_percent: 40,
				tax_percent: 10,
				valid_days: 30,
				currency: 'USD'
			},
			{ onConflict: 'user_id' }
		);
		if (upsertErr) {
			console.error('[quote-pdf] Quote settings not found and failed to create default:', upsertErr);
			return { error: 'Quote settings not found. Save your quote template in Settings → Quote first.' };
		}
		settingsRow = (await admin.from('quote_settings').select('*').eq('user_id', ownerId).single()).data ?? undefined;
	}
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

	let pdfBuffer: Buffer;
	try {
		pdfBuffer = await generatePdfFromDocDefinition(settings, payload);
	} catch (e) {
		const errMsg = e instanceof Error ? e.message : 'PDF generation failed';
		console.error('[quote-pdf] generatePdfFromDocDefinition failed:', e);
		return { error: errMsg };
	}

	// Ensure roof_quotes bucket exists (private for secure PDF storage)
	const { data: buckets } = await admin.storage.listBuckets();
	if (!buckets?.some((b) => b.name === BUCKET)) {
		const { error: createErr } = await admin.storage.createBucket(BUCKET, { public: false });
		if (createErr) {
			console.error('[quote-pdf] Failed to create bucket:', createErr);
			return { error: `Storage bucket ${BUCKET} could not be created: ${createErr.message}` };
		}
	}

	const customerName = (customer.name || customer.email || 'Customer').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
	const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
	const fileName = `${conversationId}/quote_${customerName}_${ts}.pdf`;
	const { error: uploadErr } = await admin.storage.from(BUCKET).upload(fileName, pdfBuffer, {
		contentType: 'application/pdf',
		upsert: true,
		metadata: { conversation_id: conversationId, widget_id: widgetId }
	});
	if (uploadErr) {
		console.error('[quote-pdf] Storage upload failed:', uploadErr);
		return { error: `Upload failed: ${uploadErr.message}. Ensure the roof_quotes bucket exists in Supabase Storage.` };
	}

	const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(fileName, 3600);
	return { signedUrl: signed?.signedUrl ?? undefined, storagePath: fileName };
}

/**
 * Generate PDF buffer via pdfmake (pure JS, no Chromium).
 * Uses Roboto fonts shipped with pdfmake package.
 */
export async function generatePdfFromDocDefinition(
	settings: QuoteSettings,
	payload: Parameters<typeof buildQuoteDocDefinition>[1]
): Promise<Buffer> {
	const pdfmake = (await import('pdfmake')).default;
	const pathMod = await import('node:path');
	const path = pathMod.default ?? pathMod;

	// Roboto fonts shipped with pdfmake
	const fontsDir = path.join(process.cwd(), 'node_modules', 'pdfmake', 'fonts');
	const fonts = {
		Roboto: {
			normal: path.join(fontsDir, 'Roboto/Roboto-Regular.ttf'),
			bold: path.join(fontsDir, 'Roboto/Roboto-Medium.ttf'),
			italics: path.join(fontsDir, 'Roboto/Roboto-Italic.ttf'),
			bolditalics: path.join(fontsDir, 'Roboto/Roboto-MediumItalic.ttf')
		}
	};
	pdfmake.setFonts(fonts);

	const docDefinition = buildQuoteDocDefinition(settings, payload);
	const pdfDoc = pdfmake.createPdf(docDefinition);
	const buffer = await pdfDoc.getBuffer();
	return Buffer.from(buffer);
}

/** @deprecated Use generatePdfFromDocDefinition. Kept for backwards compatibility. */
export async function generatePdfFromHtml(html: string): Promise<Buffer> {
	throw new Error(
		'HTML-to-PDF (Puppeteer) is deprecated. PDF generation now uses pdfmake (no Chromium). Use the quote flow.'
	);
}
