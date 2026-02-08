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
    console.log('[ProfitBot] CSS type:', typeof css);
    console.log('[ProfitBot] CSS is array:', Array.isArray(css));
    if (typeof css !== 'string') {
      console.error('[ProfitBot] CSS is not a string! Type:', typeof css, 'Value:', css);
      // Try to convert if it's an array
      if (Array.isArray(css)) {
        css = css.join('\n');
        console.log('[ProfitBot] Converted array to string, new length:', css.length);
      } else {
        console.error('[ProfitBot] Cannot convert CSS to string, aborting widget render');
        return;
      }
    }
    console.log('[ProfitBot] Injecting CSS into document head, length:', css.length);
    if (css.length < 1000) {
      console.warn('[ProfitBot] ⚠️ CSS is very short (' + css.length + ' chars), might be incomplete!');
      console.log('[ProfitBot] Full CSS:', css);
    } else {
      console.log('[ProfitBot] CSS preview (first 500 chars):', css.substring(0, 500));
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
    console.log('[ProfitBot] CSS injected into document head');
    
    // Verify CSS was injected
    setTimeout(function() {
      var injected = document.getElementById(existingStyleId);
      if (injected && injected.sheet) {
        console.log('[ProfitBot] ✓ CSS stylesheet loaded, rules:', injected.sheet.cssRules?.length || 0);
      } else {
        console.error('[ProfitBot] ✗ CSS stylesheet not found or not loaded!');
      }
    }, 100);
    
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
      // Hide starter prompts if there are any messages (chat has been initiated)
      if (state.messages.length > 0) {
        state.showStarterPrompts = false;
        startersArea.style.display = 'none';
        return;
      }
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
      if (!widgetId || !sessionId || sessionId === 'preview') {
        console.warn('[ProfitBot] Cannot fetch messages - missing widgetId or sessionId. widgetId:', widgetId, 'sessionId:', sessionId);
        return;
      }
      if (forceRefresh) state.messagesLoading = true;

      var url = base + '/api/widgets/' + widgetId + '/messages?session_id=' + encodeURIComponent(sessionId);
      console.log('[ProfitBot] Fetching messages from:', url);
      
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
          console.log('[ProfitBot] Messages fetched successfully, count:', Array.isArray(data.messages) ? data.messages.length : 0);
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
              state.showStarterPrompts = false; // Hide starter prompts when new messages arrive
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
              state.showStarterPrompts = false; // Hide starter prompts when messages exist
              state.renderedIds = {};
              renderMessages(true);
            }
          }
          
          // Ensure starter prompts are hidden if messages exist (regardless of how we got here)
          if (state.messages.length > 0) {
            state.showStarterPrompts = false;
          }

          state.agentTyping = !!data.agentTyping;
          state.agentAvatarUrl = data.agentAvatarUrl || null;
          state.lastMessageCount = list.length;
          state.messagesLoading = false;
          updateStarterPrompts();
        })
        .catch(function(err) {
          console.error('[ProfitBot] Error fetching messages:', err);
          console.error('[ProfitBot] Error details - widgetId:', widgetId, 'sessionId:', sessionId, 'base:', base);
          state.messagesLoading = false;
          // Retry once after a short delay if this was a force refresh
          if (forceRefresh) {
            console.log('[ProfitBot] Retrying message fetch after 1 second...');
            setTimeout(function() {
              fetchMessages(true);
            }, 1000);
          }
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
      if (state.messagesLoading) {
        console.log('[ProfitBot] Refresh already in progress, skipping...');
        return;
      }
      console.log('[ProfitBot] Refresh triggered. Session ID:', sessionId);
      state.messagesLoading = true;
      state.messages = [];
      state.renderedIds = {};
      renderMessages(true);
      /* Spin icon */
      var svgIcon = btn.querySelector('svg');
      if (svgIcon) svgIcon.classList.add('pb-spin');
      btn.disabled = true;
      
      // Ensure we have a valid sessionId before fetching
      if (!sessionId || sessionId === 'preview') {
        sessionId = getSessionId();
        console.log('[ProfitBot] Refreshed sessionId:', sessionId);
      }
      
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
      // IMPORTANT: This calls n8n directly (not through Vercel) to avoid Vercel streaming costs
      // n8n is a fixed monthly cost, so streaming from n8n is cost-effective
      console.log('[ProfitBot] Calling n8n webhook directly:', n8nUrl);
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
    console.log('[ProfitBot] Widget initialization complete. Session ID:', sessionId);
    console.log('[ProfitBot] Starting initial message fetch...');
    // Small delay to ensure DOM is fully ready and sessionId is set
    // Only fetch messages initially, don't start polling until chat is opened
    setTimeout(function() {
      fetchMessages(true);
      // Don't start polling here - wait until chat is opened
    }, 100);
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
`;
