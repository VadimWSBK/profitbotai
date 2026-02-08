/**
 * Native embed script - fully functional widget without iframe
 * Uses scoped CSS (data-profitbot-id attribute) for CSS isolation instead of Shadow DOM.
 * Includes: chat, messages, polling, streaming with character buffer,
 * checkout previews, tooltips, avatars, copy-to-clipboard, scroll FAB,
 * reduced-motion support, mobile full-screen with safe areas, etc.
 */
const EMBED_SCRIPT = String.raw`
(function() {
  'use strict';

  /* ===== 1. BOOTSTRAP ===== */
  // Support both synchronous (document.currentScript) and deferred (find by data-widget-id) loading
  var script = document.currentScript;
  if (!script) {
    // Script loaded with defer/async - find it by data-widget-id attribute
    var scripts = document.querySelectorAll('script[data-widget-id]');
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      var srcAttr = s.getAttribute('src') || '';
      if (srcAttr.indexOf('/embed/chat-widget-native.js') >= 0) {
        script = s;
        break;
      }
    }
    // If still not found, try finding any script with the native.js path
    if (!script) {
      var allScripts = document.querySelectorAll('script[src*="chat-widget-native.js"]');
      if (allScripts.length > 0) {
        script = allScripts[allScripts.length - 1]; // Use the last one if multiple
      }
    }
  }
  if (!script) {
    console.error('[ProfitBot] Could not find script tag. Ensure the script tag includes data-widget-id attribute.');
    return;
  }
  var widgetId = script.getAttribute('data-widget-id');
  if (!widgetId || widgetId === 'YOUR_WIDGET_ID') {
    console.error('[ProfitBot] Missing or invalid data-widget-id. Found:', widgetId);
    return;
  }
  var src = script.getAttribute('src') || '';
  var base = src.replace(/\/embed\/chat-widget-native\.js.*$/, '');
  if (!base) {
    console.error('[ProfitBot] Could not determine base URL from script src:', src);
    return;
  }
  console.log('[ProfitBot] Initializing widget:', widgetId, 'Base URL:', base);
  // Prevent duplicate initialization
  if (!window.__profitbot_widget_loaded) window.__profitbot_widget_loaded = {};
  if (window.__profitbot_widget_loaded[widgetId]) {
    console.warn('[ProfitBot] Widget already loaded:', widgetId);
    return;
  }
  window.__profitbot_widget_loaded[widgetId] = true;

  /* ===== 2. UTILITIES ===== */
  var prefersReducedMotion = false;
  try {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion = mq.matches;
    mq.addEventListener('change', function(e) { prefersReducedMotion = e.matches; });
  } catch (e) {}

  function dur(ms) { return prefersReducedMotion ? 0 : ms; }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var key in attrs) {
        if (!attrs.hasOwnProperty(key)) continue;
        var val = attrs[key];
        if (key === 'style' && typeof val === 'object') {
          for (var sk in val) { if (val.hasOwnProperty(sk)) node.style[sk] = val[sk]; }
        } else if (key === 'className') {
          node.className = val;
        } else if (key.indexOf('on') === 0 && typeof val === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), val);
        } else if (key === 'innerHTML') {
          node.innerHTML = val;
        } else if (key === 'textContent') {
          node.textContent = val;
        } else {
          node.setAttribute(key, val);
        }
      }
    }
    if (children) {
      var arr = Array.isArray(children) ? children : [children];
      for (var i = 0; i < arr.length; i++) {
        var c = arr[i];
        if (typeof c === 'string') node.appendChild(document.createTextNode(c));
        else if (c) node.appendChild(c);
      }
    }
    return node;
  }

  function svgEl(viewBox, pathD, size, color) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('width', size || '16');
    svg.setAttribute('height', size || '16');
    svg.style.fill = 'none';
    svg.style.stroke = color || 'currentColor';
    svg.style.pointerEvents = 'none';
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '2');
    svg.appendChild(path);
    return svg;
  }

  function svgFilled(viewBox, pathD, size, color) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('width', size || '50%');
    svg.setAttribute('height', size || '50%');
    svg.style.fill = color || 'currentColor';
    svg.style.pointerEvents = 'none';
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    svg.appendChild(path);
    return svg;
  }

  function throttle(fn, ms) {
    var last = 0;
    return function() {
      var now = Date.now();
      if (now - last >= ms) { last = now; fn.apply(null, arguments); }
    };
  }

  /* ===== 3. SESSION ===== */
  function getSessionId() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('session_id');
    if (fromUrl) return fromUrl.trim();
    var key = 'profitbot_session_' + widgetId;
    try {
      var stored = localStorage.getItem(key);
      if (stored && stored.trim()) return stored.trim();
    } catch (e) {}
    var newId = 'visitor_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);
    try { localStorage.setItem(key, newId); } catch (e) {}
    return newId;
  }

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

  /* ===== 5. CSS GENERATOR ===== */
  function getWidgetCSS(config, scopeId) {
    // Scope all selectors to the widget container to avoid conflicts
    var scope = scopeId ? '[data-profitbot-id="' + scopeId + '"]' : '';
    var scopeSelector = function(selector) {
      // Handle :host and other special selectors
      if (selector.indexOf(':host') >= 0) {
        return selector.replace(':host', scope || ':host');
      }
      // Scope regular selectors
      if (selector.indexOf('.') === 0 || selector.indexOf('#') === 0) {
        return scope + ' ' + selector;
      }
      return selector;
    };
    var b = config.bubble || {};
    var w = config.window || {};
    var t = config.tooltip || {};
    var bot = w.botMessageSettings || {};
    var bubbleBg = b.backgroundColor || '#3b82f6';
    var winBg = w.backgroundColor || '#ffffff';
    var botBg = bot.backgroundColor || '#f3f4f6';
    var botText = bot.textColor || '#111827';
    var fontSize = w.fontSizePx || 14;
    var msgRadius = w.messageBorderRadius || 12;
    var winRadius = w.borderRadiusStyle === 'rounded' ? '12px' : '0';
    var headerRadius = w.borderRadiusStyle === 'rounded' ? '12px 12px 0 0' : '0';
    var bubbleSize = b.bubbleSizePx || 60;
    var bubbleRight = b.rightPositionPx || 20;
    var bubbleBottom = b.bottomPositionPx || 20;
    var bubbleRadius = b.borderRadiusStyle === 'circle' ? '50%' : b.borderRadiusStyle === 'rounded' ? '16px' : '0';
    var starterBg = w.starterPromptBackgroundColor || '#f9fafb';
    var starterText = w.starterPromptTextColor || '#374151';
    var starterBorder = w.starterPromptBorderColor || '#d1d5db';
    var starterFontSize = Math.max(11, (w.starterPromptFontSizePx || 14) - 3);
    var borderColor = w.sectionBorderColor || '#e5e7eb';
    var inputBorder = w.inputBorderColor || '#d1d5db';
    var inputBg = w.inputBackgroundColor || '#ffffff';
    var inputText = w.inputTextColor || '#111827';
    var inputPh = w.inputPlaceholderColor || '#9ca3af';
    var sendBg = w.sendButtonBackgroundColor || '#3b82f6';
    var sendIcon = w.sendButtonIconColor || '#ffffff';
    var headerBg = w.headerBackgroundColor || '#f3f4f6';
    var headerText = w.headerTextColor || '#111827';
    var headerIcon = w.headerIconColor || '#374151';
    var footerBg = w.footerBackgroundColor || winBg;
    var footerText = w.footerTextColor || '#6b7280';
    var avatarSize = w.avatarSize || 40;
    var avatarRadius = w.avatarBorderRadius || 25;

    // Scope all selectors to the widget container
    var scope = scopeId ? '[data-profitbot-id="' + scopeId + '"]' : '';
    
    function scopeSelector(sel) {
      if (!scope) return sel;
      // Don't scope keyframes, media queries, or global resets
      if (sel.indexOf('@') === 0 || sel.indexOf('*') === 0) return sel;
      // Scope class and ID selectors
      return scope + ' ' + sel;
    }
    
    return [
      /* Reset & wrapper - scoped to widget */
      scope + ' *, ' + scope + ' *::before, ' + scope + ' *::after { box-sizing: border-box; margin: 0; padding: 0; }',
      scope + ' { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: ' + fontSize + 'px; line-height: 1.5; color: #111827; }',
      scopeSelector('.pb-wrapper') + ' { position: fixed; z-index: 2147483647; right: ' + bubbleRight + 'px; bottom: ' + bubbleBottom + 'px; display: flex; flex-direction: column; align-items: flex-end; pointer-events: none; }',

      /* Bubble */
      scopeSelector('.pb-bubble') + ' { pointer-events: auto; width: ' + bubbleSize + 'px; height: ' + bubbleSize + 'px; background-color: ' + bubbleBg + '; border-radius: ' + bubbleRadius + '; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(0,0,0,0.25), 0 4px 8px rgba(0,0,0,0.15); transition: transform 0.2s ease-out, box-shadow 0.2s ease-out; position: relative; z-index: 20; flex-shrink: 0; outline: none; }',
      scopeSelector('.pb-bubble:hover') + ' { transform: scale(1.05); box-shadow: 0 12px 32px rgba(0,0,0,0.3), 0 6px 12px rgba(0,0,0,0.2); }',
      scopeSelector('.pb-bubble.pb-open') + ' { transform: scale(0.95); }',
      scopeSelector('.pb-bubble-pulse') + ' { animation: pb-pulse 2s ease-in-out 3; }',
      '@keyframes pb-pulse { 0%,100% { box-shadow: 0 8px 24px rgba(0,0,0,0.25), 0 4px 8px rgba(0,0,0,0.15), 0 0 0 0 rgba(0,0,0,0.15); } 50% { box-shadow: 0 8px 24px rgba(0,0,0,0.25), 0 4px 8px rgba(0,0,0,0.15), 0 0 0 8px rgba(0,0,0,0); } }',

      /* Tooltip */
      scopeSelector('.pb-tooltip') + ' { pointer-events: auto; position: absolute; bottom: ' + (bubbleSize + 12) + 'px; right: ' + (bubbleSize + 12) + 'px; background-color: ' + (t.backgroundColor || '#ffffff') + '; color: ' + (t.textColor || '#111827') + '; font-size: ' + (t.fontSizePx || 14) + 'px; padding: 12px 16px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-width: 220px; cursor: pointer; z-index: 19; white-space: normal; animation: pb-fade-in 0.2s ease-out; }',
      scopeSelector('.pb-tooltip-hidden') + ' { opacity: 0; pointer-events: none; transition: opacity 0.3s; }',

      /* Chat window */
      scopeSelector('.pb-window') + ' { pointer-events: auto; position: absolute; bottom: ' + (bubbleSize + 12) + 'px; right: 0; width: ' + (w.widthPx || 400) + 'px; height: ' + (w.heightPx || 600) + 'px; max-height: calc(100vh - ' + (bubbleSize + bubbleBottom + 32) + 'px); background-color: ' + winBg + '; border-radius: ' + winRadius + '; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); display: flex; flex-direction: column; overflow: hidden; z-index: 18; animation: pb-window-in ' + dur(250) + 'ms cubic-bezier(0.33,1,0.68,1) both; }',
      scopeSelector('.pb-window.pb-closing') + ' { animation: pb-window-out ' + dur(180) + 'ms cubic-bezier(0.33,1,0.68,1) both; }',
      '@keyframes pb-window-in { from { opacity: 0; transform: translateY(12px) scale(0.95); transform-origin: bottom right; } to { opacity: 1; transform: translateY(0) scale(1); } }',
      '@keyframes pb-window-out { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(8px) scale(0.96); } }',

      /* Header */
      '.pb-header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background-color: ' + headerBg + '; color: ' + headerText + '; border-radius: ' + headerRadius + '; flex-shrink: 0; }',
      '.pb-header-avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: contain; }',
      '.pb-header-title { flex: 1; font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.pb-header-btn { background: none; border: none; padding: 6px; border-radius: 4px; cursor: pointer; color: ' + headerIcon + '; display: flex; align-items: center; justify-content: center; transition: opacity 0.15s; outline: none; }',
      '.pb-header-btn:hover { opacity: 0.7; }',
      '.pb-header-btn:disabled { opacity: 0.4; cursor: default; }',
      '.pb-spin { animation: pb-spin 1s linear infinite; }',
      '@keyframes pb-spin { to { transform: rotate(360deg); } }',

      /* Messages area */
      '.pb-messages { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow-anchor: none; scroll-behavior: smooth; position: relative; }',
      '.pb-messages::-webkit-scrollbar { width: 6px; }',
      '.pb-messages::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }',
      w.showScrollbar === false ? '.pb-messages { scrollbar-width: none; -ms-overflow-style: none; } .pb-messages::-webkit-scrollbar { display: none; }' : '.pb-messages { scrollbar-width: thin; scrollbar-color: #d1d5db transparent; }',

      /* Message rows */
      '.pb-msg-row { display: flex; gap: 8px; align-items: flex-start; animation: pb-fly-left ' + dur(280) + 'ms cubic-bezier(0.33,1,0.68,1) both; }',
      '.pb-msg-row-user { justify-content: flex-end; animation-name: pb-fly-right; }',
      '.pb-msg-row.pb-no-anim, .pb-msg-row-user.pb-no-anim { animation: none; }',
      '@keyframes pb-fly-left { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: translateX(0); } }',
      '@keyframes pb-fly-right { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }',

      /* Bubbles */
      '.pb-msg { padding: 12px 16px; border-radius: ' + msgRadius + 'px; max-width: 85%; word-wrap: break-word; overflow-wrap: break-word; position: relative; }',
      '.pb-msg-bot { background-color: ' + botBg + '; color: ' + botText + '; align-self: flex-start; }',
      '.pb-msg-user { background-color: ' + bubbleBg + '; color: ' + (b.colorOfInternalIcons || '#ffffff') + '; align-self: flex-end; }',
      '.pb-msg-content { min-width: 0; overflow-x: auto; overflow-y: visible; max-width: 100%; }',

      /* Avatar */
      '.pb-avatar { width: ' + avatarSize + 'px; height: ' + avatarSize + 'px; border-radius: ' + avatarRadius + 'px; object-fit: contain; flex-shrink: 0; }',
      '.pb-avatar-placeholder { width: ' + avatarSize + 'px; height: ' + avatarSize + 'px; border-radius: ' + avatarRadius + 'px; background-color: ' + botBg + '; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }',

      /* Timestamps */
      '.pb-timestamp { font-size: 0.7rem; opacity: 0.6; margin-top: 4px; padding: 0 4px; user-select: none; line-height: 1.2; }',

      /* Copy button */
      '.pb-copy-btn { position: absolute; top: 8px; right: 8px; background: none; border: none; cursor: pointer; opacity: 0; transition: opacity 0.2s; padding: 2px; border-radius: 4px; color: inherit; display: flex; align-items: center; justify-content: center; }',
      '.pb-msg:hover .pb-copy-btn { opacity: 0.6; }',
      '.pb-copy-btn:hover { opacity: 1 !important; }',

      /* Typing indicator */
      '.pb-typing { display: flex; gap: 4px; align-items: center; padding: 12px 16px; }',
      '.pb-typing-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.4; animation: pb-dot-bounce 1.4s ease-in-out infinite both; }',
      '.pb-typing-dot:nth-child(2) { animation-delay: 0.2s; }',
      '.pb-typing-dot:nth-child(3) { animation-delay: 0.4s; }',
      '@keyframes pb-dot-bounce { 0%,80%,100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }',

      /* Streaming cursor */
      '.pb-streaming-cursor { display: inline; animation: pb-blink 530ms steps(1) infinite; font-weight: 100; margin-left: 1px; }',
      '@keyframes pb-blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }',

      /* Scroll-to-bottom FAB */
      '.pb-scroll-fab { position: sticky; bottom: 8px; align-self: flex-end; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.15); color: ' + botText + '; border: none; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.2); transition: opacity 0.2s, background 0.2s; animation: pb-fade-in 0.2s ease-out; pointer-events: auto; }',
      '.pb-scroll-fab:hover { background: rgba(0,0,0,0.25); }',

      /* Starter prompts */
      '.pb-starters { padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px solid ' + borderColor + '; flex-shrink: 0; background-color: ' + winBg + '; }',
      '.pb-starter-btn { padding: 6px 12px; border: 1px solid ' + starterBorder + '; border-radius: 6px; background: ' + starterBg + '; color: ' + starterText + '; font-size: ' + starterFontSize + 'px; cursor: pointer; transition: all 0.2s; outline: none; }',
      '.pb-starter-btn:hover { transform: scale(1.02); opacity: 0.9; }',

      /* Input area */
      '.pb-input-area { padding: 12px 16px; border-top: 1px solid ' + borderColor + '; display: flex; gap: 8px; flex-shrink: 0; background-color: ' + winBg + '; }',
      '.pb-input { flex: 1; padding: 8px 12px; border: 1px solid ' + inputBorder + '; border-radius: 8px; outline: none; font-size: ' + fontSize + 'px; background-color: ' + inputBg + '; color: ' + inputText + '; font-family: inherit; transition: border-color 0.15s, box-shadow 0.15s; }',
      '.pb-input:focus { border-color: ' + sendBg + '; box-shadow: 0 0 0 2px ' + sendBg + '33; }',
      '.pb-input::placeholder { color: ' + inputPh + '; }',
      '.pb-send-btn { width: 40px; height: 40px; border-radius: 50%; background-color: ' + sendBg + '; color: ' + sendIcon + '; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: transform 0.15s ease-out, opacity 0.15s; outline: none; }',
      '.pb-send-btn:active { transform: scale(0.92); }',
      '.pb-send-btn:disabled { opacity: 0.5; cursor: default; }',
      '.pb-send-pulse { transform: scale(0.88); }',

      /* Footer */
      '.pb-footer { padding: 8px 16px; text-align: center; font-size: 11px; color: ' + footerText + '; background-color: ' + footerBg + '; border-top: 1px solid ' + borderColor + '; flex-shrink: 0; }',

      /* Links */
      '.pb-msg-link { color: inherit; text-decoration: underline; word-break: normal; overflow-wrap: break-word; }',
      '.pb-msg-link:hover { opacity: 0.9; }',
      '.pb-underline { text-decoration: underline; }',
      '.pb-cta-button { display: inline-block; text-decoration: none; padding: 0.5em 1em; margin-top: 0.5em; border-radius: 8px; font-weight: 600; background-color: rgba(255,255,255,0.25); border: 1px solid rgba(255,255,255,0.4); transition: background-color 0.15s, border-color 0.15s; }',
      '.pb-cta-button:hover { background-color: rgba(255,255,255,0.35); border-color: rgba(255,255,255,0.6); }',

      /* Images in messages */
      '.pb-msg-image { max-width: 100%; height: auto; border-radius: 8px; margin: 4px 0; }',

      /* Tables */
      '.pb-table-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 0.5em 0; max-width: 100%; }',
      '.pb-table { border-collapse: collapse; font-size: 0.95em; width: max-content; min-width: 100%; }',
      '.pb-table th, .pb-table td { border: 1px solid currentColor; opacity: 0.9; padding: 0.4em 0.6em; text-align: left; }',
      '.pb-table th { font-weight: 600; opacity: 1; }',
      '.pb-summary-table { border-collapse: collapse; width: 100%; margin-top: 0.25rem; font-size: 0.95em; }',
      '.pb-summary-head { display: none; }',
      '.pb-summary-table td { border: none; padding: 0.25em 0; }',
      '.pb-summary-table tr + tr td { border-top: 1px solid rgba(255,255,255,0.16); }',
      '.pb-summary-table td:first-child { font-weight: 600; padding-right: 1.5em; white-space: nowrap; }',
      '.pb-summary-table td:last-child { text-align: right; font-weight: 600; white-space: nowrap; }',

      /* Checkout table cells */
      '.pb-checkout-table { border: none; width: 100%; }',
      '.pb-checkout-table thead th { border: none; background: transparent; font-weight: 500; font-size: 0.9em; opacity: 0.8; padding-bottom: 0.5em; }',
      '.pb-checkout-table td { border: none; border-bottom: 1px solid rgba(255,255,255,0.12); background: transparent; padding: 0.75em 0; vertical-align: top; }',
      '.pb-checkout-table th:first-child, .pb-checkout-table td:first-child { width: 1%; white-space: nowrap; vertical-align: top; padding-right: 1em; }',
      '.pb-checkout-table th:last-child, .pb-checkout-table td:last-child { display: none; }',
      '.pb-checkout-img-wrap { position: relative; display: inline-block; width: 64px; height: 64px; flex-shrink: 0; overflow: hidden; border-radius: 6px; }',
      '.pb-table-cell-image { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 6px; }',
      '.pb-qty-badge { position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,0.75); color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; line-height: 1.2; z-index: 1; }',
      '.pb-checkout-product-cell { display: block; font-size: 0.95em; }',
      '.pb-checkout-variant-line { display: block; margin-top: 0.2em; font-size: 0.85em; opacity: 0.85; font-weight: 400; }',
      '.pb-checkout-qty-price-line { display: block; margin-top: 0.2em; font-size: 0.85em; opacity: 0.9; font-weight: 400; }',
      '.pb-checkout-price-grid { display: flex; gap: 1.5em; margin-top: 0.5em; }',
      '.pb-checkout-price-block { display: flex; flex-direction: column; font-size: 0.85em; }',
      '.pb-checkout-price-label { opacity: 0.85; }',
      '.pb-checkout-price-value { margin-top: 0.1em; font-weight: 600; }',

      /* Structured checkout preview (from checkoutPreview data) */
      '.pb-checkout-preview { margin-top: 12px; }',
      '.pb-checkout-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.15); }',
      '.pb-checkout-header h3 { font-size: 18px; font-weight: 700; margin: 0; color: #22c55e; }',
      '.pb-line-item { display: flex; gap: 16px; margin-bottom: 28px; }',
      '.pb-image-wrap { position: relative; width: 80px; height: 80px; border-radius: 8px; background: rgba(255,255,255,0.1); overflow: hidden; flex-shrink: 0; }',
      '.pb-image-wrap img { width: 100%; height: 100%; object-fit: cover; }',
      '.pb-image-wrap .pb-qty-badge { top: -8px; right: -8px; background: #374151; font-size: 13px; font-weight: 700; padding: 6px 10px; border-radius: 6px; min-width: 28px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }',
      '.pb-product-name { font-weight: 700; font-size: 16px; margin-bottom: 4px; color: #22c55e; }',
      '.pb-product-variant { font-size: 14px; opacity: 0.85; margin-bottom: 10px; }',
      '.pb-price-row { display: flex; gap: 40px; margin-top: 6px; }',
      '.pb-price-col { display: flex; flex-direction: column; gap: 4px; }',
      '.pb-price-label { font-size: 12px; opacity: 0.7; font-weight: 500; }',
      '.pb-price-value { font-size: 16px; font-weight: 700; }',
      '.pb-checkout-summary { margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.2); }',
      '.pb-summary-row { display: flex; justify-content: space-between; padding: 4px 0; }',
      '.pb-summary-total { margin-top: 8px; font-size: 1.05em; }',
      '.pb-summary-footer { font-size: 0.85em; opacity: 0.8; margin-top: 8px; }',
      '.pb-checkout-cta { display: inline-block; margin-top: 16px; padding: 12px 24px; background: rgba(255,255,255,0.25); border: 1px solid rgba(255,255,255,0.4); border-radius: 8px; font-weight: 600; text-decoration: none; color: inherit; transition: all 0.15s; }',
      '.pb-checkout-cta:hover { background: rgba(255,255,255,0.35); border-color: rgba(255,255,255,0.6); }',

      /* Backdrop for mobile */
      '.pb-backdrop { display: none; }',

      /* Loading spinner */
      '.pb-loader { display: flex; align-items: center; justify-content: center; min-height: 120px; }',
      '.pb-loader svg { animation: pb-spin 1s linear infinite; color: #9ca3af; }',

      /* Generic animations */
      '@keyframes pb-fade-in { from { opacity: 0; } to { opacity: 1; } }',
      '@keyframes pb-fade-out { from { opacity: 1; } to { opacity: 0; } }',

      /* Mobile full-screen */
      '@media (max-width: 768px) {',
      '  ' + scopeSelector('.pb-wrapper') + ' { right: ' + bubbleRight + 'px; bottom: ' + bubbleBottom + 'px; }',
      '  ' + scopeSelector('.pb-window') + ' { position: fixed !important; inset: 0 !important; width: 100% !important; height: 100% !important; max-height: 100dvh !important; border-radius: 0 !important; padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); padding-top: env(safe-area-inset-top); }',
      '  ' + scopeSelector('.pb-header') + ' { border-radius: 0 !important; }',
      '  ' + scopeSelector('.pb-input-area') + ' { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }',
      '  ' + scopeSelector('.pb-bubble.pb-open') + ' { display: none !important; }',
      '  ' + scopeSelector('.pb-backdrop') + ' { display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.3); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); z-index: 17; pointer-events: auto; animation: pb-fade-in 0.2s ease-out; }',
      '  ' + scopeSelector('.pb-tooltip') + ' { display: none !important; }',
      '}',

      /* Desktop hide tooltip on mobile */
      t.hideTooltipOnMobile ? '@media (max-width: 768px) { ' + scopeSelector('.pb-tooltip') + ' { display: none !important; } }' : '',

      /* Reduced motion */
      '@media (prefers-reduced-motion: reduce) {',
      '  .pb-bubble-pulse, .pb-typing-dot, .pb-streaming-cursor { animation: none !important; }',
      '  .pb-bubble, .pb-send-btn, .pb-starter-btn, .pb-msg-row, .pb-msg-row-user { animation: none !important; transition-duration: 0.01ms !important; }',
      '  .pb-window { animation-duration: 0.01ms !important; }',
      '}'
    ];
    
    // Scope all CSS rules that aren't already scoped (keyframes, media queries, etc.)
    return cssArray.map(function(rule) {
      // Don't modify keyframes, media queries, or already-scoped rules
      if (rule.indexOf('@') === 0 || rule.indexOf(scope) === 0 || !scope) {
        return rule;
      }
      // Scope class selectors that start with .pb-
      if (rule.indexOf('.pb-') >= 0) {
        // Extract the selector part (before {)
        var parts = rule.split('{');
        if (parts.length === 2) {
          var selector = parts[0].trim();
          var styles = parts[1];
          // Scope the selector
          return scopeSelector(selector) + ' {' + styles;
        }
      }
      return rule;
    }).join('\n');
  }

  /* ===== 6. COMPONENT BUILDERS ===== */
  function createBubble(config, onClick) {
    var b = config.bubble || {};
    var bubbleSize = b.bubbleSizePx || 60;
    var bubbleBg = b.backgroundColor || '#3b82f6';
    var bubbleRadius = b.borderRadiusStyle === 'circle' ? '50%' : b.borderRadiusStyle === 'rounded' ? '16px' : '0';
    
    console.log('[ProfitBot] Creating bubble with config:', {
      backgroundColor: b.backgroundColor,
      bubbleSizePx: b.bubbleSizePx,
      rightPositionPx: b.rightPositionPx,
      bottomPositionPx: b.bottomPositionPx,
      computedSize: bubbleSize + 'px',
      computedBg: bubbleBg
    });
    var btn = el('button', { type: 'button', className: 'pb-bubble pb-bubble-pulse', 'aria-label': 'Open chat' });
    
    // Add inline styles as fallback to ensure bubble is visible
    // Use setProperty with 'important' flag - this is the most reliable method
    btn.style.setProperty('width', bubbleSize + 'px', 'important');
    btn.style.setProperty('height', bubbleSize + 'px', 'important');
    btn.style.setProperty('min-width', bubbleSize + 'px', 'important');
    btn.style.setProperty('min-height', bubbleSize + 'px', 'important');
    btn.style.setProperty('background-color', bubbleBg, 'important');
    btn.style.setProperty('border-radius', bubbleRadius, 'important');
    btn.style.setProperty('display', 'flex', 'important');
    btn.style.setProperty('align-items', 'center', 'important');
    btn.style.setProperty('justify-content', 'center', 'important');
    btn.style.setProperty('pointer-events', 'auto', 'important');
    btn.style.setProperty('cursor', 'pointer', 'important');
    btn.style.setProperty('border', 'none', 'important');
    btn.style.setProperty('position', 'relative', 'important');
    btn.style.setProperty('z-index', '20', 'important');
    btn.style.setProperty('flex-shrink', '0', 'important');
    btn.style.setProperty('box-shadow', '0 8px 24px rgba(0,0,0,0.25), 0 4px 8px rgba(0,0,0,0.15)', 'important');
    btn.style.setProperty('outline', 'none', 'important');
    
    console.log('[ProfitBot] Bubble inline styles set as fallback');
    console.log('[ProfitBot] Bubble element after styles:', btn);
    console.log('[ProfitBot] Bubble style attribute:', btn.getAttribute('style'));
    console.log('[ProfitBot] Bubble style.width:', btn.style.width);
    console.log('[ProfitBot] Bubble style.height:', btn.style.height);

    if (b.customIconUrl) {
      var img = el('img', {
        src: b.customIconUrl,
        alt: 'Chat',
        style: { width: (b.customIconSize || 50) + '%', height: (b.customIconSize || 50) + '%', objectFit: 'contain', pointerEvents: 'none', borderRadius: (b.customIconBorderRadius || 0) + 'px' }
      });
      img.onerror = function() {
        // Preserve inline styles when clearing innerHTML
        var savedWidth = btn.style.width;
        var savedHeight = btn.style.height;
        btn.innerHTML = '';
        btn.style.width = savedWidth;
        btn.style.height = savedHeight;
        btn.appendChild(svgFilled('0 0 24 24', 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z', '50%', b.colorOfInternalIcons || '#ffffff'));
      };
      btn.appendChild(img);
    } else {
      btn.appendChild(svgFilled('0 0 24 24', 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z', '50%', b.colorOfInternalIcons || '#ffffff'));
    }

    btn.addEventListener('click', onClick);
    return btn;
  }

  function createTooltip(config, state, onClick) {
    var t = config.tooltip || {};
    if (!t.displayTooltip) return null;

    var message = t.message || 'Hi! How can I help?';
    var firstName = state.visitorName ? state.visitorName.split(/\s+/)[0] : '';
    message = message.replace(/\{first_name\}/gi, firstName || 'there').replace(/\{name\}/gi, state.visitorName || 'there');

    var tip = el('div', { className: 'pb-tooltip', role: 'button', tabindex: '0', textContent: message });
    tip.addEventListener('click', onClick);
    tip.addEventListener('keydown', function(e) { if (e.key === 'Enter') onClick(); });

    if (t.autoHideTooltip && t.autoHideDelaySeconds > 0) {
      setTimeout(function() { tip.classList.add('pb-tooltip-hidden'); }, t.autoHideDelaySeconds * 1000);
    }

    return tip;
  }

  function createChatWindow(config, state, callbacks) {
    var w = config.window || {};
    var bot = w.botMessageSettings || {};
    var win = el('div', { className: 'pb-window' });

    /* Header */
    if (w.showTitleSection) {
      var headerChildren = [];
      if (w.titleAvatarUrl) {
        headerChildren.push(el('img', { src: w.titleAvatarUrl, alt: '', className: 'pb-header-avatar' }));
      }
      headerChildren.push(el('span', { className: 'pb-header-title', textContent: w.title || 'Chat' }));

      /* Refresh button */
      var refreshBtn = el('button', { type: 'button', className: 'pb-header-btn', title: 'Refresh' });
      refreshBtn.appendChild(svgEl('0 0 24 24', 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', '16', w.headerIconColor || '#374151'));
      refreshBtn.addEventListener('click', function() { callbacks.onRefresh(refreshBtn); });
      headerChildren.push(refreshBtn);

      /* Close button */
      var closeBtn = el('button', { type: 'button', className: 'pb-header-btn', title: 'Close' });
      closeBtn.appendChild(svgEl('0 0 24 24', 'M6 18L18 6M6 6l12 12', '16', w.headerIconColor || '#374151'));
      closeBtn.addEventListener('click', callbacks.onClose);
      headerChildren.push(closeBtn);

      var header = el('div', { className: 'pb-header' }, headerChildren);
      win.appendChild(header);
    }

    /* Messages area */
    var messagesArea = el('div', { className: 'pb-messages' });
    messagesArea.addEventListener('scroll', function() { callbacks.onScroll(messagesArea); });
    win.appendChild(messagesArea);

    /* Starter prompts */
    var startersArea = el('div', { className: 'pb-starters' });
    startersArea.style.display = 'none';
    win.appendChild(startersArea);

    /* Input area */
    var form = el('form', { className: 'pb-input-area' });
    var input = el('input', { type: 'text', className: 'pb-input', placeholder: w.inputPlaceholder || 'Type your query', autocomplete: 'off', 'aria-label': 'Message input' });
    var sendBtn = el('button', { type: 'submit', className: 'pb-send-btn', title: 'Send' });
    sendBtn.appendChild(svgEl('0 0 24 24', 'M12 19l9 2-9-18-9 18 9-2zm0 0V11', '20', w.sendButtonIconColor || '#ffffff'));
    form.appendChild(input);
    form.appendChild(sendBtn);
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      if (input.value.trim()) {
        callbacks.onSend(input.value.trim());
        input.value = '';
        /* Send pulse */
        sendBtn.classList.add('pb-send-pulse');
        setTimeout(function() { sendBtn.classList.remove('pb-send-pulse'); }, 200);
      }
    });
    win.appendChild(form);

    /* Footer */
    if (w.footerText) {
      win.appendChild(el('div', { className: 'pb-footer', textContent: w.footerText }));
    }

    return { win: win, messagesArea: messagesArea, startersArea: startersArea, input: input, sendBtn: sendBtn };
  }

  function createMessageEl(msg, config, state, isNew) {
    var w = config.window || {};
    var bot = w.botMessageSettings || {};
    var b = config.bubble || {};
    var isBot = msg.role !== 'user';
    var row = el('div', { className: 'pb-msg-row' + (isBot ? '' : ' pb-msg-row-user') + (isNew ? '' : ' pb-no-anim') });

    if (isBot) {
      /* Avatar */
      if (bot.showAvatar) {
        var avatarUrl = msg.avatarUrl || state.agentAvatarUrl || bot.avatarUrl;
        if (avatarUrl) {
          row.appendChild(el('img', { src: avatarUrl, alt: '', className: 'pb-avatar' }));
        } else {
          var ph = el('div', { className: 'pb-avatar-placeholder' });
          ph.appendChild(svgFilled('0 0 24 24', 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z', '20', '#9ca3af'));
          row.appendChild(ph);
        }
      }
    }

    var col = el('div', { style: { display: 'flex', flexDirection: 'column', maxWidth: '85%', minWidth: '0' } });

    var bubble = el('div', { className: 'pb-msg ' + (isBot ? 'pb-msg-bot' : 'pb-msg-user') });

    if (isBot) {
      var content = el('div', { className: 'pb-msg-content' });
      if (msg.checkoutPreview) {
        var intro = stripCheckoutBlock(msg.content, msg.checkoutPreview.checkoutUrl).trim();
        if (intro) content.innerHTML = '<div style="margin-bottom:0.5em">' + formatMessage(intro) + '</div>';
        content.innerHTML += renderCheckoutPreview(msg.checkoutPreview);
      } else {
        content.innerHTML = formatMessage(msg.content);
      }
      bubble.appendChild(content);

      /* Copy button */
      if (bot.showCopyToClipboardIcon) {
        var copyBtn = el('button', { type: 'button', className: 'pb-copy-btn', title: 'Copy' });
        copyBtn.appendChild(svgEl('0 0 24 24', 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z', '14'));
        copyBtn.addEventListener('click', function() {
          try { navigator.clipboard.writeText(msg.content); } catch (e) {}
        });
        bubble.appendChild(copyBtn);
      }
    } else {
      bubble.textContent = msg.content;
    }

    col.appendChild(bubble);

    if (msg.createdAt) {
      col.appendChild(el('div', { className: 'pb-timestamp', textContent: formatTimestamp(msg.createdAt), style: { color: isBot ? (bot.textColor || '#111827') : (b.colorOfInternalIcons || '#ffffff') } }));
    }

    row.appendChild(col);
    row.setAttribute('data-msg-id', msg.id || msg._localId || '');
    return row;
  }

  function createTypingIndicator(config) {
    var bot = config.window ? config.window.botMessageSettings || {} : {};
    var row = el('div', { className: 'pb-msg-row' });
    if (bot.showAvatar) {
      var avatarUrl = bot.avatarUrl;
      if (avatarUrl) {
        row.appendChild(el('img', { src: avatarUrl, alt: '', className: 'pb-avatar' }));
      } else {
        var ph = el('div', { className: 'pb-avatar-placeholder' });
        ph.appendChild(svgFilled('0 0 24 24', 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z', '20', '#9ca3af'));
        row.appendChild(ph);
      }
    }
    var botBg = (config.window && config.window.botMessageSettings) ? config.window.botMessageSettings.backgroundColor : '#f3f4f6';
    var botText = (config.window && config.window.botMessageSettings) ? config.window.botMessageSettings.textColor : '#111827';
    var dots = el('div', { className: 'pb-msg pb-msg-bot pb-typing', style: { color: botText } }, [
      el('span', { className: 'pb-typing-dot' }),
      el('span', { className: 'pb-typing-dot' }),
      el('span', { className: 'pb-typing-dot' })
    ]);
    row.appendChild(dots);
    return row;
  }

  function renderCheckoutPreview(preview) {
    var html = '<div class="pb-checkout-preview">';
    html += '<div class="pb-checkout-header"><h3>Your checkout preview</h3><span>Product</span></div>';
    if (preview.lineItemsUI && Array.isArray(preview.lineItemsUI)) {
      for (var i = 0; i < preview.lineItemsUI.length; i++) {
        var item = preview.lineItemsUI[i];
        html += '<div class="pb-line-item">';
        html += '<div class="pb-image-wrap">';
        if (item.imageUrl) html += '<img src="' + escapeHtml(item.imageUrl) + '" alt="' + escapeHtml(item.title || '') + '" />';
        html += '<span class="pb-qty-badge">' + escapeHtml(String(item.quantity || 1)) + '</span>';
        html += '</div>';
        html += '<div style="flex:1;min-width:0;padding-top:2px">';
        html += '<div class="pb-product-name">' + escapeHtml(item.title || '') + '</div>';
        if (item.variant) html += '<div class="pb-product-variant">' + escapeHtml(item.variant) + '</div>';
        html += '<div class="pb-price-row">';
        html += '<div class="pb-price-col"><div class="pb-price-label">Unit Price</div><div class="pb-price-value">' + escapeHtml(item.unitPrice || '') + '</div></div>';
        html += '<div class="pb-price-col"><div class="pb-price-label">Total</div><div class="pb-price-value">' + escapeHtml(item.lineTotal || '') + '</div></div>';
        html += '</div></div></div>';
      }
    }
    if (preview.summary) {
      html += '<div class="pb-checkout-summary">';
      html += '<div class="pb-summary-row"><span>Total Items</span><span>' + escapeHtml(String(preview.summary.totalItems || 0)) + ' items</span></div>';
      html += '<div class="pb-summary-row"><span>Shipping</span><span>FREE</span></div>';
      if (preview.summary.discountPercent != null) html += '<div class="pb-summary-row"><span>Discount</span><span>' + escapeHtml(String(preview.summary.discountPercent)) + '% OFF</span></div>';
      html += '<div class="pb-summary-row"><span>Subtotal</span><span>' + escapeHtml(preview.summary.subtotal || '') + ' ' + escapeHtml(preview.summary.currency || '') + '</span></div>';
      if (preview.summary.discountAmount != null) html += '<div class="pb-summary-row"><span>Savings</span><span>-' + escapeHtml(preview.summary.discountAmount) + '</span></div>';
      html += '<div class="pb-summary-row pb-summary-total"><span>Total</span><span>' + escapeHtml(preview.summary.total || '') + ' ' + escapeHtml(preview.summary.currency || '') + '</span></div>';
      html += '<div class="pb-summary-footer">GST included</div>';
      html += '</div>';
    }
    if (preview.checkoutUrl) html += '<a href="' + escapeHtml(preview.checkoutUrl) + '" target="_blank" rel="noopener noreferrer" class="pb-checkout-cta">GO TO CHECKOUT</a>';
    html += '</div>';
    return html;
  }

  /* ===== 7. WIDGET CONTROLLER ===== */
  function initWidget() {
    if (!document.body) { 
      setTimeout(initWidget, 10); 
      return; 
    }

    // Prevent duplicate initialization
    if (document.getElementById('profitbot-widget-' + widgetId)) {
      console.warn('[ProfitBot] Widget already initialized for:', widgetId);
      return;
    }

    var container = document.createElement('div');
    container.id = 'profitbot-widget-' + widgetId;
    container.setAttribute('data-profitbot-widget', widgetId);
    
    try {
      document.body.appendChild(container);
    } catch (e) {
      console.error('[ProfitBot] Failed to append container:', e);
      return;
    }

    var widgetUrl = base + '/api/widgets/' + encodeURIComponent(widgetId);
    console.log('[ProfitBot] Loading widget:', widgetId, 'from:', widgetUrl);

    fetch(widgetUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      credentials: 'omit'
    })
      .then(function(res) {
        if (!res.ok) {
          throw new Error('Widget not found: ' + res.status + ' ' + res.statusText);
        }
        return res.json();
      })
      .then(function(data) {
        if (!data || !data.config) {
          throw new Error('Invalid config: missing data or config');
        }
        console.log('[ProfitBot] Widget config loaded, rendering...');
        renderWidget(container, data);
      })
      .catch(function(err) {
        console.error('[ProfitBot] Failed to load widget:', err);
        console.error('[ProfitBot] Widget ID:', widgetId);
        console.error('[ProfitBot] Base URL:', base);
        if (container && container.parentNode) {
          container.remove();
        }
      });
  }

  function renderWidget(container, widgetData) {
    console.log('[ProfitBot] renderWidget called');
    var config = widgetData.config;
    var sessionId = getSessionId();
    
    // Use unique ID for scoping CSS to avoid conflicts
    var widgetUniqueId = 'profitbot-' + widgetId.replace(/[^a-z0-9]/gi, '-');
    container.setAttribute('data-profitbot-id', widgetUniqueId);
    
    /* Inject CSS into document head with scoped selectors */
    var css = getWidgetCSS(config, widgetUniqueId);
    console.log('[ProfitBot] Injecting CSS into document head, length:', css.length);
    
    // Check if style already exists (prevent duplicates)
    var existingStyleId = 'profitbot-style-' + widgetUniqueId;
    var existingStyle = document.getElementById(existingStyleId);
    if (existingStyle) {
      existingStyle.remove();
    }
    
    var styleEl = document.createElement('style');
    styleEl.id = existingStyleId;
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
    console.log('[ProfitBot] CSS injected into document head');
    
    // Verify CSS values
    var b = config.bubble || {};
    var bubbleSize = b.bubbleSizePx || 60;
    var bubbleRight = b.rightPositionPx || 20;
    var bubbleBottom = b.bottomPositionPx || 20;
    console.log('[ProfitBot] Expected CSS values:', {
      bubbleSize: bubbleSize + 'px',
      bubbleRight: bubbleRight + 'px',
      bubbleBottom: bubbleBottom + 'px'
    });

    /* State */
    var state = {
      isOpen: false,
      isMobile: window.innerWidth <= 768,
      messages: [],
      renderedIds: {},
      loading: false,
      messagesLoading: false,
      agentTyping: false,
      agentAvatarUrl: null,
      visitorName: null,
      showStarterPrompts: true,
      sessionId: sessionId,
      pollTimer: null,
      lastMessageCount: 0,
      localIdCounter: 0,
      isStreaming: false,
      streamingMsgId: null,
      scrollFabEl: null
    };

    function nextLocalId() { return ++state.localIdCounter; }

    /* Main wrapper */
    var wrapper = el('div', { className: 'pb-wrapper' });
    console.log('[ProfitBot] Appending wrapper to container');
    container.appendChild(wrapper);
    
    // Force wrapper to have inline styles as fallback (in case CSS doesn't load)
    var b = config.bubble || {};
    var bubbleRight = b.rightPositionPx || 20;
    var bubbleBottom = b.bottomPositionPx || 20;
    // Use setProperty with 'important' flag for wrapper
    wrapper.style.setProperty('position', 'fixed', 'important');
    wrapper.style.setProperty('right', bubbleRight + 'px', 'important');
    wrapper.style.setProperty('bottom', bubbleBottom + 'px', 'important');
    wrapper.style.setProperty('z-index', '2147483647', 'important');
    wrapper.style.setProperty('display', 'flex', 'important');
    wrapper.style.setProperty('flex-direction', 'column', 'important');
    wrapper.style.setProperty('align-items', 'flex-end', 'important');
    wrapper.style.setProperty('pointer-events', 'none', 'important');
    console.log('[ProfitBot] Wrapper inline styles set as fallback');
    console.log('[ProfitBot] Wrapper style attribute:', wrapper.getAttribute('style'));

    /* Backdrop (mobile only) */
    var backdrop = el('div', { className: 'pb-backdrop' });
    backdrop.addEventListener('click', function() { closeChat(); });

    /* Chat window */
    var chatParts = createChatWindow(config, state, {
      onClose: function() { closeChat(); },
      onRefresh: function(btn) { handleRefresh(btn); },
      onScroll: throttle(function(el) { updateScrollFab(el); }, 100),
      onSend: function(text) { sendMessage(text); }
    });
    var chatWin = chatParts.win;
    var messagesArea = chatParts.messagesArea;
    var startersArea = chatParts.startersArea;
    var inputEl = chatParts.input;
    var sendBtn = chatParts.sendBtn;

    /* Tooltip */
    var tooltip = createTooltip(config, state, function() { openChat(); });

    /* Bubble */
    var bubble = createBubble(config, function() {
      if (state.isOpen) closeChat(); else openChat();
    });

    /* Bottom row: tooltip + bubble */
    var bottomRow = el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: '8px', position: 'relative', zIndex: '10' } });
    if (tooltip) bottomRow.appendChild(tooltip);
    bottomRow.appendChild(bubble);
    wrapper.appendChild(bottomRow);
    console.log('[ProfitBot] Bubble appended to wrapper. Bubble element:', bubble);
    console.log('[ProfitBot] Bubble classes:', bubble.className);
    console.log('[ProfitBot] Bubble inline styles after append:', {
      width: bubble.style.width,
      height: bubble.style.height,
      backgroundColor: bubble.style.backgroundColor,
      display: bubble.style.display
    });
    console.log('[ProfitBot] Wrapper element:', wrapper);
    console.log('[ProfitBot] Wrapper inline styles:', {
      position: wrapper.style.position,
      right: wrapper.style.right,
      bottom: wrapper.style.bottom
    });
    console.log('[ProfitBot] Container in DOM:', container.parentNode ? 'YES' : 'NO');
    console.log('[ProfitBot] Container element:', container);
    
    // Immediate check of computed styles
    setTimeout(function() {
      var computed = window.getComputedStyle(bubble);
      console.log('[ProfitBot] Immediate computed styles:', {
        width: computed.width,
        height: computed.height,
        display: computed.display,
        position: computed.position,
        backgroundColor: computed.backgroundColor
      });
      console.log('[ProfitBot] Bubble actual style attribute:', bubble.getAttribute('style'));
      console.log('[ProfitBot] Bubble style.cssText:', bubble.style.cssText);
      
      // If styles aren't applying, try forcing them again
      if (computed.width === '0px' || computed.height === '0px') {
        console.warn('[ProfitBot] Styles not applied, forcing re-application...');
        var b = config.bubble || {};
        var bubbleSize = b.bubbleSizePx || 60;
        bubble.style.setProperty('width', bubbleSize + 'px', 'important');
        bubble.style.setProperty('height', bubbleSize + 'px', 'important');
        bubble.style.setProperty('display', 'flex', 'important');
        bubble.style.setProperty('min-width', bubbleSize + 'px', 'important');
        bubble.style.setProperty('min-height', bubbleSize + 'px', 'important');
        console.log('[ProfitBot] Forced styles re-applied');
      }
    }, 100);

    /* Fetch visitor name */
    fetch(base + '/api/widgets/' + widgetId + '/visitor?session_id=' + encodeURIComponent(sessionId))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data && data.name && typeof data.name === 'string' && data.name.trim()) {
          state.visitorName = data.name.trim();
          if (tooltip) {
            var msg = (config.tooltip.message || '').replace(/\{first_name\}/gi, state.visitorName.split(/\s+/)[0] || 'there').replace(/\{name\}/gi, state.visitorName || 'there');
            tooltip.textContent = msg;
          }
        }
      })
      .catch(function() {});

    /* Open/close */
    function openChat() {
      state.isOpen = true;
      bubble.classList.add('pb-open');
      bubble.setAttribute('aria-label', 'Close chat');
      bubble.setAttribute('aria-expanded', 'true');
      if (tooltip) tooltip.style.display = 'none';
      /* Insert backdrop before window */
      wrapper.insertBefore(backdrop, bottomRow);
      wrapper.insertBefore(chatWin, bottomRow);
      chatWin.classList.remove('pb-closing');
      inputEl.focus();
      fetchMessages(true);
      startPolling();
      dispatchEvent('profitbot:chat-opened');
    }

    function closeChat() {
      state.isOpen = false;
      bubble.classList.remove('pb-open');
      bubble.setAttribute('aria-label', 'Open chat');
      bubble.setAttribute('aria-expanded', 'false');
      chatWin.classList.add('pb-closing');
      setTimeout(function() {
        if (chatWin.parentNode) chatWin.parentNode.removeChild(chatWin);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        chatWin.classList.remove('pb-closing');
      }, dur(180));
      if (tooltip && config.tooltip.displayTooltip) tooltip.style.display = '';
      dispatchEvent('profitbot:chat-closed');
    }

    /* Auto-open */
    if (config.bubble && config.bubble.autoOpenBotWindow) {
      setTimeout(function() { openChat(); }, 500);
    }

    /* Dispatch custom events */
    function dispatchEvent(name, detail) {
      try {
        document.dispatchEvent(new CustomEvent(name, { detail: Object.assign({ widgetId: widgetId, sessionId: sessionId }, detail || {}) }));
      } catch (e) {}
    }

    /* Scroll FAB */
    var SCROLL_THRESHOLD = 120;
    function updateScrollFab(el) {
      if (!el) return;
      var nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD;
      var canScroll = el.scrollHeight > el.clientHeight;
      if (canScroll && !nearBottom) {
        if (!state.scrollFabEl || !state.scrollFabEl.parentNode) {
          state.scrollFabEl = createScrollFab(function() { scrollToBottom(true); });
          messagesArea.appendChild(state.scrollFabEl);
        }
      } else {
        if (state.scrollFabEl && state.scrollFabEl.parentNode) {
          state.scrollFabEl.parentNode.removeChild(state.scrollFabEl);
          state.scrollFabEl = null;
        }
      }
    }

    function createScrollFab(onClick) {
      var fab = el('button', { type: 'button', className: 'pb-scroll-fab', title: 'Scroll to bottom', 'aria-label': 'Scroll to latest messages' });
      fab.appendChild(svgEl('0 0 24 24', 'M19 14l-7 7m0 0l-7-7m7 7V3', '20'));
      fab.addEventListener('click', onClick);
      return fab;
    }

    function scrollToBottom(force) {
      if (!messagesArea) return;
      var nearBottom = messagesArea.scrollTop + messagesArea.clientHeight >= messagesArea.scrollHeight - SCROLL_THRESHOLD;
      if (force || nearBottom) {
        messagesArea.scrollTo({ top: messagesArea.scrollHeight, behavior: state.isStreaming ? 'auto' : 'smooth' });
      }
      /* Remove FAB when at bottom */
      if (state.scrollFabEl && state.scrollFabEl.parentNode) {
        state.scrollFabEl.parentNode.removeChild(state.scrollFabEl);
        state.scrollFabEl = null;
      }
    }

    /* ===== DIFFERENTIAL MESSAGE RENDERING ===== */
    var typingIndicatorEl = null;

    function renderMessages(forceAll) {
      if (!messagesArea) return;

      /* Remove typing indicator while updating */
      if (typingIndicatorEl && typingIndicatorEl.parentNode) {
        typingIndicatorEl.parentNode.removeChild(typingIndicatorEl);
      }

      /* Remove scroll FAB temporarily */
      if (state.scrollFabEl && state.scrollFabEl.parentNode) {
        state.scrollFabEl.parentNode.removeChild(state.scrollFabEl);
      }

      if (forceAll) {
        /* Full rebuild */
        messagesArea.innerHTML = '';
        state.renderedIds = {};
      }

      /* Welcome message when empty */
      var welcomeId = '__welcome__';
      if (state.messages.length === 0 && !state.messagesLoading) {
        if (!state.renderedIds[welcomeId]) {
          var w = config.window || {};
          var bot = w.botMessageSettings || {};
          var welcomeText = w.welcomeMessage || 'Hi! How can I help you today?';
          var firstName = state.visitorName ? state.visitorName.split(/\s+/)[0] : '';
          welcomeText = welcomeText.replace(/\{first_name\}/gi, firstName || 'there').replace(/\{name\}/gi, state.visitorName || 'there');
          var wRow = el('div', { className: 'pb-msg-row' });
          if (bot.showAvatar && bot.avatarUrl) {
            wRow.appendChild(el('img', { src: bot.avatarUrl, alt: '', className: 'pb-avatar' }));
          }
          var wBubble = el('div', { className: 'pb-msg pb-msg-bot' });
          wBubble.innerHTML = formatMessage(welcomeText);
          var wCol = el('div', { style: { display: 'flex', flexDirection: 'column', maxWidth: '85%', minWidth: '0' } });
          wCol.appendChild(wBubble);
          wRow.appendChild(wCol);
          messagesArea.appendChild(wRow);
          state.renderedIds[welcomeId] = true;
        }
      } else {
        /* Remove welcome if messages exist */
        if (state.renderedIds[welcomeId]) {
          var firstChild = messagesArea.firstChild;
          if (firstChild) messagesArea.removeChild(firstChild);
          delete state.renderedIds[welcomeId];
        }
      }

      /* Loading state */
      if (state.messagesLoading && state.messages.length === 0) {
        if (!state.renderedIds['__loader__']) {
          var loader = el('div', { className: 'pb-loader' });
          var spinSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          spinSvg.setAttribute('viewBox', '0 0 24 24');
          spinSvg.setAttribute('width', '32');
          spinSvg.setAttribute('height', '32');
          spinSvg.style.fill = 'none';
          var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '10');
          circle.setAttribute('stroke', 'currentColor'); circle.setAttribute('stroke-width', '4');
          circle.style.opacity = '0.25';
          var pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          pathEl.setAttribute('fill', 'currentColor'); pathEl.setAttribute('d', 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z');
          pathEl.style.opacity = '0.75';
          spinSvg.appendChild(circle); spinSvg.appendChild(pathEl);
          loader.appendChild(spinSvg);
          messagesArea.appendChild(loader);
          state.renderedIds['__loader__'] = true;
        }
        return;
      } else if (state.renderedIds['__loader__']) {
        var loaderEl = messagesArea.querySelector('.pb-loader');
        if (loaderEl) loaderEl.remove();
        delete state.renderedIds['__loader__'];
      }

      /* Render new messages only */
      for (var i = 0; i < state.messages.length; i++) {
        var msg = state.messages[i];
        var msgKey = msg.id || ('local_' + msg._localId);
        if (state.renderedIds[msgKey]) continue;
        var isNew = !forceAll;
        var msgEl = createMessageEl(msg, config, state, isNew);
        messagesArea.appendChild(msgEl);
        state.renderedIds[msgKey] = true;
      }

      /* Typing indicator */
      if ((state.loading && !state.isStreaming) || state.agentTyping) {
        typingIndicatorEl = createTypingIndicator(config);
        messagesArea.appendChild(typingIndicatorEl);
      }

      requestAnimationFrame(function() { scrollToBottom(); });
    }

    function updateStarterPrompts() {
      if (!startersArea) return;
      var prompts = (config.window && config.window.starterPrompts) || [];
      var filtered = prompts.filter(function(p) { return p && p.trim(); });
      if (state.showStarterPrompts && filtered.length > 0 && state.messages.length === 0) {
        startersArea.innerHTML = '';
        for (var i = 0; i < filtered.length; i++) {
          (function(prompt, idx) {
            var btn = el('button', { type: 'button', className: 'pb-starter-btn', textContent: prompt });
            btn.style.animationDelay = dur(idx * 60) + 'ms';
            btn.addEventListener('click', function() { sendMessage(prompt); });
            startersArea.appendChild(btn);
          })(filtered[i], i);
        }
        startersArea.style.display = 'flex';
      } else {
        startersArea.style.display = 'none';
      }
    }

    /* ===== 8. NETWORK ===== */
    function fetchMessages(forceRefresh) {
      if (!widgetId || !sessionId || sessionId === 'preview') return;
      if (forceRefresh) state.messagesLoading = true;

      fetch(base + '/api/widgets/' + widgetId + '/messages?session_id=' + encodeURIComponent(sessionId))
        .then(function(res) { return res.json(); })
        .then(function(data) {
          var list = Array.isArray(data.messages) ? data.messages : [];

          if (forceRefresh || state.messages.length === 0) {
            state.messages = list.map(function(m) {
              return { id: m.id, _localId: nextLocalId(), role: m.role === 'user' ? 'user' : 'bot', content: m.content, avatarUrl: m.avatarUrl, checkoutPreview: m.checkoutPreview, createdAt: m.createdAt };
            });
            state.showStarterPrompts = list.length === 0;
            if (forceRefresh) {
              state.renderedIds = {};
              renderMessages(true);
            } else {
              renderMessages();
            }
          } else if (list.length > state.messages.length) {
            var existingIds = {};
            for (var j = 0; j < state.messages.length; j++) {
              if (state.messages[j].id) existingIds[state.messages[j].id] = true;
            }
            var newMsgs = list.filter(function(m) { return m.id && !existingIds[m.id]; }).map(function(m) {
              return { id: m.id, _localId: nextLocalId(), role: m.role === 'user' ? 'user' : 'bot', content: m.content, avatarUrl: m.avatarUrl, checkoutPreview: m.checkoutPreview, createdAt: m.createdAt };
            });
            if (newMsgs.length > 0) {
              state.messages = state.messages.concat(newMsgs);
              renderMessages();
            }
          } else if (list.length === state.messages.length && list.length > 0) {
            /* Content may have changed (e.g. checkout preview added) */
            var changed = false;
            for (var k = 0; k < list.length; k++) {
              if (list[k].checkoutPreview && !state.messages[k].checkoutPreview) { changed = true; break; }
            }
            if (changed) {
              state.messages = list.map(function(m) {
                return { id: m.id, _localId: nextLocalId(), role: m.role === 'user' ? 'user' : 'bot', content: m.content, avatarUrl: m.avatarUrl, checkoutPreview: m.checkoutPreview, createdAt: m.createdAt };
              });
              state.renderedIds = {};
              renderMessages(true);
            }
          }

          state.agentTyping = !!data.agentTyping;
          state.agentAvatarUrl = data.agentAvatarUrl || null;
          state.lastMessageCount = list.length;
          state.messagesLoading = false;
          updateStarterPrompts();
        })
        .catch(function(err) {
          console.error('[ProfitBot] Error fetching messages:', err);
          state.messagesLoading = false;
        });
    }

    function startPolling() {
      stopPolling();
      if (!widgetId || !sessionId || sessionId === 'preview') return;
      state.pollTimer = setInterval(function() { fetchMessages(); }, 3000);
    }

    function stopPolling() {
      if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    }

    function handleRefresh(btn) {
      if (state.messagesLoading) return;
      state.messagesLoading = true;
      state.messages = [];
      state.renderedIds = {};
      renderMessages(true);
      /* Spin icon */
      var svgIcon = btn.querySelector('svg');
      if (svgIcon) svgIcon.classList.add('pb-spin');
      btn.disabled = true;
      fetchMessages(true);
      setTimeout(function() {
        if (svgIcon) svgIcon.classList.remove('pb-spin');
        btn.disabled = false;
        startPolling();
      }, 2000);
    }

    /* ===== STREAMING ENGINE ===== */
    function handleStreamingResponse(res, onDone) {
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var netBuffer = '';
      var charQueue = [];
      var streamDone = false;
      var drainRafId = null;
      var lastScrollTime = 0;
      var fullContent = '';

      /* Add placeholder bot message */
      var msgId = nextLocalId();
      var streamMsg = { id: null, _localId: msgId, role: 'bot', content: '', createdAt: new Date().toISOString() };
      state.messages.push(streamMsg);
      state.isStreaming = true;
      state.streamingMsgId = msgId;
      renderMessages();

      /* Find the DOM element for the streaming message */
      var streamMsgEl = null;
      var allRows = messagesArea.querySelectorAll('.pb-msg-row');
      if (allRows.length > 0) {
        var lastRow = allRows[allRows.length - 1];
        var contentDiv = lastRow.querySelector('.pb-msg-content');
        if (!contentDiv) {
          contentDiv = lastRow.querySelector('.pb-msg-bot');
        }
        streamMsgEl = contentDiv;
      }

      /* Add streaming cursor */
      function updateStreamContent() {
        if (streamMsgEl) {
          streamMsgEl.innerHTML = formatMessage(fullContent) + '<span class="pb-streaming-cursor">&#9612;</span>';
        }
      }

      function drainQueue() {
        if (charQueue.length === 0) {
          if (streamDone) {
            drainRafId = null;
            finishStream();
            return;
          }
          drainRafId = requestAnimationFrame(drainQueue);
          return;
        }
        var charsPerFrame = charQueue.length > 30 ? 4 : charQueue.length > 10 ? 3 : 2;
        var batch = charQueue.splice(0, charsPerFrame).join('');
        fullContent += batch;
        streamMsg.content = fullContent;
        updateStreamContent();
        var now = Date.now();
        if (now - lastScrollTime > 50) {
          lastScrollTime = now;
          scrollToBottom();
        }
        drainRafId = requestAnimationFrame(drainQueue);
      }

      function finishStream() {
        state.isStreaming = false;
        state.streamingMsgId = null;
        /* Remove cursor and finalize */
        if (streamMsgEl) {
          streamMsgEl.innerHTML = formatMessage(fullContent);
        }
        scrollToBottom();
        onDone(fullContent.trim(), null);
      }

      drainRafId = requestAnimationFrame(drainQueue);

      function processStream() {
        reader.read().then(function(result) {
          if (result.done) {
            if (netBuffer.trim()) {
              for (var ci = 0; ci < netBuffer.length; ci++) charQueue.push(netBuffer[ci]);
            }
            streamDone = true;
            return;
          }
          netBuffer += decoder.decode(result.value, { stream: true });
          var lines = netBuffer.split('\n');
          netBuffer = lines.pop() || '';
          for (var li = 0; li < lines.length; li++) {
            var line = lines[li];
            if (line.indexOf('data: ') === 0) {
              var payload = line.slice(6).trim();
              if (payload === '[DONE]' || payload === '') continue;
              try {
                var parsed = JSON.parse(payload);
                var chunk = parsed.text || parsed.content || parsed.delta || '';
                if (chunk && typeof chunk === 'string') {
                  for (var ci = 0; ci < chunk.length; ci++) charQueue.push(chunk[ci]);
                }
              } catch (e) {
                if (payload) {
                  for (var ci = 0; ci < payload.length; ci++) charQueue.push(payload[ci]);
                }
              }
            }
          }
          processStream();
        }).catch(function(err) {
          console.error('[ProfitBot] Stream error:', err);
          streamDone = true;
        });
      }

      processStream();
    }

    function sendMessage(text) {
      var trimmed = text.trim();
      if (!trimmed || state.loading) return;

      state.messages.push({ id: null, _localId: nextLocalId(), role: 'user', content: trimmed, createdAt: new Date().toISOString() });
      state.showStarterPrompts = false;
      state.loading = true;
      renderMessages();
      updateStarterPrompts();
      inputEl.disabled = true;
      sendBtn.disabled = true;
      requestAnimationFrame(function() { scrollToBottom(true); });

      dispatchEvent('profitbot:message-sent', { message: trimmed });

      /* Restart polling */
      startPolling();

      /* Get conversation ID and send */
      var conversationId = null;
      fetch(base + '/api/widgets/' + widgetId + '/conversation?session_id=' + encodeURIComponent(sessionId))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.conversationId) conversationId = data.conversationId;
          /* Save user message */
          if (conversationId) {
            fetch(base + '/api/widgets/' + widgetId + '/messages/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ conversationId: conversationId, role: 'user', content: trimmed })
            }).catch(function() {});
          }
          doSend(trimmed, conversationId);
        })
        .catch(function() {
          doSend(trimmed, null);
        });
    }

    function doSend(message, conversationId) {
      var useN8n = !!(config.n8nWebhookUrl && config.n8nWebhookUrl.trim());

      if (useN8n) {
        sendToN8n(message, conversationId);
      } else {
        sendToDirectChat(message);
      }
    }

    function buildSystemPrompt() {
      if (config.agentSystemPrompt && config.agentSystemPrompt.trim()) {
        return config.agentSystemPrompt.trim();
      }
      var bot = config.bot || {};
      var parts = [];
      if (bot.role && bot.role.trim()) parts.push(bot.role.trim());
      if (bot.tone && bot.tone.trim()) parts.push('Tone: ' + bot.tone.trim());
      if (bot.instructions && bot.instructions.trim()) parts.push(bot.instructions.trim());
      return parts.length > 0 ? parts.join('\n\n') : null;
    }

    function sendToN8n(message, conversationId) {
      var n8nUrl = config.n8nWebhookUrl;
      if (!n8nUrl) {
        finishSend(config.window.customErrorMessage || 'Error: n8n webhook not configured');
        return;
      }
      var body = { message: message, sessionId: sessionId, widgetId: widgetId };
      if (conversationId) body.conversationId = conversationId;
      if (config.agentId) body.agentId = config.agentId;
      var systemPrompt = buildSystemPrompt();
      if (systemPrompt) body.systemPrompt = systemPrompt;

      fetch(n8nUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
        .then(function(res) {
          var contentType = res.headers.get('content-type') || '';
          if (res.ok && res.body && !contentType.includes('application/json')) {
            /* Streaming response */
            handleStreamingResponse(res, function(content) {
              state.loading = false;
              inputEl.disabled = false;
              sendBtn.disabled = false;
              inputEl.focus();
              if (!content) {
                /* Replace empty streaming message with error */
                var lastMsg = state.messages[state.messages.length - 1];
                if (lastMsg && lastMsg.role === 'bot' && !lastMsg.content) {
                  lastMsg.content = config.window.customErrorMessage || 'Error: No response';
                  state.renderedIds = {};
                  renderMessages(true);
                }
              }
              startPolling();
              /* Sync with database after delay */
              setTimeout(function() { fetchMessages(); }, 2000);
            });
          } else {
            return res.json().then(function(data) {
              var reply = extractReply(data);
              var checkoutPreview = extractCheckoutPreview(data);
              finishSend(reply || config.window.customErrorMessage, checkoutPreview);
            });
          }
        })
        .catch(function(err) {
          console.error('[ProfitBot] n8n error:', err);
          finishSend(config.window.customErrorMessage || 'Error: Failed to send message');
        });
    }

    function sendToDirectChat(message) {
      fetch(base + '/api/widgets/' + widgetId + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message, sessionId: sessionId })
      })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.error) {
            finishSend(config.window.customErrorMessage || 'Error: ' + data.error);
          } else {
            var reply = data.message || data.content || data.reply || '';
            finishSend(reply || config.window.customErrorMessage);
          }
        })
        .catch(function(err) {
          console.error('[ProfitBot] Chat error:', err);
          finishSend(config.window.customErrorMessage || 'Error: Failed to send message');
        });
    }

    function extractReply(data) {
      var raw = data.output || data.message || data.reply || data.text || data.content || '';
      /* Handle nested message objects */
      if (data && typeof data === 'object' && 'success' in data && 'message' in data && typeof data.message === 'object') {
        if (data.message && data.message.content) return data.message.content;
      }
      if (typeof raw === 'string' && raw.trim().indexOf('{') === 0) {
        try {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.content) return parsed.content;
          if (parsed && parsed.message && parsed.message.content) return parsed.message.content;
        } catch (e) {}
      }
      if (raw && typeof raw === 'object') {
        if (raw.content) return raw.content;
        if (raw.message && raw.message.content) return raw.message.content;
      }
      return typeof raw === 'string' ? raw : (raw ? JSON.stringify(raw) : '');
    }

    function extractCheckoutPreview(data) {
      var preview = data.checkoutPreview;
      if (preview && typeof preview === 'object' && Array.isArray(preview.lineItemsUI) && preview.summary && typeof preview.checkoutUrl === 'string') {
        return preview;
      }
      return null;
    }

    function finishSend(reply, checkoutPreview) {
      state.loading = false;
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
      if (reply) {
        state.messages.push({ id: null, _localId: nextLocalId(), role: 'bot', content: reply, checkoutPreview: checkoutPreview || undefined, createdAt: new Date().toISOString() });
      }
      renderMessages();
      startPolling();
      /* Sync after delay */
      setTimeout(function() { fetchMessages(); }, 2000);
    }

    /* ===== INIT ===== */
    console.log('[ProfitBot] Widget initialization complete. Starting message fetch...');
    fetchMessages(true);
    startPolling();
    updateStarterPrompts();
    dispatchEvent('profitbot:ready');
    console.log('[ProfitBot] Widget ready! Bubble should be visible at bottom-right.');
    
    // Verify bubble is in DOM and styles are applied
    setTimeout(function() {
      var bubbleEl = container.querySelector('.pb-bubble');
      var wrapperEl = container.querySelector('.pb-wrapper');
      
      if (wrapperEl) {
        var wrapperStyles = window.getComputedStyle(wrapperEl);
        console.log('[ProfitBot] Wrapper computed styles:', {
          position: wrapperStyles.position,
          right: wrapperStyles.right,
          bottom: wrapperStyles.bottom,
          display: wrapperStyles.display,
          zIndex: wrapperStyles.zIndex,
          visibility: wrapperStyles.visibility,
          opacity: wrapperStyles.opacity
        });
        var wrapperRect = wrapperEl.getBoundingClientRect();
        console.log('[ProfitBot] Wrapper position:', {
          top: wrapperRect.top,
          left: wrapperRect.left,
          width: wrapperRect.width,
          height: wrapperRect.height,
          visible: wrapperRect.width > 0 && wrapperRect.height > 0
        });
        
        // If wrapper has no dimensions, fix it
        if (wrapperRect.width === 0 || wrapperRect.height === 0) {
          console.warn('[ProfitBot] Wrapper has no dimensions, forcing...');
          var b = config.bubble || {};
          var bubbleRight = b.rightPositionPx || 20;
          var bubbleBottom = b.bottomPositionPx || 20;
          wrapperEl.style.setProperty('position', 'fixed', 'important');
          wrapperEl.style.setProperty('right', bubbleRight + 'px', 'important');
          wrapperEl.style.setProperty('bottom', bubbleBottom + 'px', 'important');
          wrapperEl.style.setProperty('display', 'flex', 'important');
          wrapperEl.style.setProperty('visibility', 'visible', 'important');
          wrapperEl.style.setProperty('opacity', '1', 'important');
        }
      } else {
        console.error('[ProfitBot] ✗ Wrapper NOT found in DOM!');
      }
      
      if (bubbleEl) {
        console.log('[ProfitBot] ✓ Bubble found in DOM');
        var bubbleStyles = window.getComputedStyle(bubbleEl);
        console.log('[ProfitBot] Bubble computed styles:', {
          width: bubbleStyles.width,
          height: bubbleStyles.height,
          backgroundColor: bubbleStyles.backgroundColor,
          position: bubbleStyles.position,
          display: bubbleStyles.display
        });
        var rect = bubbleEl.getBoundingClientRect();
        console.log('[ProfitBot] Bubble position:', { 
          top: rect.top, 
          left: rect.left, 
          width: rect.width, 
          height: rect.height,
          visible: rect.width > 0 && rect.height > 0
        });
        
        if (rect.width === 0 || rect.height === 0) {
          console.error('[ProfitBot] ⚠️ Bubble has no dimensions! CSS may not be applied.');
          var styleEl = document.getElementById(existingStyleId);
          console.error('[ProfitBot] Style element in head:', styleEl);
          console.error('[ProfitBot] CSS content length:', styleEl?.textContent?.length || 0);
          
          // Check what CSS rules are actually applied
          var styleSheet = styleEl?.sheet;
          if (styleSheet) {
            try {
              var rules = styleSheet.cssRules || styleSheet.rules;
              console.log('[ProfitBot] CSS rules count:', rules?.length || 0);
              for (var i = 0; i < Math.min(rules?.length || 0, 10); i++) {
                if (rules[i].selectorText && rules[i].selectorText.indexOf('pb-bubble') >= 0) {
                  console.log('[ProfitBot] Bubble CSS rule:', rules[i].selectorText, rules[i].style.cssText);
                }
              }
            } catch (e) {
              console.error('[ProfitBot] Could not read CSS rules:', e);
            }
          }
          
          // Try one more time to force styles
          var b = config.bubble || {};
          var bubbleSize = b.bubbleSizePx || 60;
          bubble.style.setProperty('width', bubbleSize + 'px', 'important');
          bubble.style.setProperty('height', bubbleSize + 'px', 'important');
          bubble.style.setProperty('min-width', bubbleSize + 'px', 'important');
          bubble.style.setProperty('min-height', bubbleSize + 'px', 'important');
          bubble.style.setProperty('display', 'flex', 'important');
          
          // Force a reflow
          void bubble.offsetHeight;
          
          var newRect = bubble.getBoundingClientRect();
          console.log('[ProfitBot] After force re-apply, bubble rect:', {
            width: newRect.width,
            height: newRect.height
          });
        }
      } else {
        console.error('[ProfitBot] ✗ Bubble NOT found in DOM!');
      }
    }, 1000);

    /* Keyboard */
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && state.isOpen) closeChat();
    });

    /* Resize */
    window.addEventListener('resize', function() {
      state.isMobile = window.innerWidth <= 768;
    });
  }

  /* ===== 10. INIT ===== */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidget);
  } else {
    initWidget();
  }
})();
`.replaceAll(/\n\s+/g, '\n').trim();

export const GET = () => {
	return new Response(EMBED_SCRIPT, {
		headers: {
			'Content-Type': 'application/javascript; charset=utf-8',
			'Cache-Control': 'public, max-age=300'
		}
	});
};
