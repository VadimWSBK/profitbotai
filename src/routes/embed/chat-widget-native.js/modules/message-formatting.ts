/**
 * Message formatting module - Markdown parsing, table rendering, link formatting
 */
export const messageformatting = String.raw`
  /* ===== 4. MESSAGE FORMATTING (full port of chat-message-format.ts) ===== */
  function splitTablesAndText(message) {
    if (!message || typeof message !== 'string') return [];
    var lines = message.split('\n');
    var parts = [];
    var i = 0;
    function isTableRow(line) { return /^\|.+\|[\s]*$/.test(line.trim()); }
    while (i < lines.length) {
      if (isTableRow(lines[i])) {
        var tableLines = [];
        while (i < lines.length && isTableRow(lines[i])) { tableLines.push(lines[i]); i++; }
        if (tableLines.length >= 2) { parts.push({ type: 'table', content: tableLines.join('\n') }); continue; }
        parts.push({ type: 'text', content: tableLines.join('\n') }); continue;
      }
      var textLines = [];
      while (i < lines.length && !isTableRow(lines[i])) { textLines.push(lines[i]); i++; }
      if (textLines.length) parts.push({ type: 'text', content: textLines.join('\n') });
    }
    return parts;
  }

  function renderTableCell(cell, colIndex, isCheckoutTable, header) {
    var imgRe = /!\[([^\]]*)\]\s*\((https?:\/\/[^)\s]+)\)?/;
    var m = cell.match(imgRe);
    if (m) {
      var alt = escapeHtml(m[1] || '');
      var url = escapeHtml(m[2] || '');
      var rest = cell.replace(imgRe, '').trim();
      var qtyMatch = rest.match(/×\s*(\d+)\s*$/);
      var qty = qtyMatch ? qtyMatch[1] : '';
      var imgHtml = '<img src="' + url + '" alt="' + alt + '" class="pb-table-cell-image" loading="lazy" />';
      if (qty && isCheckoutTable) {
        return '<div class="pb-checkout-img-wrap"><span class="pb-qty-badge">' + escapeHtml(qty) + '</span>' + imgHtml + '</div>';
      }
      return imgHtml + (rest ? ' ' + escapeHtml(rest) : '');
    }
    if (isCheckoutTable && header && header.toLowerCase() === 'product') {
      if (cell.indexOf('||') >= 0) {
        var qtyPriceParts = cell.split(/\s*\|\|\s*/).map(function(p){return p.trim();}).filter(Boolean);
        var mainPart = qtyPriceParts[0] || '';
        var qtyPriceLine = qtyPriceParts[1] || '';
        var mainParts = mainPart.split(/\s*%%\s*/).map(function(p){return p.trim();}).filter(Boolean);
        var title = mainParts[0] || mainPart;
        var variant = mainParts[1] || '';
        var html = '<span class="pb-checkout-product-cell"><strong>' + escapeHtml(title) + '</strong>';
        if (variant) html += '<br /><span class="pb-checkout-variant-line">' + escapeHtml(variant) + '</span>';
        if (qtyPriceLine) html += '<br /><span class="pb-checkout-qty-price-line">' + escapeHtml(qtyPriceLine) + '</span>';
        html += '</span>';
        return html;
      }
      var cellParts = cell.split(/\s*%%\s*/).map(function(p){return p.trim();});
      var cTitle = cellParts[0] || '';
      var cVariant = cellParts[1] || '';
      var unitPrice = cellParts[2] || '';
      var total = cellParts[3] || '';
      var chtml = '<span class="pb-checkout-product-cell"><strong>' + escapeHtml(cTitle) + '</strong>';
      if (cVariant) chtml += '<br /><span class="pb-checkout-variant-line">' + escapeHtml(cVariant) + '</span>';
      if (unitPrice || total) {
        chtml += '<div class="pb-checkout-price-grid">';
        if (unitPrice) chtml += '<div class="pb-checkout-price-block"><div class="pb-checkout-price-label">Unit Price</div><div class="pb-checkout-price-value">' + escapeHtml(unitPrice) + '</div></div>';
        if (total) chtml += '<div class="pb-checkout-price-block"><div class="pb-checkout-price-label">Total</div><div class="pb-checkout-price-value">' + escapeHtml(total) + '</div></div>';
        chtml += '</div>';
      }
      chtml += '</span>';
      return chtml;
    }
    var escaped = escapeHtml(cell);
    return escaped.replace(/\n/g, '<br />');
  }

  function markdownTableToHtml(tableContent) {
    var lines = tableContent.split('\n').filter(function(l){return l.trim();});
    if (lines.length < 2) return escapeHtml(tableContent);
    function parseRow(line) {
      return line.split('|').map(function(c){return c.trim();}).filter(function(_,i,arr){return i > 0 && i < arr.length - 1;});
    }
    var headerCells = parseRow(lines[0]);
    function isSep(line) {
      var cells = parseRow(line);
      return cells.length > 0 && cells.every(function(c){return /^[\s\-:]+$/.test(c);});
    }
    var bodyStart = lines.length > 1 && isSep(lines[1]) ? 2 : 1;
    var isCheckoutTable = headerCells[0] !== undefined && headerCells[0].toLowerCase() === '' && headerCells[1] !== undefined && headerCells[1].toLowerCase() === 'product' && headerCells[2] !== undefined && headerCells[2].toLowerCase() === 'total';
    var isSummaryTable = !isCheckoutTable && headerCells.every(function(c){return !c;});
    var tableClass = isCheckoutTable ? 'pb-table pb-checkout-table' : isSummaryTable ? 'pb-summary-table' : 'pb-table';
    var html = '<table class="' + tableClass + '"><thead' + (isSummaryTable ? ' class="pb-summary-head"' : '') + '><tr>';
    for (var hi = 0; hi < headerCells.length; hi++) html += '<th>' + escapeHtml(headerCells[hi]) + '</th>';
    html += '</tr></thead><tbody>';
    for (var r = bodyStart; r < lines.length; r++) {
      var cells = parseRow(lines[r]);
      if (cells.length === 0) continue;
      html += '<tr>';
      for (var ci = 0; ci < cells.length; ci++) {
        html += '<td>' + renderTableCell(cells[ci], ci, isCheckoutTable, headerCells[ci]) + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  function formatMessageWithLinks(text) {
    if (!text || typeof text !== 'string') return '';
    var parts = [];
    var lastIndex = 0;
    var imageRe = /!\[([^\]]*)\]\s*\((https?:\/\/[^)\s]+)\)?/g;
    var mdLinkRe = /\[([^\]]*)\]\s*\((https?:\/\/[^)\s]+)\)?/g;
    var rawUrlRe = /(https?:\/\/[^\s<>"']+)/g;
    var matches = [];
    var m;
    imageRe.lastIndex = 0;
    while ((m = imageRe.exec(text)) !== null) {
      matches.push({ index: m.index, end: imageRe.lastIndex, type: 'image', alt: m[1]||'', url: m[2] });
    }
    mdLinkRe.lastIndex = 0;
    while ((m = mdLinkRe.exec(text)) !== null) {
      matches.push({ index: m.index, end: mdLinkRe.lastIndex, type: 'markdown', text: m[1]||m[2], url: m[2] });
    }
    rawUrlRe.lastIndex = 0;
    while ((m = rawUrlRe.exec(text)) !== null) {
      var inside = matches.some(function(match) {
        return (match.type === 'markdown' || match.type === 'image') && m.index >= match.index && m.index < match.end;
      });
      if (!inside) matches.push({ index: m.index, end: rawUrlRe.lastIndex, type: 'raw', url: m[1] });
    }
    matches.sort(function(a,b){return a.index - b.index;});
    for (var i = 0; i < matches.length; i++) {
      var match = matches[i];
      parts.push(escapeHtml(text.slice(lastIndex, match.index)));
      var url = match.url;
      if (match.type === 'image') {
        parts.push('<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(match.alt) + '" class="pb-msg-image" loading="lazy" />');
      } else {
        var displayText = match.type === 'markdown' ? match.text : url;
        var isCta = /buy\s*now|complete\s*your\s*purchase|go\s*to\s*checkout/i.test(displayText);
        var linkClass = isCta ? 'pb-msg-link pb-cta-button' : 'pb-msg-link pb-underline';
        parts.push('<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" class="' + linkClass + '">' + escapeHtml(displayText) + '</a>');
      }
      lastIndex = match.end;
    }
    parts.push(escapeHtml(text.slice(lastIndex)));
    return parts.join('').replace(/\n/g, '<br />');
  }

  function formatMessage(content) {
    if (!content || typeof content !== 'string') return '';
    var parts = splitTablesAndText(content);
    return parts.map(function(p) {
      return p.type === 'table' ? '<div class="pb-table-wrapper">' + markdownTableToHtml(p.content) + '</div>' : formatMessageWithLinks(p.content);
    }).join('');
  }

  function stripCheckoutBlock(content, checkoutUrl) {
    if (!content) return content;
    var cleaned = content;
    if (checkoutUrl) {
      var escapedUrl = checkoutUrl.replace(/[.*+?^$\x7b\x7d()|[\]\\]/g, '\\$&');
      cleaned = cleaned.replace(new RegExp(escapedUrl, 'gi'), '').trim();
    }
    var start = cleaned.search(/\*\*[^*]*Your [Cc]heckout [Pp]review\*\*/i);
    if (start < 0) {
      cleaned = cleaned.replace(/(https?:\/\/[^\s<>"']*(?:cart|checkout|invoice|myshopify\.com\/cart)[^\s<>"']*)/gi, '').trim();
      return cleaned;
    }
    var before = cleaned.slice(0, start).replace(/\n+$/, '');
    var afterStart = cleaned.slice(start);
    var linkMatch = afterStart.match(/\[GO TO CHECKOUT\]\s*\([^)]+\)/i) || afterStart.match(/\[Buy now[^\]]*\]\s*\([^)]+\)/i);
    if (linkMatch) {
      var rest = afterStart.slice(linkMatch.index + linkMatch[0].length).replace(/^\s*\n?/, '');
      rest = rest.replace(/(https?:\/\/[^\s<>"']*(?:cart|checkout|invoice|myshopify\.com\/cart)[^\s<>"']*)/gi, '').trim();
      return (before + (rest ? '\n\n' + rest : '')).trim();
    }
    return before.replace(/(https?:\/\/[^\s<>"']*(?:cart|checkout|invoice|myshopify\.com\/cart)[^\s<>"']*)/gi, '').trim() || cleaned;
  }

  function formatTimestamp(createdAt) {
    if (!createdAt) return '';
    try {
      var date = new Date(createdAt);
      if (isNaN(date.getTime())) return '';
      var now = new Date();
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      var diff = Math.floor((today.getTime() - msgDate.getTime()) / 86400000);
      var t = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      if (diff === 0) return t;
      if (diff === 1) return 'Yesterday ' + t;
      if (diff < 7) return date.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + t;
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (e) { return ''; }
  }
`;
