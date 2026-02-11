/**
 * Component builders module - Creates DOM elements for bubble, tooltip, chat window, messages
 */
export const components = String.raw`
  /* ===== 6. COMPONENT BUILDERS ===== */
  function createBubble(config, onClick) {
    var b = config.bubble || {};
    var bubbleSize = b.bubbleSizePx || 60;
    var bubbleBg = b.backgroundColor || '#3b82f6';
    var bubbleRadius = b.borderRadiusStyle === 'circle' ? '50%' : b.borderRadiusStyle === 'rounded' ? '16px' : '0';
    
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

    var col = el('div', { style: { display: 'flex', flexDirection: 'column', maxWidth: '90%', minWidth: '0' } });

    var bubble = el('div', { className: 'pb-msg ' + (isBot ? 'pb-msg-bot' : 'pb-msg-user') });

    if (isBot) {
      var content = el('div', { className: 'pb-msg-content' });
      var preview = msg.checkoutPreview || tryParseCheckoutFromText(msg.content) || tryParseShortDiyQuote(msg.content);
      if (preview && (!preview.lineItemsUI || preview.lineItemsUI.length === 0) && msg.content) {
        var parsed = tryParseCheckoutFromText(msg.content) || tryParseShortDiyQuote(msg.content);
        if (parsed && parsed.lineItemsUI && parsed.lineItemsUI.length > 0)
          preview = { lineItemsUI: parsed.lineItemsUI, summary: preview.summary || parsed.summary, checkoutUrl: preview.checkoutUrl || parsed.checkoutUrl };
      }
      if (preview) {
        var intro = stripCheckoutBlock(msg.content, preview.checkoutUrl, true).trim();
        if (intro) content.innerHTML = '<div style="margin-bottom:0.5em">' + formatMessage(intro) + '</div>';
        content.innerHTML += renderCheckoutPreview(preview);
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

  /** Parse short DIY quote ("14x NetZero UltraTherm Roof Coating 15L, 1x ... 10L") when no full preview. */
  function tryParseShortDiyQuote(content) {
    if (!content || typeof content !== 'string') return null;
    var diyIntro = /(?:Here is your DIY quote|DIY quote)\s*(?:for\s*[\d.]+\s*m[²2]?)?\s*[:.]\s*/i.test(content);
    var hasLinePattern = /\d+\s*x\s*.+?\s*(?:15|10|5)\s*L/i.test(content);
    if (!diyIntro && !hasLinePattern) return null;
    var defaultPrices = { 15: '389.99', 10: '285.99', 5: '149.99' };
    var lineItemsUI = [];
    /* Product name must not contain digits so "15L" matches as 15 not 5 */
    var re = /(\d+)\s*x\s*([^0-9]*?)\s*(15|10|5)\s*L/gi;
    var m;
    while ((m = re.exec(content)) !== null) {
      var qty = parseInt(m[1], 10);
      var productName = (m[2] || '').trim().replace(/\s+/g, ' ') || 'Roof Coating';
      var size = parseInt(m[3], 10);
      if (qty < 1 || (size !== 15 && size !== 10 && size !== 5)) continue;
      var unitPrice = defaultPrices[size] || '0';
      var lineTotal = (qty * parseFloat(unitPrice)).toFixed(2);
      lineItemsUI.push({ title: productName + ' ' + size + 'L', quantity: qty, unitPrice: unitPrice, lineTotal: lineTotal, imageUrl: null });
    }
    if (lineItemsUI.length === 0) return null;
    var totalItems = lineItemsUI.reduce(function(s, i) { return s + i.quantity; }, 0);
    var subtotalNum = lineItemsUI.reduce(function(s, i) { return s + parseFloat(i.lineTotal); }, 0);
    var subtotal = subtotalNum.toFixed(2);
    var checkoutUrl = '';
    var linkMatch = content.match(/\[(?:GO\s+TO\s+CHECKOUT|Buy\s+now[^\]]*)\]\((https:\/\/[^)]+)\)/i);
    if (linkMatch) checkoutUrl = linkMatch[2];
    else {
      var cartMatch = content.match(/(https:\/\/[^\s<>"']*(?:cart|checkout|myshopify\.com)[^\s<>"']*)/i);
      if (cartMatch) checkoutUrl = cartMatch[1];
    }
    return { lineItemsUI: lineItemsUI, summary: { totalItems: totalItems, subtotal: subtotal, total: subtotal, currency: 'AUD' }, checkoutUrl: checkoutUrl };
  }

  /** Parse DIY checkout block from plain-text message when API did not attach checkoutPreview. */
  function tryParseCheckoutFromText(content) {
    if (!content || typeof content !== 'string') return null;
    var hasBlock = /Your\s+Checkout\s+Preview/i.test(content) && (/\bItems\s+\d+/i.test(content) || /Subtotal\s+\$/i.test(content) || /TOTAL\s+\$/i.test(content));
    if (!hasBlock) return null;
    var lineItemsUI = [];
    var lineItemRe = /\*\s*(\d+)\s*x\s*([^:*]+):\s*\$?\s*([\d,]+\.?\d*)\s*each\s*=\s*\$?\s*([\d,]+\.?\d*)/gi;
    var m;
    while ((m = lineItemRe.exec(content)) !== null) {
      var qty = parseInt(m[1], 10);
      var title = (m[2] || '').trim() || 'Product';
      var unitPrice = (m[3] || '').replace(/,/g, '');
      var lineTotal = (m[4] || '').replace(/,/g, '');
      if (qty >= 1 && (unitPrice || lineTotal)) lineItemsUI.push({ title: title, quantity: qty, unitPrice: unitPrice, lineTotal: lineTotal, imageUrl: null });
    }
    if (lineItemsUI.length === 0) {
      var defaultPrices = { 15: '389.99', 10: '285.99', 5: '149.99' };
      var shortRe = /(\d+)\s*x\s*(\d+)\s*L(?:\s*bucket[s]?)?/gi;
      while ((m = shortRe.exec(content)) !== null) {
        var qty = parseInt(m[1], 10);
        var size = parseInt(m[2], 10);
        if (qty >= 1 && (size === 15 || size === 10 || size === 5)) {
          var unit = defaultPrices[size] || '0';
          var unitNum = parseFloat(unit);
          var lineTotal = (qty * unitNum).toFixed(2);
          lineItemsUI.push({ title: size + 'L NetZero UltraTherm', quantity: qty, unitPrice: unit, lineTotal: lineTotal, imageUrl: null });
        }
      }
    }
    var totalItems = 0;
    var itemsMatch = content.match(/\bItems\s+(\d+)/i);
    if (itemsMatch) totalItems = parseInt(itemsMatch[1], 10);
    else if (lineItemsUI.length) totalItems = lineItemsUI.reduce(function(s, i) { return s + (i.quantity || 0); }, 0);
    var subtotal = '';
    var subMatch = content.match(/Subtotal\s+\$?\s*([\d,]+\.?\d*)/i);
    if (subMatch) subtotal = subMatch[1].replace(/,/g, '');
    var total = '';
    var totalMatch = content.match(/TOTAL\s+\$?\s*([\d,]+\.?\d*)/i) || content.match(/(?:^|\s)Total\s+\$?\s*([\d,]+\.?\d*)/im);
    if (totalMatch) total = totalMatch[1].replace(/,/g, '');
    if (!subtotal && total) subtotal = total;
    if (!total && subtotal) total = subtotal;
    var discountPercent = null;
    var discountMatch = content.match(/Discount\s+(\d+)\s*%?\s*OFF/i);
    if (discountMatch) discountPercent = parseInt(discountMatch[1], 10);
    var discountAmount = null;
    var savingsMatch = content.match(/Savings\s+-\s*\$?\s*([\d,]+\.?\d*)/i);
    if (savingsMatch) discountAmount = savingsMatch[1].replace(/,/g, '');
    var currency = /AUD|USD|EUR/i.test(content) ? (content.match(/\b(AUD|USD|EUR)\b/i) || [])[1] || 'AUD' : 'AUD';
    var checkoutUrl = '';
    var linkMatch = content.match(/\[(?:GO\s+TO\s+CHECKOUT|Buy\s+now[^\]]*)\]\((https:\/\/[^)]+)\)/i);
    if (linkMatch) checkoutUrl = linkMatch[2];
    else {
      var cartMatch = content.match(/(https:\/\/[^\s<>"']*(?:cart|checkout|myshopify\.com)[^\s<>"']*)/i);
      if (cartMatch) checkoutUrl = cartMatch[1];
    }
    var summary = {
      totalItems: totalItems || lineItemsUI.reduce(function(s, i) { return s + (i.quantity || 0); }, 0),
      subtotal: subtotal || total,
      total: total || subtotal,
      currency: currency,
      discountPercent: discountPercent,
      discountAmount: discountAmount
    };
    return { lineItemsUI: lineItemsUI, summary: summary, checkoutUrl: checkoutUrl };
  }

  function renderCheckoutPreview(preview) {
    var cur = preview.summary && preview.summary.currency ? escapeHtml(String(preview.summary.currency)) : 'AUD';
    var btnColor = (preview.styleOverrides && preview.styleOverrides.checkoutButtonColor) ? preview.styleOverrides.checkoutButtonColor : '#C8892D';
    var badgeColor = (preview.styleOverrides && preview.styleOverrides.qtyBadgeBackgroundColor) ? preview.styleOverrides.qtyBadgeBackgroundColor : '#195A2A';
    var btnStyle = 'background:' + escapeHtml(btnColor) + ';';
    var badgeStyle = 'background:' + escapeHtml(badgeColor) + ';';
    var html = '<div class="pb-checkout-preview">';
    html += '<h3 class="pb-checkout-title">Your Checkout Preview</h3>';
    if (preview.lineItemsUI && Array.isArray(preview.lineItemsUI) && preview.lineItemsUI.length > 0) {
      html += '<div class="pb-checkout-line-items">';
      for (var i = 0; i < preview.lineItemsUI.length; i++) {
        var item = preview.lineItemsUI[i];
        var imgUrl = (item && (item.imageUrl || item.image_url)) ? (item.imageUrl || item.image_url) : '';
        html += '<div class="pb-checkout-line-item">';
        html += '<div class="pb-checkout-line-item-image-wrap">';
        if (imgUrl) {
          html += '<img class="pb-checkout-line-item-image" src="' + escapeHtml(imgUrl) + '" alt="' + escapeHtml(item.title || '') + '" loading="lazy" />';
        } else {
          html += '<div class="pb-checkout-line-item-image pb-image-placeholder" aria-hidden="true"></div>';
        }
        html += '<span class="pb-qty-badge" style="' + badgeStyle + '">' + escapeHtml(String(item.quantity || 1)) + '</span></div>';
        html += '<div class="pb-checkout-line-item-details">';
        html += '<div class="pb-checkout-line-item-title">' + escapeHtml(item.title || '') + '</div>';
        html += '<div class="pb-checkout-price-grid">';
        html += '<div class="pb-checkout-price-block"><span class="pb-checkout-price-label">Unit Price</span><span class="pb-checkout-price-value">$' + escapeHtml(String(item.unitPrice || '')) + ' ' + cur + '</span></div>';
        html += '<div class="pb-checkout-price-block"><span class="pb-checkout-price-label">Total</span><span class="pb-checkout-price-value">$' + escapeHtml(String(item.lineTotal || '')) + ' ' + cur + '</span></div>';
        html += '</div></div></div>';
      }
      html += '</div>';
    }
    html += '<hr class="pb-checkout-hr" />';
    if (preview.summary) {
      html += '<table class="pb-checkout-summary-table"><tbody>';
      html += '<tr class="pb-summary-row"><td>Items</td><td>' + escapeHtml(String(preview.summary.totalItems || 0)) + '</td></tr>';
      if (preview.summary.discountPercent != null) html += '<tr class="pb-summary-row"><td>Discount</td><td>' + escapeHtml(String(preview.summary.discountPercent)) + '% OFF</td></tr>';
      html += '<tr class="pb-summary-row"><td>Shipping</td><td>FREE</td></tr>';
      html += '<tr class="pb-summary-row pb-subtotal"><td>Subtotal</td><td>$' + escapeHtml(String(preview.summary.subtotal || '')) + ' ' + cur + '</td></tr>';
      if (preview.summary.discountAmount != null) html += '<tr class="pb-summary-row pb-savings"><td>Savings</td><td>- $' + escapeHtml(String(preview.summary.discountAmount)) + ' ' + cur + '</td></tr>';
      html += '<tr class="pb-summary-row pb-total"><td>Total</td><td>$' + escapeHtml(String(preview.summary.total || '')) + ' ' + cur + '</td></tr>';
      html += '</tbody></table>';
    }
    html += '<div class="pb-gst-note">GST included</div>';
    if (preview.checkoutUrl) html += '<a href="' + escapeHtml(preview.checkoutUrl) + '" target="_blank" rel="noopener noreferrer" class="pb-checkout-button" style="' + btnStyle + '">GO TO CHECKOUT</a>';
    else html += '<span class="pb-checkout-button pb-checkout-button-disabled" aria-disabled="true" style="' + btnStyle + '">GO TO CHECKOUT</span>';
    html += '</div>';
    return html;
  }
`;
