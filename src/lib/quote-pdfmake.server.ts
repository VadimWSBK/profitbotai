/**
 * Build pdfmake document definition from quote settings and payload.
 * Pure JS, no Chromium. Uses pdfmake (Roboto fonts shipped with package).
 */

import { getPrimaryEmail } from '$lib/contact-email-jsonb';
import { extractAreaDigits } from '$lib/quote-html';
import type { QuoteSettings, QuotePayload, QuoteBankDetails } from '$lib/quote-html';

const formatCurrency = (n: number, currency = 'USD') =>
	new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n) || 0);

/** pdfmake document definition (simplified types) */
type DocDef = {
	pageSize?: string;
	pageMargins?: number | number[];
	defaultStyle?: Record<string, unknown>;
	styles?: Record<string, Record<string, unknown>>;
	content: unknown[];
	footer?: (currentPage: number, pageCount: number) => unknown[];
};

/**
 * Build pdfmake document definition for quote PDF.
 */
export function buildQuoteDocDefinition(settings: QuoteSettings, payload: QuotePayload, images?: string[]): DocDef {
	const company = settings.company ?? {};
	const customer = payload.customer ?? {};
	const project = payload.project ?? {};
	const quote = payload.quote ?? {};
	const bankDetails = settings.bank_details ?? {};
	const breakdownTotals = quote.breakdownTotals ?? [];
	// Extract numeric value from roofSize (handles strings like "300 m²", "200sqm", etc.)
	const roofSize = extractAreaDigits(project.roofSize);
	const currency = settings.currency || 'USD';
	const total = Number(quote.total) ?? 0;
	const depositPercent = Math.max(0, Math.min(100, Number(settings.deposit_percent) ?? 40));
	const depositAmount = total * (depositPercent / 100);
	const fmt = (n: number) => formatCurrency(n, currency);
	// A4 width 595pt minus left/right margins 36*2 (same for body and footer)
	const contentWidth = 595 - 36 * 2;
	const pageMarginH = 36;
	// Logo: cap size so it doesn't dominate the quote; fit inside width x height box
	const logoWidth = Math.max(20, Math.min(80, Number(settings.logo_size) ?? 60));
	const logoMaxHeight = 52;
	const qrWidth = Math.max(20, Math.min(300, Number(settings.qr_size) ?? 80));

	const content: unknown[] = [
		{
			columns: [
				{
					width: '*',
					stack: [
						...(settings.logo_base64 ? [{ image: settings.logo_base64, fit: [logoWidth, logoMaxHeight], margin: [0, 0, 0, 8] }] : []),
						{ text: company.name ?? '', style: 'companyName' },
						...(company.address
							? [{ text: String(company.address).replace(/\n/g, '\n'), fontSize: 9, margin: [0, 2, 0, 0] }]
							: []),
						...(company.phone ? [{ text: company.phone, fontSize: 9 }] : []),
						...(company.email ? [{ text: company.email, fontSize: 9 }] : [])
					]
				},
				{
					width: '*',
					alignment: 'right',
					stack: [
						{ text: 'QUOTE', style: 'quoteTitle' },
						{ text: 'CUSTOMER:', style: 'sectionTitle', margin: [0, 8, 0, 2] },
						{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5 }] },
						{ text: customer.name ?? 'N/A', fontSize: 9, margin: [0, 4, 0, 0] },
						{ text: getPrimaryEmail(customer.email) ?? 'N/A', fontSize: 9 },
						...(customer.phone ? [{ text: customer.phone, fontSize: 9 }] : []),
						{ text: project.fullAddress ?? 'N/A', fontSize: 9 }
					]
				}
			],
			margin: [0, 0, 0, 12]
		},
		{
			columns: [
				{
					width: '*',
					stack: [
						{ text: 'Measurements:', style: 'sectionTitle', margin: [0, 0, 0, 2] },
						{ text: `Total Area: ${roofSize} m²`, fontSize: 9 },
						{ text: '(Quotation is subject to final inspection and measurement)', fontSize: 8, italics: true, color: '#666' }
					]
				},
				{
					width: '*',
					alignment: 'right',
					stack: [
						{ text: `Issue Date: ${quote.quoteDate ?? ''}`, fontSize: 9 },
						{ text: `Valid Through: ${quote.validUntil ?? ''}`, fontSize: 9 }
					]
				}
			],
			margin: [0, 0, 0, 12]
		}
	];

	if (breakdownTotals.length > 0) {
		const tableBody: unknown[][] = [
			[
				{ text: 'Pos.', fillColor: '#2e7d32', color: 'white', bold: true },
				{ text: 'Description', fillColor: '#2e7d32', color: 'white', bold: true },
				{ text: 'Total Area (m²)', fillColor: '#2e7d32', color: 'white', bold: true },
				{ text: 'Price / m²', fillColor: '#2e7d32', color: 'white', bold: true },
				{ text: 'Subtotal', fillColor: '#2e7d32', color: 'white', bold: true, alignment: 'right' }
			]
		];
		breakdownTotals.forEach((line, i) => {
			tableBody.push([
				`${i + 1}`,
				line.desc,
				line.fixed ? '-' : String(roofSize),
				line.fixed ? '-' : fmt(line.price),
				{ text: fmt(line.total), bold: true, alignment: 'right' }
			]);
		});
		content.push({
			table: { headerRows: 1, widths: ['auto', '*', 'auto', 'auto', 'auto'], body: tableBody },
			layout: { hLineWidth: () => 0.3, vLineWidth: () => 0.3 },
			fontSize: 9,
			margin: [0, 0, 0, 12]
		});
	}

	content.push(
		{
			alignment: 'right',
			stack: [
				{ text: `Subtotal: ${fmt(Number(quote.subtotal) ?? 0)}`, fontSize: 9 },
				...(Number(quote.gst) > 0
					? [{ text: `GST (${settings.tax_percent ?? 10}%): ${fmt(Number(quote.gst) ?? 0)}`, fontSize: 9 }]
					: []),
				{ text: `Total: ${fmt(total)}`, fontSize: 12, bold: true, margin: [0, 4, 0, 0] }
			],
			margin: [0, 0, 0, 8]
		},
		{
			text: `Note: ${depositPercent}% deposit is to be paid upfront. (${fmt(depositAmount)})`,
			fontSize: 9,
			margin: [0, 0, 0, 8]
		},
		{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: contentWidth, y2: 0, lineWidth: 0.5 }], margin: [0, 0, 0, 12] }
	);

	// Add images if provided (screenshots, photos, etc.)
	if (images && images.length > 0) {
		content.push({ text: 'Images:', style: 'sectionTitle', margin: [0, 12, 0, 4] });
		for (const imageUrl of images) {
			if (imageUrl && typeof imageUrl === 'string') {
				content.push({
					image: imageUrl,
					width: contentWidth,
					margin: [0, 4, 0, 8],
					fit: [contentWidth, 400] // Max height 400pt, maintain aspect ratio
				});
			}
		}
	}

	if ((bankDetails as QuoteBankDetails)?.name || settings.barcode_url) {
		const bankStack: unknown[] = [];
		if ((bankDetails as QuoteBankDetails).name) {
			bankStack.push(
				{ text: 'Bank Details:', style: 'sectionTitle', margin: [0, 0, 0, 2] },
				{ text: (bankDetails as QuoteBankDetails).name, fontSize: 9 },
				{ text: `Name: ${(bankDetails as QuoteBankDetails).accountName ?? ''}`, fontSize: 9 },
				{ text: `BSB: ${(bankDetails as QuoteBankDetails).bsb ?? ''}`, fontSize: 9 },
				{ text: `Number: ${(bankDetails as QuoteBankDetails).accountNumber ?? ''}`, fontSize: 9 }
			);
		}
		const qrStack: unknown[] = [];
		if (settings.barcode_base64) {
			qrStack.push(
				{ text: settings.barcode_title ?? 'Call Us or Visit Website', style: 'sectionTitle', margin: [0, 0, 0, 2] },
				{ image: settings.barcode_base64, width: qrWidth, margin: [0, 4, 0, 0] }
			);
		} else if (settings.barcode_url) {
			qrStack.push(
				{ text: settings.barcode_title ?? 'Call Us or Visit Website', style: 'sectionTitle', margin: [0, 0, 0, 2] },
				{ text: '(QR code image – use Quote preview for full layout)', fontSize: 8, italics: true, color: '#666' }
			);
		}
		content.push({
			columns: [
				{ width: '*', stack: bankStack },
				{ width: 'auto', alignment: 'right', stack: qrStack }
			],
			margin: [0, 0, 0, 12]
		});
	}

	// Footer: same horizontal inset as body (pageMarginH each side); line and text sit inside that
	const footerInnerWidth = contentWidth - pageMarginH * 2;
	const footerContent = () => [
		{
			margin: [pageMarginH, 0, pageMarginH, 0],
			stack: [
				{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: footerInnerWidth, y2: 0, lineWidth: 0.5 }], margin: [0, 0, 0, 12] },
				{
					columns: [
						{ width: '*', text: 'Thank you for your interest!', fontSize: 9 },
						{ width: 'auto', text: `Generated by ${company.name ?? ''}`, fontSize: 9, alignment: 'right' }
					]
				}
			]
		}
	];

	return {
		pageSize: 'A4',
		pageMargins: [36, 36],
		defaultStyle: { fontSize: 10 },
		styles: {
			companyName: { fontSize: 12, bold: true },
			quoteTitle: { fontSize: 18, bold: true, color: '#2e7d32' },
			sectionTitle: { fontSize: 10, bold: true }
		},
		content,
		footer: footerContent
	};
}
