/**
 * Widget controller module - Main widget logic, state management, network requests
 */
export const controller = String.raw`
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
    var config = widgetData.config;

    // Use unique ID for scoping CSS to avoid conflicts
    var widgetUniqueId = 'profitbot-' + widgetId.replace(/[^a-z0-9]/gi, '-');
    container.setAttribute('data-profitbot-id', widgetUniqueId);
    
    /* Inject CSS into document head with scoped selectors */
    var css = getWidgetCSS(config, widgetUniqueId);
    if (typeof css !== 'string') {
      console.error('[ProfitBot] CSS is not a string! Type:', typeof css, 'Value:', css);
      // Try to convert if it's an array
      if (Array.isArray(css)) {
        css = css.join('\n');
      } else {
        console.error('[ProfitBot] Cannot convert CSS to string, aborting widget render');
        return;
      }
    }
    if (css.length < 1000) {
      console.warn('[ProfitBot] ⚠️ CSS is very short (' + css.length + ' chars), might be incomplete!');
    }

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

    // Verify CSS was injected
    setTimeout(function() {
      var injected = document.getElementById(existingStyleId);
      if (injected && injected.sheet) {
        // CSS stylesheet loaded successfully
      } else {
        console.error('[ProfitBot] ✗ CSS stylesheet not found or not loaded!');
      }
    }, 100);
    
    // Verify CSS values
    var b = config.bubble || {};
    var bubbleSize = b.bubbleSizePx || 60;
    var bubbleRight = b.rightPositionPx || 20;
    var bubbleBottom = b.bottomPositionPx || 20;
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
      sessionId: getSessionId(),
      pollTimer: null,
      lastMessageCount: 0,
      localIdCounter: 0,
      isStreaming: false,
      streamingMsgId: null,
      scrollFabEl: null,
      pollingActive: false,
      pollingAttempts: 0,
      maxPollingAttempts: 10 // Stop polling after 10 attempts (30 seconds) if no new messages
    };

    function nextLocalId() { return ++state.localIdCounter; }

    /* Main wrapper */
    var wrapper = el('div', { className: 'pb-wrapper' });
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

    /* Ensure checkout button opens URL (delegated; works even if host or iframe blocks default) */
    if (messagesArea) {
      messagesArea.addEventListener('click', function(e) {
        var link = e.target && e.target.closest ? e.target.closest('a.pb-checkout-button') : null;
        if (link && link.href && link.href.indexOf('http') === 0) {
          e.preventDefault();
          e.stopPropagation();
          window.open(link.href, '_blank', 'noopener,noreferrer');
        }
      });
    }

    /* Tooltip */
    var tooltip = createTooltip(config, state, function() { openChat(); });

    /* Bubble */
    var bubble = createBubble(config, function() {
      if (state.isOpen) closeChat(); else openChat();
    });

    /* Bottom row: tooltip + bubble */
    var bottomRow = el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '12px', position: 'relative', zIndex: '10' } });
    if (tooltip) bottomRow.appendChild(tooltip);
    bottomRow.appendChild(bubble);
    wrapper.appendChild(bottomRow);

    // Immediate check of computed styles
    setTimeout(function() {
      var computed = window.getComputedStyle(bubble);

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
      }
    }, 100);

    /* Fetch visitor name */
    fetch(base + '/api/widgets/' + widgetId + '/visitor?session_id=' + encodeURIComponent(state.sessionId))
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
      state._openingChat = true;
      fetchMessages(true);
      // After window animation (250ms) settles, do a single smooth scroll
      setTimeout(function() {
        state._openingChat = false;
        scrollToBottom(true);
      }, 300);
      // Don't start continuous polling - only poll when messages are sent
      // Initial fetchMessages(true) loads existing messages
      dispatchEvent('profitbot:chat-opened');
    }

    function closeChat() {
      state.isOpen = false;
      bubble.classList.remove('pb-open');
      bubble.setAttribute('aria-label', 'Open chat');
      bubble.setAttribute('aria-expanded', 'false');
      chatWin.classList.add('pb-closing');
      stopPolling(); // Stop polling when chat is closed
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
        document.dispatchEvent(new CustomEvent(name, { detail: Object.assign({ widgetId: widgetId, sessionId: state.sessionId }, detail || {}) }));
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
          var wRow = el('div', { className: 'pb-msg-row pb-no-anim' });
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

      /* Always sync starter prompts visibility with message state */
      if (state.messages.length > 0) {
        hideStarterPrompts();
      }

      requestAnimationFrame(function() {
        if (state._openingChat && messagesArea) {
          // Snap to bottom instantly during open animation so user sees bottom right away
          messagesArea.scrollTop = messagesArea.scrollHeight;
        } else {
          scrollToBottom(forceAll);
        }
      });
    }

    var starterPromptsUsed = false; // Once any message is sent, never show starters again

    function hideStarterPrompts() {
      state.showStarterPrompts = false;
      starterPromptsUsed = true;
      if (startersArea) {
        startersArea.style.display = 'none';
        startersArea.innerHTML = '';
      }
    }

    function updateStarterPrompts() {
      if (!startersArea) return;
      // Once conversation has started, never show starters again
      if (starterPromptsUsed || state.messages.length > 0) {
        hideStarterPrompts();
        return;
      }
      var prompts = (config.window && config.window.starterPrompts) || [];
      var filtered = prompts.filter(function(p) { return p && p.trim(); });
      // Show starter prompts only if no messages exist and flag is true
      if (state.showStarterPrompts && filtered.length > 0) {
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
      if (!widgetId || !state.sessionId || state.sessionId === 'preview') {
        console.warn('[ProfitBot] Cannot fetch messages - missing widgetId or sessionId. widgetId:', widgetId, 'sessionId:', state.sessionId);
        return;
      }
      // Don't fetch messages while streaming (polling will resume after stream completes)
      if (state.isStreaming && !forceRefresh) {
        return;
      }
      if (forceRefresh) state.messagesLoading = true;

      var url = base + '/api/widgets/' + widgetId + '/messages?session_id=' + encodeURIComponent(state.sessionId);

      fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        credentials: 'omit'
      })
        .then(function(res) {
          if (!res.ok) {
            throw new Error('Failed to fetch messages: ' + res.status + ' ' + res.statusText);
          }
          return res.json();
        })
        .then(function(data) {
          var list = Array.isArray(data.messages) ? data.messages : [];
          // Dedupe by id in case API returns the same message twice
          var seenIds = {};
          list = list.filter(function(m) {
            if (!m.id) return true;
            if (seenIds[m.id]) return false;
            seenIds[m.id] = true;
            return true;
          });

          // Clear messagesLoading before rendering so the spinner is removed
          state.messagesLoading = false;

          if (forceRefresh || state.messages.length === 0) {
            // If we have local (unsaved) messages and server list is shorter, server may not have latest yet — don't overwrite
            var hasLocal = false;
            for (var i = 0; i < state.messages.length; i++) { if (!state.messages[i].id) { hasLocal = true; break; } }
            if (!hasLocal || list.length >= state.messages.length) {
              var mapped = list.map(function(m) {
                return { id: m.id, _localId: nextLocalId(), role: m.role === 'user' ? 'user' : 'bot', content: m.content, avatarUrl: m.avatarUrl, checkoutPreview: m.checkoutPreview, createdAt: m.createdAt };
              });
              state.messages = mergePreservingCheckoutPreview(mapped, state.messages);
              state.showStarterPrompts = list.length === 0;
              if (forceRefresh) {
                state.renderedIds = {};
                renderMessages(true);
              } else {
                renderMessages();
              }
            }
          } else if (list.length > state.messages.length) {
            // If we have any local (unsaved) messages, server list is source of truth — replace to avoid duplicates
            var hasLocalMessages = false;
            for (var j = 0; j < state.messages.length; j++) {
              if (!state.messages[j].id) { hasLocalMessages = true; break; }
            }
            if (hasLocalMessages) {
              var mappedLocal = list.map(function(m) {
                return { id: m.id, _localId: nextLocalId(), role: m.role === 'user' ? 'user' : 'bot', content: m.content, avatarUrl: m.avatarUrl, checkoutPreview: m.checkoutPreview, createdAt: m.createdAt };
              });
              state.messages = mergePreservingCheckoutPreview(mappedLocal, state.messages);
              state.showStarterPrompts = false;
              state.renderedIds = {};
              renderMessages(true);
            } else {
              var existingIds = {};
              for (var j = 0; j < state.messages.length; j++) {
                if (state.messages[j].id) existingIds[state.messages[j].id] = true;
              }
              var newMsgs = list.filter(function(m) { return m.id && !existingIds[m.id]; }).map(function(m) {
                return { id: m.id, _localId: nextLocalId(), role: m.role === 'user' ? 'user' : 'bot', content: m.content, avatarUrl: m.avatarUrl, checkoutPreview: m.checkoutPreview, createdAt: m.createdAt };
              });
              if (newMsgs.length > 0) {
                state.messages = state.messages.concat(newMsgs);
                state.showStarterPrompts = false; // Hide starter prompts when new messages arrive
                renderMessages();
              }
            }
          } else if (list.length === state.messages.length && list.length > 0) {
            /* Content may have changed (e.g. checkout preview added) */
            var changed = false;
            for (var k = 0; k < list.length; k++) {
              if (list[k].checkoutPreview && !state.messages[k].checkoutPreview) { changed = true; break; }
            }
            if (changed) {
              var mappedChanged = list.map(function(m) {
                return { id: m.id, _localId: nextLocalId(), role: m.role === 'user' ? 'user' : 'bot', content: m.content, avatarUrl: m.avatarUrl, checkoutPreview: m.checkoutPreview, createdAt: m.createdAt };
              });
              state.messages = mergePreservingCheckoutPreview(mappedChanged, state.messages);
              state.showStarterPrompts = false; // Hide starter prompts when messages exist
              state.renderedIds = {};
              renderMessages(true);
            }
          }
          
          // Ensure starter prompts are hidden if messages exist (regardless of how we got here)
          if (state.messages.length > 0) {
            state.showStarterPrompts = false;
          }

          // Don't show typing when we already have the full response (same message count, last is bot)
          var lastFromServer = list.length > 0 ? list[list.length - 1] : null;
          var serverSaysTyping = !!data.agentTyping;
          if (serverSaysTyping && list.length === state.messages.length && lastFromServer && (lastFromServer.role === 'bot' || lastFromServer.role === 'assistant')) {
            serverSaysTyping = false;
          }
          state.agentTyping = serverSaysTyping;
          state.agentAvatarUrl = data.agentAvatarUrl || null;
          
          // If we received new messages, reset polling attempts (keep polling)
          // If no new messages and we've been polling, we'll stop after max attempts
          var hadNewMessages = list.length > state.lastMessageCount;
          if (hadNewMessages) {
            state.pollingAttempts = 0; // Reset counter - new messages mean we should keep polling
          }
          
          state.lastMessageCount = list.length;
          updateStarterPrompts();
        })
        .catch(function(err) {
          console.error('[ProfitBot] Error fetching messages:', err);
          state.messagesLoading = false;
          renderMessages();
        });
    }

    function startPolling() {
      stopPolling();
      if (!widgetId || !state.sessionId || state.sessionId === 'preview') return;
      // Don't poll while streaming to avoid race conditions
      if (state.isStreaming) {
        return;
      }
      // Reset polling attempts when starting fresh
      state.pollingAttempts = 0;
      state.pollingActive = true;

      state.pollTimer = setInterval(function() { 
        // Double-check streaming state before each poll
        if (state.isStreaming) {
          return;
        }
        // Stop polling if we've exceeded max attempts
        if (state.pollingAttempts >= state.maxPollingAttempts) {
          stopPolling();
          return;
        }
        state.pollingAttempts++;
        fetchMessages(); 
      }, 3000);
    }

    function stopPolling() {
      if (state.pollTimer) { 
        clearInterval(state.pollTimer); 
        state.pollTimer = null; 
        state.pollingActive = false;
        state.pollingAttempts = 0;
      }
    }

    function handleRefresh(btn) {
      if (state.messagesLoading) {
        return;
      }
      state.messagesLoading = true;
      state.messages = [];
      state.renderedIds = {};
      renderMessages(true);
      /* Spin icon */
      var svgIcon = btn.querySelector('svg');
      if (svgIcon) svgIcon.classList.add('pb-spin');
      btn.disabled = true;
      
      // Ensure we have a valid sessionId before fetching (re-read from cookie/localStorage)
      state.sessionId = getSessionId();
      if (!state.sessionId || state.sessionId === 'preview') return;
      
      fetchMessages(true);
      setTimeout(function() {
        if (svgIcon) svgIcon.classList.remove('pb-spin');
        btn.disabled = false;
        // Don't start continuous polling after refresh - only poll when messages are sent
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
                // Check for done flag first (n8n SSE format: data: {"done":true})
                if (parsed.done === true) {
                  streamDone = true;
                  continue;
                }
                // Support n8n token format: data: {"token":"Hello"}
                // Also support other formats: text, content, delta
                var chunk = parsed.token || parsed.text || parsed.content || parsed.delta || '';
                if (chunk && typeof chunk === 'string') {
                  for (var ci = 0; ci < chunk.length; ci++) charQueue.push(chunk[ci]);
                }
              } catch (e) {
                // If JSON parsing fails, treat as plain text (fallback)
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
      state.loading = true;
      hideStarterPrompts();
      renderMessages();
      inputEl.disabled = true;
      sendBtn.disabled = true;
      requestAnimationFrame(function() { scrollToBottom(true); });

      dispatchEvent('profitbot:message-sent', { message: trimmed });

      /* NOTE: Don't start polling here — wait until after the bot response arrives.
         Starting polling before the response causes duplicate messages because
         fetchMessages() sees server-saved messages as "new" (they have real IDs)
         while local messages have id:null and aren't matched by dedup logic.
         Polling is started in finishSend() / streaming onDone to catch
         subsequent human agent replies or delayed bot responses. */

      /* Get conversation ID and send */
      var conversationId = null;
      var backend = config.chatBackend || 'n8n';
      var useN8n = backend === 'n8n' && !!(config.n8nWebhookUrl && config.n8nWebhookUrl.trim());
      fetch(base + '/api/widgets/' + widgetId + '/conversation?session_id=' + encodeURIComponent(state.sessionId))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.conversationId) conversationId = data.conversationId;
          /* Save user message only for n8n (direct LLM /chat endpoint saves it internally) */
          if (conversationId && useN8n) {
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
      var backend = config.chatBackend || 'n8n';
      var useN8n = backend === 'n8n' && !!(config.n8nWebhookUrl && config.n8nWebhookUrl.trim());

      if (useN8n) {
        sendToN8n(message, conversationId);
      } else {
        sendToDirectChat(message, conversationId);
      }
    }

    function buildSystemPrompt() {
      // Send only Role + Tone as the system prompt.
      // All other rules/instructions are stored in RAG and retrieved per-query server-side.
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
      // IMPORTANT: This calls n8n directly (not through Vercel) to avoid Vercel streaming costs
      // n8n is a fixed monthly cost, so streaming from n8n is cost-effective
      // 
      // n8n Setup Requirements:
      // 1. Use "Respond to Webhook" node (NOT "Respond immediately")
      // 2. Set Content-Type: text/event-stream header
      // 3. Send SSE format: data: {"token":"Hello"} data: {"token":"world"} data: {"done":true}
      // 4. Note: Streaming works best on self-hosted n8n. n8n Cloud may buffer responses behind Cloudflare
      var body = { message: message, sessionId: state.sessionId, widgetId: widgetId };
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
          // Check for SSE streaming: n8n should send Content-Type: text/event-stream
          // Expected format: data: {"token":"Hello"} data: {"token":"world"} data: {"done":true}
          var isSSE = contentType.includes('text/event-stream');
          var isStreaming = res.ok && res.body && (isSSE || !contentType.includes('application/json'));
          
          if (isStreaming) {
            // Stop polling while streaming to avoid race conditions
            stopPolling();
            /* Streaming response from n8n (direct call, not proxied through Vercel) */
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
              // Sync with database after streaming completes, then start polling
              // for subsequent human agent replies
              setTimeout(function() {
                fetchMessages(true);
                startPolling();
              }, 2000);
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

    function sendToDirectChat(message, conversationId) {
      fetch(base + '/api/widgets/' + widgetId + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message, sessionId: state.sessionId, conversationId: conversationId })
      })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.error) {
            finishSend(config.window.customErrorMessage || 'Error: ' + data.error);
          } else {
            var reply = data.message || data.content || data.reply || data.output || '';
            var checkoutPreview = data.checkoutPreview || null;
            finishSend(reply || config.window.customErrorMessage, checkoutPreview);
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
      state.agentTyping = false;
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
      stopPolling();
      if (reply) {
        // Avoid duplicate bot message if finishSend is ever called twice (e.g. race with openChat fetch)
        var last = state.messages[state.messages.length - 1];
        var isDuplicate = last && last.role === 'bot' && last.content === reply && !last.id;
        if (!isDuplicate) {
          state.messages.push({ id: null, _localId: nextLocalId(), role: 'bot', content: reply, checkoutPreview: checkoutPreview || undefined, createdAt: new Date().toISOString() });
        }
      }
      renderMessages();
      // Silent sync: replace local state with DB data so server is source of truth (fixes any duplicates)
      setTimeout(function() {
        silentSync();
        startPolling();
      }, 2000);
    }

    /** Keep existing checkoutPreview (images + button) when server returns message without it (e.g. sync before preview linked). */
    function mergePreservingCheckoutPreview(serverList, previous) {
      if (!previous || previous.length === 0) return serverList;
      var byId = {};
      for (var i = 0; i < previous.length; i++) {
        var m = previous[i];
        if (m.id) byId[m.id] = m;
      }
      function hasGoodPreview(p) {
        return p && p.checkoutPreview && typeof p.checkoutPreview.checkoutUrl === 'string' && p.checkoutPreview.checkoutUrl.trim();
      }
      return serverList.map(function(m, idx) {
        var prev = m.id ? byId[m.id] : null;
        if (!prev && idx < previous.length && previous[idx].role === 'bot') prev = previous[idx];
        if (!prev || !hasGoodPreview(prev)) return m;
        var serverPreview = m.checkoutPreview;
        var hasServerUrl = serverPreview && typeof serverPreview.checkoutUrl === 'string' && serverPreview.checkoutUrl.trim();
        var hasServerImages = serverPreview && Array.isArray(serverPreview.lineItemsUI) && serverPreview.lineItemsUI.length > 0 && serverPreview.lineItemsUI.some(function(it) { return it && String(it.imageUrl || it.image_url || '').trim(); });
        if (hasServerUrl && hasServerImages) return m;
        return { id: m.id, _localId: m._localId, role: m.role, content: m.content, avatarUrl: m.avatarUrl, checkoutPreview: prev.checkoutPreview, createdAt: m.createdAt };
      });
    }

    function silentSync() {
      if (!widgetId || !state.sessionId || state.sessionId === 'preview') return;
      var url = base + '/api/widgets/' + widgetId + '/messages?session_id=' + encodeURIComponent(state.sessionId);
      fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' }, credentials: 'omit' })
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
          if (!data) return;
          var list = Array.isArray(data.messages) ? data.messages : [];
          var seenIds = {};
          list = list.filter(function(m) {
            if (!m.id) return true;
            if (seenIds[m.id]) return false;
            seenIds[m.id] = true;
            return true;
          });
          if (list.length > 0) {
            var mapped = list.map(function(m) {
              return { id: m.id, _localId: nextLocalId(), role: m.role === 'user' ? 'user' : 'bot', content: m.content, avatarUrl: m.avatarUrl, checkoutPreview: m.checkoutPreview, createdAt: m.createdAt };
            });
            state.messages = mergePreservingCheckoutPreview(mapped, state.messages);
            state.lastMessageCount = list.length;
            state.renderedIds = {};
            renderMessages(true);
          }
          var lastFromServer = list.length > 0 ? list[list.length - 1] : null;
          var serverSaysTyping = !!data.agentTyping;
          if (serverSaysTyping && list.length === state.messages.length && lastFromServer && (lastFromServer.role === 'bot' || lastFromServer.role === 'assistant')) {
            serverSaysTyping = false;
          }
          state.agentTyping = serverSaysTyping;
          state.agentAvatarUrl = data.agentAvatarUrl || null;
        })
        .catch(function() {});
    }

    /* ===== INIT ===== */
    // Re-read session from cookie/localStorage so we use persisted session after refresh
    state.sessionId = getSessionId();
    // Small delay to ensure DOM is fully ready
    // Only fetch messages initially, don't start polling until chat is opened
    setTimeout(function() {
      state.sessionId = getSessionId();
      fetchMessages(true);
      // Don't start polling here - wait until chat is opened
    }, 100);
    updateStarterPrompts();
    dispatchEvent('profitbot:ready');

    // Verify bubble is in DOM and styles are applied
    setTimeout(function() {
      var bubbleEl = container.querySelector('.pb-bubble');
      var wrapperEl = container.querySelector('.pb-wrapper');
      
      if (wrapperEl) {
        var wrapperStyles = window.getComputedStyle(wrapperEl);
        var wrapperRect = wrapperEl.getBoundingClientRect();

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
        var bubbleStyles = window.getComputedStyle(bubbleEl);
        var rect = bubbleEl.getBoundingClientRect();

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
`;
