/**
 * Shared message formatting for chat widget and messages menu:
 * markdown tables (including checkout preview), links, images, line breaks.
 */

function escapeHtml(s: string): string {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Split message into table blocks and text blocks. Tables are consecutive lines that look like markdown table rows (| ... |). */
export function splitTablesAndText(message: string): Array<{ type: 'table' | 'text'; content: string }> {
	if (!message || typeof message !== 'string') return [];
	const lines = message.split('\n');
	const parts: Array<{ type: 'table' | 'text'; content: string }> = [];
	let i = 0;
	const isTableRow = (line: string) => /^\|.+\|[\s]*$/.test(line.trim());
	while (i < lines.length) {
		if (isTableRow(lines[i])) {
			const tableLines: string[] = [];
			while (i < lines.length && isTableRow(lines[i])) {
				tableLines.push(lines[i]);
				i++;
			}
			if (tableLines.length >= 2) {
				parts.push({ type: 'table', content: tableLines.join('\n') });
				continue;
			}
			parts.push({ type: 'text', content: tableLines.join('\n') });
			continue;
		}
		const textLines: string[] = [];
		while (i < lines.length && !isTableRow(lines[i])) {
			textLines.push(lines[i]);
			i++;
		}
		if (textLines.length) parts.push({ type: 'text', content: textLines.join('\n') });
	}
	return parts;
}

/** Render cell content: images (with optional qty badge), product lines, escape rest. */
function renderTableCell(
	cell: string,
	escape: (s: string) => string,
	opts: { colIndex: number; isCheckoutTable: boolean; header?: string }
): string {
	const imgRe = /!\[([^\]]*)\]\s*\((https?:\/\/[^)\s]+)\)?/;
	const m = cell.match(imgRe);
	if (m) {
		const alt = escape(m[1] || '');
		const url = escape(m[2] || '');
		const rest = cell.replace(imgRe, '').trim();
		const qtyMatch = rest.match(/×\s*(\d+)\s*$/);
		const qty = qtyMatch ? qtyMatch[1] : '';
		const imgHtml = `<img src="${url}" alt="${alt}" class="chat-table-cell-image" loading="lazy" />`;
		if (qty && opts.isCheckoutTable) {
			return `<div class="checkout-img-wrap"><span class="qty-badge">${escape(qty)}</span>${imgHtml}</div>`;
		}
		return imgHtml + (rest ? ` ${escape(rest)}` : '');
	}
	const escaped = escape(cell);
	if (opts.isCheckoutTable && opts.header?.toLowerCase() === 'product') {
		const qtyPriceParts = cell.split(/\s*\|\|\s*/).map((p) => p.trim()).filter(Boolean);
		const mainPart = qtyPriceParts[0] ?? '';
		const qtyPriceLine = qtyPriceParts[1] ?? '';
		const mainParts = mainPart.split(/\s*%%\s*/).map((p) => p.trim()).filter(Boolean);
		const title = mainParts[0] ?? mainPart;
		const variant = mainParts[1] ?? '';
		let html = `<span class="checkout-product-cell"><strong>${escape(title)}</strong>`;
		if (variant) html += `<br /><span class="checkout-variant-line">${escape(variant)}</span>`;
		if (qtyPriceLine) html += `<br /><span class="checkout-qty-price-line">${escape(qtyPriceLine)}</span>`;
		html += '</span>';
		return html;
	}
	const withBr = escaped.replace(/\n/g, '<br />');
	if (opts.isCheckoutTable && opts.header?.toLowerCase() === 'total') {
		return `<span class="checkout-total-cell">${withBr}</span>`;
	}
	return withBr;
}

/** Convert a markdown table string to HTML. Escapes cell content; renders images in cells. */
export function markdownTableToHtml(tableContent: string): string {
	const lines = tableContent.split('\n').filter((l) => l.trim());
	if (lines.length < 2) return escapeHtml(tableContent);
	const parseRow = (line: string) =>
		line
			.split('|')
			.map((c) => c.trim())
			.filter((_, i, arr) => i > 0 && i < arr.length - 1);
	const headerCells = parseRow(lines[0]);
	const isSep = (line: string) => {
		const cells = parseRow(line);
		return cells.length > 0 && cells.every((c) => /^[\s\-:]+$/.test(c));
	};
	const bodyStart = lines.length > 1 && isSep(lines[1]) ? 2 : 1;
	const isCheckoutTable =
		headerCells[0]?.toLowerCase() === '' &&
		headerCells[1]?.toLowerCase() === 'product' &&
		headerCells[2]?.toLowerCase() === 'total';
	const tableClass = isCheckoutTable ? 'chat-message-table chat-checkout-table' : 'chat-message-table';
	let html = `<table class="${tableClass}"><thead><tr>`;
	for (const c of headerCells) html += `<th>${escapeHtml(c)}</th>`;
	html += '</tr></thead><tbody>';
	for (let r = bodyStart; r < lines.length; r++) {
		const cells = parseRow(lines[r]);
		if (cells.length === 0) continue;
		html += '<tr>';
		for (let i = 0; i < cells.length; i++) {
			const tdClass = isCheckoutTable && i === cells.length - 1 ? 'chat-checkout-total-td' : '';
			html += `<td${tdClass ? ` class="${tdClass}"` : ''}>${renderTableCell(cells[i], escapeHtml, { colIndex: i, isCheckoutTable, header: headerCells[i] })}</td>`;
		}
		html += '</tr>';
	}
	html += '</tbody></table>';
	return html;
}

type LinkMatch =
	| { index: number; end: number; type: 'markdown'; text: string; url: string }
	| { index: number; end: number; type: 'image'; alt: string; url: string }
	| { index: number; end: number; type: 'raw'; url: string };

/** Convert markdown links [text](url), image syntax ![alt](url) and raw URLs to clickable links/media. Escapes plain text for safety. */
export function formatMessageWithLinks(text: string): string {
	if (!text || typeof text !== 'string') return '';
	const parts: string[] = [];
	let lastIndex = 0;
	const imageRe = /!\[([^\]]*)\]\s*\((https?:\/\/[^)\s]+)\)?/g;
	const markdownLinkRe = /\[([^\]]*)\]\s*\((https?:\/\/[^)\s]+)\)?/g;
	const rawUrlRe = /(https?:\/\/[^\s<>"']+)/g;
	const matches: LinkMatch[] = [];
	let m: RegExpExecArray | null;
	imageRe.lastIndex = 0;
	while ((m = imageRe.exec(text)) !== null) {
		matches.push({
			index: m.index,
			end: imageRe.lastIndex,
			type: 'image',
			alt: m[1] || '',
			url: m[2]
		});
	}
	markdownLinkRe.lastIndex = 0;
	while ((m = markdownLinkRe.exec(text)) !== null) {
		matches.push({
			index: m.index,
			end: markdownLinkRe.lastIndex,
			type: 'markdown',
			text: m[1] || m[2],
			url: m[2]
		});
	}
	rawUrlRe.lastIndex = 0;
	while ((m = rawUrlRe.exec(text)) !== null) {
		const insideMarkdown = matches.some(
			(match) =>
				(match.type === 'markdown' || match.type === 'image') &&
				m!.index >= match.index &&
				m!.index < match.end
		);
		if (!insideMarkdown) {
			matches.push({ index: m.index, end: rawUrlRe.lastIndex, type: 'raw', url: m[1] });
		}
	}
	matches.sort((a, b) => a.index - b.index);
	for (const match of matches) {
		parts.push(escapeHtml(text.slice(lastIndex, match.index)));
		const url = match.url;
		if (match.type === 'image') {
			parts.push(
				`<img src="${escapeHtml(url)}" alt="${escapeHtml(match.alt)}" class="chat-message-image max-w-full h-auto rounded-md" />`
			);
		} else {
			const displayText = match.type === 'markdown' ? match.text : url;
			const isCtaButton = /buy\s*now|complete\s*your\s*purchase/i.test(displayText);
			const linkClass = isCtaButton ? 'chat-message-link chat-cta-button' : 'chat-message-link underline';
			parts.push(
				`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="${linkClass}">${escapeHtml(displayText)}</a>`
			);
		}
		lastIndex = match.end;
	}
	parts.push(escapeHtml(text.slice(lastIndex)));
	return parts.join('').replace(/\n/g, '<br />');
}

/** Format full message: tables as HTML tables (wrapped in scrollable div), rest as links/images/line breaks. */
export function formatMessage(content: string): string {
	const parts = splitTablesAndText(content);
	return parts
		.map((p) =>
			p.type === 'table'
				? `<div class="chat-table-wrapper">${markdownTableToHtml(p.content)}</div>`
				: formatMessageWithLinks(p.content)
		)
		.join('');
}
