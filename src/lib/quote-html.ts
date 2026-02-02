/**
 * Quote HTML: build HTML and compute totals. Shared between client (preview) and server (PDF).
 */

export type QuoteCompany = {
	name?: string;
	address?: string;
	phone?: string;
	email?: string;
};

export type QuoteBankDetails = {
	name?: string;
	accountName?: string;
	bsb?: string;
	accountNumber?: string;
};

export type QuoteLineItem = {
	desc: string;
	price: number;
	fixed: boolean;
	total?: number;
};

export type QuoteSettings = {
	company: QuoteCompany;
	bank_details: QuoteBankDetails;
	line_items: QuoteLineItem[];
	deposit_percent: number;
	tax_percent: number;
	valid_days: number;
	logo_url?: string | null;
	barcode_url?: string | null;
	barcode_title?: string | null;
	currency: string;
};

export type QuotePayload = {
	customer?: { name?: string; email?: string; phone?: string };
	project?: { roofSize?: number; fullAddress?: string };
	quote?: {
		quoteDate?: string;
		validUntil?: string;
		subtotal?: number;
		gst?: number;
		total?: number;
		breakdownTotals?: { desc: string; price: number; fixed: boolean; total: number }[];
	};
};

function escapeHtml(s: string | null | undefined): string {
	if (s == null) return '';
	const str = String(s);
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function escapeAttr(s: string | null | undefined): string {
	if (s == null) return '';
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function fixUrl(url: string | null | undefined): string | null {
	if (!url) return null;
	if (typeof url !== 'string') return null;
	const u = url.trim();
	if (!u) return null;
	if (u.startsWith('//')) return 'https:' + u;
	if (!u.startsWith('http')) return 'https://' + u;
	return u;
}

export function buildQuoteHtml(settings: QuoteSettings, payload: QuotePayload): string {
	const company = settings.company ?? {};
	const customer = payload.customer ?? {};
	const project = payload.project ?? {};
	const quote = payload.quote ?? {};
	const bankDetails = settings.bank_details ?? {};
	const breakdownTotals = quote.breakdownTotals ?? [];
	const roofSize = Number(project.roofSize) ?? 0;
	const currency = settings.currency || 'USD';
	const formatCurrency = (n: number) =>
		new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n) || 0);
	const total = Number(quote.total) ?? 0;
	const depositPercent = Math.max(0, Math.min(100, Number(settings.deposit_percent) ?? 40));
	const depositAmount = total * (depositPercent / 100);

	const logoUrl = fixUrl(settings.logo_url ?? '');
	const barcodeImageUrl = fixUrl(settings.barcode_url ?? '');
	const barcodeTitle = settings.barcode_title ?? 'Call Us or Visit Website';

	const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    body { font-family: Helvetica, Arial, sans-serif; font-size: 11px; color: #000; margin: 0; padding: 36px 44px; }
    .page { max-width: 210mm; margin: 0 auto; }
    .two-col { display: flex; justify-content: space-between; gap: 20px; }
    .col-left { flex: 1; max-width: 50%; }
    .col-right { flex: 1; max-width: 50%; text-align: right; }
    .quote-title { font-size: 24px; font-weight: bold; color: #2e7d32; margin-bottom: 20px; }
    .section-title { font-size: 12px; font-weight: bold; margin: 10px 0 4px 0; }
    .section-title + div, .section-title + p { margin: 0 0 4px 0; font-size: 11px; }
    hr { border: none; border-top: 1px solid #000; margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 9px; }
    th { background: #2e7d32 !important; color: #fff !important; padding: 6px 4px; text-align: left; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td { padding: 5px 4px; border-bottom: 1px solid #eee; }
    th:nth-child(1), td:nth-child(1) { width: 8%; }
    th:nth-child(2), td:nth-child(2) { width: 42%; }
    th:nth-child(3), td:nth-child(3) { width: 14%; }
    th:nth-child(4), td:nth-child(4) { width: 14%; }
    th:nth-child(5), td:nth-child(5) { width: 22%; text-align: right; }
    .totals { text-align: right; margin: 10px 0; font-size: 11px; }
    .totals .total { font-size: 14px; font-weight: bold; margin-top: 4px; }
    .deposit { font-size: 11px; margin: 8px 0; }
    .bank-qr-row { display: flex; justify-content: space-between; gap: 20px; margin-top: 12px; }
    .bank-details, .qr-block { flex: 1; }
    .qr-block { text-align: right; }
    .qr-block img { max-width: 80px; height: auto; display: block; margin-left: auto; }
    .company-logo { max-height: 52px; width: auto; margin-bottom: 8px; display: block; }
    .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 10px; display: flex; justify-content: space-between; }
    @media print { body { padding: 36px 44px; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="two-col">
      <div class="col-left">
        ${logoUrl ? `<img src="${escapeAttr(logoUrl)}" alt="" class="company-logo" />` : ''}
        <strong style="font-size: 14px;">${escapeHtml(company.name)}</strong><br>
        ${company.address ? escapeHtml(company.address).replace(/\n/g, '<br>') + '<br>' : ''}
        ${company.phone ? escapeHtml(company.phone) + '<br>' : ''}
        ${company.email ? escapeHtml(company.email) : ''}
      </div>
      <div class="col-right">
        <div class="quote-title">QUOTE</div>
        <div class="section-title">CUSTOMER:</div>
        <hr>
        <div>${escapeHtml(customer.name ?? 'N/A')}</div>
        <div>${escapeHtml(customer.email ?? 'N/A')}</div>
        ${customer.phone ? '<div>' + escapeHtml(customer.phone) + '</div>' : ''}
        <div>${escapeHtml(project.fullAddress ?? 'N/A')}</div>
      </div>
    </div>

    <div class="two-col" style="margin-top: 18px;">
      <div class="col-left">
        <div class="section-title">Measurements:</div>
        <div>Total Area: ${roofSize} m²</div>
        <div style="font-size: 10px;">(Quotation is subject to final inspection and measurement)</div>
      </div>
      <div class="col-right">
        <div>Issue Date: ${escapeHtml(quote.quoteDate)}</div>
        <div>Valid Through: ${escapeHtml(quote.validUntil)}</div>
      </div>
    </div>

    ${
		breakdownTotals.length
			? `
    <table>
      <thead>
        <tr>
          <th>Pos.</th>
          <th>Description</th>
          <th>Total Area (m²)</th>
          <th>Price / m²</th>
          <th>Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${breakdownTotals
					.map(
						(line: { desc: string; fixed: boolean; price: number; total: number }, i: number) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(line.desc)}</td>
          <td>${line.fixed ? '-' : roofSize}</td>
          <td>${line.fixed ? '-' : formatCurrency(line.price)}</td>
          <td style="font-weight: bold;">${formatCurrency(line.total)}</td>
        </tr>
        `
					)
					.join('')}
      </tbody>
    </table>
    `
			: ''
	}

    <div class="totals">
      <div>Subtotal: ${formatCurrency(Number(quote.subtotal) ?? 0)}</div>
      ${Number(quote.gst) > 0 ? `<div>GST (${settings.tax_percent ?? 10}%): ${formatCurrency(Number(quote.gst) ?? 0)}</div>` : ''}
      <div class="total">Total: ${formatCurrency(total)}</div>
    </div>

    <div class="deposit">Note: ${depositPercent}% deposit is to be paid upfront. (${formatCurrency(depositAmount)})</div>
    <hr>

    ${
		(bankDetails && (bankDetails as QuoteBankDetails).name) || barcodeImageUrl
			? `
    <div class="bank-qr-row">
      <div class="bank-details">
        ${
					bankDetails && (bankDetails as QuoteBankDetails).name
						? `
        <div class="section-title">Bank Details:</div>
        <div>${escapeHtml((bankDetails as QuoteBankDetails).name)}</div>
        <div>Name: ${escapeHtml((bankDetails as QuoteBankDetails).accountName)}</div>
        <div>BSB: ${escapeHtml((bankDetails as QuoteBankDetails).bsb)}</div>
        <div>Number: ${escapeHtml((bankDetails as QuoteBankDetails).accountNumber)}</div>
        `
						: ''
				}
      </div>
      <div class="qr-block">
        ${
					barcodeImageUrl
						? `
        <div class="section-title">${escapeHtml(barcodeTitle)}:</div>
        <img src="${escapeAttr(barcodeImageUrl)}" alt="QR code" />
        `
						: ''
				}
      </div>
    </div>
    `
			: ''
	}

    <div class="footer">
      <span>Thank you for your interest!</span>
      <span>Generated by ${escapeHtml(company.name)}</span>
    </div>
  </div>
</body>
</html>`;

	return html;
}

/**
 * Compute breakdown and totals from settings + roof size (and optional overrides).
 */
export function computeQuoteFromSettings(
	settings: QuoteSettings,
	roofSize: number,
	overrides?: { lineItems?: { desc: string; price: number; fixed: boolean; total?: number }[] }
): {
	quoteDate: string;
	validUntil: string;
	breakdownTotals: { desc: string; price: number; fixed: boolean; total: number }[];
	subtotal: number;
	gst: number;
	total: number;
} {
	const validDays = Math.max(1, Number(settings.valid_days) ?? 30);
	const now = new Date();
	const quoteDate = now.toISOString().slice(0, 10);
	const validUntil = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

	const lines = overrides?.lineItems ?? settings.line_items ?? [];
	const breakdownTotals: { desc: string; price: number; fixed: boolean; total: number }[] = [];
	let subtotal = 0;
	for (const line of lines) {
		const fixed = !!line.fixed;
		const total = fixed ? (Number(line.total) ?? 0) : (Number(line.price) ?? 0) * roofSize;
		breakdownTotals.push({
			desc: line.desc ?? '',
			price: Number(line.price) ?? 0,
			fixed,
			total
		});
		subtotal += total;
	}
	const taxPercent = Math.max(0, Number(settings.tax_percent) ?? 0);
	const gst = subtotal * (taxPercent / 100);
	const total = subtotal + gst;

	return { quoteDate, validUntil, breakdownTotals, subtotal, gst, total };
}
