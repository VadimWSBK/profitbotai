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

    var col = el('div', { style: { display: 'flex', flexDirection: 'column', maxWidth: '90%', minWidth: '0' } });

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
`;
