/**
 * Quote PDF: generate PDF via pdfmake (pure JS, no Chromium). Server-only.
 * Fonts are loaded via SvelteKit read() so they are included in Vercel serverless bundle.
 */

import { read } from '$app/server';
import { computeQuoteFromSettings } from '$lib/quote-html';
import { buildQuoteDocDefinition } from '$lib/quote-pdfmake.server';
import type { QuoteSettings } from '$lib/quote-html';
import type { SupabaseClient } from '@supabase/supabase-js';

// Import fonts so they are in the server bundle; we load them via read() and pdfmake virtualfs
import robotoRegular from '$lib/fonts/Roboto/Roboto-Regular.ttf';
import robotoMedium from '$lib/fonts/Roboto/Roboto-Medium.ttf';
import robotoItalic from '$lib/fonts/Roboto/Roboto-Italic.ttf';
import robotoMediumItalic from '$lib/fonts/Roboto/Roboto-MediumItalic.ttf';

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
			const authHint = upsertErr.message?.includes('Invalid API key') || upsertErr.message?.includes('JWT')
				? ' (Check SUPABASE_SERVICE_ROLE_KEY in environment)'
				: '';
			console.error('[quote-pdf] Quote settings not found and failed to create default:', upsertErr.message, authHint);
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
 * Generate a quote PDF from form submission data (no conversation). Used when a workflow with
 * "Form submit" trigger runs a "Generate quote" action. Uploads to roof_quotes and returns signed URL.
 */
export async function generateQuoteForForm(
	admin: SupabaseClient,
	formId: string,
	ownerId: string,
	contact: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null },
	roofSize?: number
): Promise<{ signedUrl?: string; storagePath?: string; error?: string }> {
	let settingsRow = (await admin.from('quote_settings').select('*').eq('user_id', ownerId).maybeSingle()).data;
	if (!settingsRow) {
		const { error: upsertErr } = await admin.from('quote_settings').upsert(
			{ user_id: ownerId, company: {}, bank_details: {}, line_items: [], deposit_percent: 40, tax_percent: 10, valid_days: 30, currency: 'USD' },
			{ onConflict: 'user_id' }
		);
		if (upsertErr) return { error: 'Quote settings not found. Configure your quote template first.' };
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
	const roof = Math.max(0, Number(roofSize) ?? 0);
	const computed = computeQuoteFromSettings(settings, roof);
	const payload = {
		customer,
		project: { roofSize: roof, fullAddress: contact.address ?? '' },
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
		return { error: errMsg };
	}

	const { data: buckets } = await admin.storage.listBuckets();
	if (!buckets?.some((b) => b.name === BUCKET)) {
		const { error: createErr } = await admin.storage.createBucket(BUCKET, { public: false });
		if (createErr) return { error: `Storage: ${createErr.message}` };
	}

	const email = (contact.email ?? '').replaceAll(/[@.]/g, '_');
	const ts = new Date().toISOString().replaceAll(/\D/g, '').slice(0, 14);
	const fileName = `form_${formId}/email_${email}_${ts}.pdf`;
	const { error: uploadErr } = await admin.storage.from(BUCKET).upload(fileName, pdfBuffer, {
		contentType: 'application/pdf',
		upsert: true,
		metadata: { email: contact.email ?? '', form_id: formId }
	});
	if (uploadErr) return { error: uploadErr.message };

	const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(fileName, 3600);
	return { signedUrl: signed?.signedUrl ?? undefined, storagePath: fileName };
}

const FONT_KEYS = {
	normal: 'Roboto-Regular.ttf',
	bold: 'Roboto-Medium.ttf',
	italics: 'Roboto-Italic.ttf',
	bolditalics: 'Roboto-MediumItalic.ttf'
} as const;

const FONT_IMPORTS = [
	robotoRegular,
	robotoMedium,
	robotoItalic,
	robotoMediumItalic
] as const;

/** Mime types that pdfmake does not support; we rasterize these to PNG. */
const UNSUPPORTED_MIMES = new Set(['image/svg+xml', 'image/svg', 'image/webp']);

function isSvgBuffer(buf: Buffer): boolean {
	const start = buf.subarray(0, 1024).toString('utf8').trimStart();
	return start.startsWith('<?xml') || start.startsWith('<svg');
}

/**
 * Fetch image URL and return a data URL (base64) for embedding in pdfmake.
 * pdfmake only supports raster formats (PNG, JPEG, GIF). SVG and WebP are converted to PNG.
 * Returns null on failure or if url is empty. Passes through existing data URLs (raster only).
 */
async function urlToBase64DataUrl(url: string | null | undefined): Promise<string | null> {
	if (!url || typeof url !== 'string') return null;
	const trimmed = url.trim();
	if (!trimmed) return null;
	try {
		let buf: Buffer;
		let mime: string;

		if (trimmed.startsWith('data:')) {
			const match = /^data:([^;]+);base64,(.+)$/.exec(trimmed);
			if (!match) return null;
			mime = match[1].toLowerCase();
			buf = Buffer.from(match[2], 'base64');
		} else {
			const res = await fetch(trimmed, { cache: 'no-store' });
			if (!res.ok) return null;
			const blob = await res.blob();
			buf = Buffer.from(await blob.arrayBuffer());
			mime = (blob.type || 'image/png').toLowerCase();
		}

		// pdfmake does not support SVG or WebP; rasterize to PNG
		const needsRaster =
			UNSUPPORTED_MIMES.has(mime) || mime === 'image/svg+xml' || isSvgBuffer(buf);
		if (needsRaster && buf.length > 0) {
			const sharp = (await import('sharp')).default;
			const png = await sharp(buf).png().toBuffer();
			const base64 = png.toString('base64');
			return `data:image/png;base64,${base64}`;
		}

		const base64 = buf.toString('base64');
		const outMime = mime || 'image/png';
		return `data:${outMime};base64,${base64}`;
	} catch {
		return null;
	}
}

/**
 * Generate PDF buffer via pdfmake (pure JS, no Chromium).
 * Fonts are loaded via SvelteKit read() into pdfmake virtualfs so they work on Vercel (no filesystem).
 * Resolves logo_url and barcode_url to base64 so they are embedded in the PDF.
 */
export async function generatePdfFromDocDefinition(
	settings: QuoteSettings,
	payload: Parameters<typeof buildQuoteDocDefinition>[1]
): Promise<Buffer> {
	const pdfmake = (await import('pdfmake')).default;

	// Load font buffers via SvelteKit read() so they are in the serverless bundle; write to virtualfs
	const vfs = pdfmake.virtualfs;
	const keys = Object.values(FONT_KEYS);
	for (let i = 0; i < keys.length; i++) {
		const res = read(FONT_IMPORTS[i]);
		const buf = await res.arrayBuffer();
		vfs.writeFileSync(keys[i], new Uint8Array(buf));
	}
	pdfmake.setFonts({
		Roboto: {
			normal: FONT_KEYS.normal,
			bold: FONT_KEYS.bold,
			italics: FONT_KEYS.italics,
			bolditalics: FONT_KEYS.bolditalics
		}
	});

	// Resolve logo and QR code URLs to base64 so pdfmake can embed them (it doesn't fetch URLs in Node)
	const [logo_base64, barcode_base64] = await Promise.all([
		urlToBase64DataUrl(settings.logo_url),
		urlToBase64DataUrl(settings.barcode_url)
	]);
	const resolvedSettings: QuoteSettings = {
		...settings,
		logo_base64: logo_base64 ?? undefined,
		barcode_base64: barcode_base64 ?? undefined
	};

	const docDefinition = buildQuoteDocDefinition(resolvedSettings, payload);
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
