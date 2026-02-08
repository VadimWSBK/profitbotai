/**
 * Native embed script - fully functional widget without iframe
 * Uses Shadow DOM for CSS isolation, similar to GoHighLevel widget
 * Includes: chat, messages, polling, streaming, checkout previews, tooltips, etc.
 */
const EMBED_SCRIPT = String.raw`
(function() {
  'use strict';
  
  var script = document.currentScript;
  if (!script) return;
  var widgetId = script.getAttribute('data-widget-id');
  if (!widgetId || widgetId === 'YOUR_WIDGET_ID') {
    console.warn('[ProfitBot] Missing or invalid data-widget-id. Replace with your widget ID from the Embed tab.');
    return;
  }
  var src = script.getAttribute('src') || '';
  var base = src.replace(/\/embed\/chat-widget-native\.js.*$/, '');
  if (!base) return;

  // Prevent duplicate loading
  if (window.__profitbot_widget_loaded && window.__profitbot_widget_loaded[widgetId]) {
    return;
  }
  if (!window.__profitbot_widget_loaded) {
    window.__profitbot_widget_loaded = {};
  }
  window.__profitbot_widget_loaded[widgetId] = true;

  // Session management
  function getSessionId() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('session_id');
    if (fromUrl) return fromUrl.trim();
    var key = 'profitbot_session_' + widgetId;
    try {
      var stored = localStorage.getItem(key);
      if (stored && stored.trim()) return stored.trim();
    } catch (e) {
      // ignore
    }
    var newId = 'visitor_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);
    try {
      localStorage.setItem(key, newId);
    } catch (e) {
      // ignore
    }
    return newId;
  }

  // Message formatting utilities
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMessage(content) {
    if (!content || typeof content !== 'string') return '';
    // Convert markdown links [text](url) to HTML
    content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(match, text, url) {
      var isCta = /buy\s*now|complete\s*your\s*purchase|go\s*to\s*checkout/i.test(text);
      var linkClass = isCta ? 'chat-message-link chat-cta-button' : 'chat-message-link underline';
      return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" class="' + linkClass + '">' + escapeHtml(text) + '</a>';
    });
    // Convert raw URLs to links
    content = content.replace(/(https?:\/\/[^\s<>"']+)/g, function(url) {
      if (content.indexOf('href="' + url) >= 0) return url; // Already a link
      return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" class="chat-message-link underline">' + escapeHtml(url) + '</a>';
    });
    // Convert line breaks
    content = content.replace(/\n/g, '<br />');
    return content;
  }

  function formatTimestamp(createdAt) {
    if (!createdAt) return '';
    try {
      var date = new Date(createdAt);
      if (isNaN(date.getTime())) return '';
      var now = new Date();
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      var diffDays = Math.floor((today.getTime() - messageDate.getTime()) / (1000 * 60 * 60 * 24));
      var timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      if (diffDays === 0) return timeStr;
      if (diffDays === 1) return 'Yesterday ' + timeStr;
      if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + timeStr;
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (e) {
      return '';
    }
  }

  function initWidget() {
    if (!document.body) {
      setTimeout(initWidget, 10);
      return;
    }

    // Create container for widget (will use Shadow DOM)
    var container = document.createElement('div');
    container.id = 'profitbot-widget-' + widgetId;
    container.setAttribute('data-profitbot-widget', widgetId);
    document.body.appendChild(container);

    // Fetch widget config
    fetch(base + '/api/widgets/' + encodeURIComponent(widgetId))
      .then(function(res) {
        if (!res.ok) throw new Error('Widget not found');
        return res.json();
      })
      .then(function(widgetData) {
        if (!widgetData || !widgetData.config) {
          throw new Error('Invalid widget config');
        }
        renderWidget(container, widgetData);
      })
      .catch(function(err) {
        console.error('[ProfitBot] Failed to load widget:', err);
        container.remove();
      });
  }

  function renderWidget(container, widgetData) {
    var config = widgetData.config;
    var widgetId = widgetData.id;
    var sessionId = getSessionId();
    
    // Create Shadow DOM for CSS isolation
    var shadow = container.attachShadow({ mode: 'open' });
    
    // Create widget wrapper
    var wrapper = document.createElement('div');
    wrapper.className = 'profitbot-widget-wrapper';
    shadow.appendChild(wrapper);

    // Inject CSS (scoped to shadow DOM)
    var style = document.createElement('style');
    style.textContent = getWidgetCSS(config);
    shadow.appendChild(style);

    // Widget state
    var state = {
      isOpen: false,
      isMobile: window.innerWidth <= 768,
      messages: [],
      loading: false,
      agentTyping: false,
      agentAvatarUrl: null,
      visitorName: null,
      showStarterPrompts: true,
      sessionId: sessionId,
      pollTimer: null,
      lastMessageCount: 0,
      shopifyContext: null
    };

    // Fetch visitor name
    fetch(base + '/api/widgets/' + widgetId + '/visitor?session_id=' + encodeURIComponent(sessionId))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data && data.name && typeof data.name === 'string' && data.name.trim()) {
          state.visitorName = data.name.trim();
          updateWelcomeMessage();
        }
      })
      .catch(function() {});

    // Create bubble button
    var bubble = createBubble(config, function() {
      state.isOpen = !state.isOpen;
      updateWidget();
      if (state.isOpen) {
        input.focus();
        fetchMessages(true);
      }
    });
    wrapper.appendChild(bubble);

    // Create tooltip
    var tooltip = null;
    if (config.tooltip && config.tooltip.displayTooltip) {
      tooltip = createTooltip(config, function() {
        state.isOpen = true;
        updateWidget();
        input.focus();
        fetchMessages(true);
      });
      wrapper.appendChild(tooltip);
    }

    // Create chat window
    var chatWindow = createChatWindow(config, widgetId, state, function() {
      state.isOpen = false;
      updateWidget();
    });
    chatWindow.style.display = 'none';
    wrapper.appendChild(chatWindow);

    var messagesArea = chatWindow.querySelector('.profitbot-messages');
    var input = chatWindow.querySelector('.profitbot-input');
    var sendBtn = chatWindow.querySelector('.profitbot-send-btn');
    var welcomeArea = chatWindow.querySelector('.profitbot-welcome');
    var starterPromptsArea = chatWindow.querySelector('.profitbot-starter-prompts');

    function updateWidget() {
      if (state.isOpen) {
        chatWindow.style.display = 'block';
        bubble.classList.add('open');
        if (tooltip) tooltip.style.display = 'none';
      } else {
        chatWindow.style.display = 'none';
        bubble.classList.remove('open');
        if (tooltip && config.tooltip.displayTooltip && !state.isOpen) {
          tooltip.style.display = 'block';
        }
      }
    }

    function updateWelcomeMessage() {
      if (!welcomeArea) return;
      var winConfig = config.window || {};
      var welcomeText = winConfig.welcomeMessage || 'Hi! How can I help you today?';
      var firstName = state.visitorName ? state.visitorName.split(/\s+/)[0] : '';
      welcomeText = welcomeText.replace(/\{first_name\}/gi, firstName || 'there');
      welcomeText = welcomeText.replace(/\{name\}/gi, state.visitorName || 'there');
      welcomeArea.textContent = welcomeText;
    }

    function renderMessages() {
      if (!messagesArea) return;
      messagesArea.innerHTML = '';
      
      if (state.messages.length === 0 && !state.loading) {
        var welcomeMsg = document.createElement('div');
        welcomeMsg.className = 'profitbot-message profitbot-message-bot';
        var welcomeText = config.window?.welcomeMessage || 'Hi! How can I help you today?';
        var firstName = state.visitorName ? state.visitorName.split(/\\s+/)[0] : '';
        welcomeText = welcomeText.replace(/\\{first_name\\}/gi, firstName || 'there');
        welcomeText = welcomeText.replace(/\\{name\\}/gi, state.visitorName || 'there');
        welcomeMsg.innerHTML = formatMessage(welcomeText);
        welcomeMsg.style.cssText = getBotMessageStyle(config);
        messagesArea.appendChild(welcomeMsg);
      }

      state.messages.forEach(function(msg) {
        var msgEl = document.createElement('div');
        msgEl.className = 'profitbot-message profitbot-message-' + msg.role;
        
        if (msg.role === 'user') {
          msgEl.style.cssText = getUserMessageStyle(config);
          msgEl.textContent = msg.content;
        } else {
          msgEl.style.cssText = getBotMessageStyle(config);
          if (msg.checkoutPreview) {
            msgEl.innerHTML = renderCheckoutPreview(msg.checkoutPreview, msg.content);
          } else {
            msgEl.innerHTML = formatMessage(msg.content);
          }
        }
        
        messagesArea.appendChild(msgEl);
        
        if (msg.createdAt) {
          var timestamp = document.createElement('div');
          timestamp.className = 'profitbot-timestamp';
          timestamp.textContent = formatTimestamp(msg.createdAt);
          timestamp.style.cssText = 'font-size: 11px; opacity: 0.6; margin-top: 4px; padding: 0 4px;';
          msgEl.appendChild(timestamp);
        }
      });

      if (state.agentTyping) {
        var typingEl = document.createElement('div');
        typingEl.className = 'profitbot-message profitbot-message-bot profitbot-typing';
        typingEl.style.cssText = getBotMessageStyle(config);
        typingEl.innerHTML = '<div class="profitbot-typing-dots"><span></span><span></span><span></span></div>';
        messagesArea.appendChild(typingEl);
      }

      scrollToBottom();
    }

    function renderCheckoutPreview(preview, introText) {
      var html = '';
      if (introText && introText.trim()) {
        html += '<div class="profitbot-checkout-intro">' + formatMessage(introText) + '</div>';
      }
      html += '<div class="profitbot-checkout-preview">';
      html += '<div class="profitbot-checkout-header"><h3>Your checkout preview</h3><span>Product</span></div>';
      
      if (preview.lineItemsUI && Array.isArray(preview.lineItemsUI)) {
        preview.lineItemsUI.forEach(function(item) {
          html += '<div class="profitbot-line-item">';
          html += '<div class="profitbot-image-wrap">';
          if (item.imageUrl) {
            html += '<img src="' + escapeHtml(item.imageUrl) + '" alt="' + escapeHtml(item.title || '') + '" />';
          }
          html += '<span class="profitbot-qty-badge">' + escapeHtml(String(item.quantity || 1)) + '</span>';
          html += '</div>';
          html += '<div class="profitbot-details">';
          html += '<div class="profitbot-product-name">' + escapeHtml(item.title || '') + '</div>';
          if (item.variant) {
            html += '<div class="profitbot-product-variant">' + escapeHtml(item.variant) + '</div>';
          }
          html += '<div class="profitbot-price-row">';
          html += '<div class="profitbot-price-col"><div class="profitbot-price-label">Unit Price</div><div class="profitbot-price-value">' + escapeHtml(item.unitPrice || '') + '</div></div>';
          html += '<div class="profitbot-price-col"><div class="profitbot-price-label">Total</div><div class="profitbot-price-value">' + escapeHtml(item.lineTotal || '') + '</div></div>';
          html += '</div></div></div>';
        });
      }
      
      if (preview.summary) {
        html += '<div class="profitbot-checkout-summary">';
        html += '<div class="profitbot-summary-row"><span>Total Items</span><span>' + escapeHtml(String(preview.summary.totalItems || 0)) + ' items</span></div>';
        html += '<div class="profitbot-summary-row"><span>Shipping</span><span>FREE</span></div>';
        if (preview.summary.discountPercent != null) {
          html += '<div class="profitbot-summary-row"><span>Discount</span><span>' + escapeHtml(String(preview.summary.discountPercent)) + '% OFF</span></div>';
        }
        html += '<div class="profitbot-summary-row"><span>Subtotal</span><span>' + escapeHtml(preview.summary.subtotal || '') + ' ' + escapeHtml(preview.summary.currency || '') + '</span></div>';
        if (preview.summary.discountAmount != null) {
          html += '<div class="profitbot-summary-row"><span>Savings</span><span>-' + escapeHtml(preview.summary.discountAmount) + '</span></div>';
        }
        html += '<div class="profitbot-summary-row profitbot-summary-total"><span>Total</span><span>' + escapeHtml(preview.summary.total || '') + ' ' + escapeHtml(preview.summary.currency || '') + '</span></div>';
        html += '<div class="profitbot-summary-footer">GST included</div>';
        html += '</div>';
      }
      
      if (preview.checkoutUrl) {
        html += '<a href="' + escapeHtml(preview.checkoutUrl) + '" target="_blank" rel="noopener noreferrer" class="profitbot-cta-button">GO TO CHECKOUT</a>';
      }
      html += '</div>';
      return html;
    }

    function scrollToBottom() {
      if (messagesArea) {
        messagesArea.scrollTop = messagesArea.scrollHeight;
      }
    }

    function fetchMessages(forceRefresh) {
      if (!widgetId || !sessionId || sessionId === 'preview') return;
      
      fetch(base + '/api/widgets/' + widgetId + '/messages?session_id=' + encodeURIComponent(sessionId))
        .then(function(res) { return res.json(); })
        .then(function(data) {
          var list = Array.isArray(data.messages) ? data.messages : [];
          
          if (forceRefresh || state.messages.length === 0) {
            state.messages = list;
            state.showStarterPrompts = list.length === 0;
          } else if (list.length > state.messages.length) {
            var existingIds = new Set(state.messages.filter(function(m) { return m.id; }).map(function(m) { return m.id; }));
            var newMessages = list.filter(function(m) { return m.id && !existingIds.has(m.id); });
            state.messages = state.messages.concat(newMessages);
          } else if (list.length === state.messages.length && list.length > 0) {
            state.messages = list;
          }
          
          state.agentTyping = !!data.agentTyping;
          state.agentAvatarUrl = data.agentAvatarUrl || null;
          state.lastMessageCount = list.length;
          
          renderMessages();
          updateStarterPrompts();
        })
        .catch(function(err) {
          console.error('[ProfitBot] Error fetching messages:', err);
        });
    }

    function startPolling() {
      stopPolling();
      if (!widgetId || !sessionId || sessionId === 'preview') return;
      state.pollTimer = setInterval(function() {
        fetchMessages();
      }, 3000);
    }

    function stopPolling() {
      if (state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
      }
    }

    function updateStarterPrompts() {
      if (!starterPromptsArea) return;
      var prompts = config.window?.starterPrompts || [];
      var filtered = prompts.filter(function(p) { return p && p.trim(); });
      
      if (state.showStarterPrompts && filtered.length > 0 && state.messages.length === 0) {
        starterPromptsArea.innerHTML = '';
        filtered.forEach(function(prompt) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'profitbot-starter-prompt';
          btn.textContent = prompt;
          btn.onclick = function() {
            sendMessage(prompt);
          };
          starterPromptsArea.appendChild(btn);
        });
        starterPromptsArea.style.display = 'flex';
      } else {
        starterPromptsArea.style.display = 'none';
      }
    }

    function sendMessage(text) {
      var trimmed = text.trim();
      if (!trimmed || state.loading) return;
      
      state.messages.push({
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString()
      });
      state.showStarterPrompts = false;
      state.loading = true;
      renderMessages();
      
      if (input) input.value = '';
      updateStarterPrompts();
      scrollToBottom();

      // Get conversation ID
      var conversationId = null;
      fetch(base + '/api/widgets/' + widgetId + '/conversation?session_id=' + encodeURIComponent(sessionId))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.conversationId) conversationId = data.conversationId;
          
          // Save user message
          if (conversationId) {
            fetch(base + '/api/widgets/' + widgetId + '/messages/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                conversationId: conversationId,
                role: 'user',
                content: trimmed
              })
            }).catch(function() {});
          }
          
          // Send to n8n or direct chat
          var useN8n = !!(config.n8nWebhookUrl && config.n8nWebhookUrl.trim());
          if (useN8n) {
            sendToN8n(trimmed, conversationId);
          } else {
            sendToDirectChat(trimmed);
          }
        })
        .catch(function() {
          // Continue without conversation ID
          var useN8n = !!(config.n8nWebhookUrl && config.n8nWebhookUrl.trim());
          if (useN8n) {
            sendToN8n(trimmed, null);
          } else {
            sendToDirectChat(trimmed);
          }
        });
    }

    function sendToN8n(message, conversationId) {
      var n8nUrl = config.n8nWebhookUrl;
      if (!n8nUrl) {
        state.loading = false;
        addBotMessage(config.window?.customErrorMessage || 'Error: n8n webhook not configured');
        return;
      }

      var body = {
        message: message,
        sessionId: sessionId,
        widgetId: widgetId
      };
      if (conversationId) body.conversationId = conversationId;
      if (config.agentId) body.agentId = config.agentId;

      // Build system prompt
      var systemPrompt = null;
      if (config.agentSystemPrompt && config.agentSystemPrompt.trim()) {
        systemPrompt = config.agentSystemPrompt.trim();
      } else {
        var bot = config.bot || {};
        var parts = [];
        if (bot.role && bot.role.trim()) parts.push(bot.role.trim());
        if (bot.tone && bot.tone.trim()) parts.push('Tone: ' + bot.tone.trim());
        if (bot.instructions && bot.instructions.trim()) parts.push(bot.instructions.trim());
        if (parts.length > 0) systemPrompt = parts.join('\n\n');
      }
      if (systemPrompt) body.systemPrompt = systemPrompt;

      fetch(n8nUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
        .then(function(res) {
          var contentType = res.headers.get('content-type') || '';
          if (res.ok && res.body && !contentType.includes('application/json')) {
            // Streaming response
            handleStreamingResponse(res, function(content, checkoutPreview) {
              state.loading = false;
              if (content) {
                addBotMessage(content, checkoutPreview);
              } else {
                addBotMessage(config.window?.customErrorMessage || 'Error: No response received');
              }
              startPolling();
            });
          } else {
            // JSON response
            return res.json();
          }
        })
        .then(function(data) {
          if (!data) return;
          state.loading = false;
          var reply = data.output || data.message || data.reply || data.text || data.content || '';
          var checkoutPreview = data.checkoutPreview;
          if (typeof reply === 'object' && reply.content) reply = reply.content;
          if (reply && typeof reply === 'string' && reply.trim()) {
            addBotMessage(reply.trim(), checkoutPreview);
          } else {
            addBotMessage(config.window?.customErrorMessage || 'Error: Invalid response');
          }
          startPolling();
        })
        .catch(function(err) {
          console.error('[ProfitBot] n8n error:', err);
          state.loading = false;
          addBotMessage(config.window?.customErrorMessage || 'Error: Failed to send message');
          startPolling();
        });
    }

    function sendToDirectChat(message) {
      fetch(base + '/api/widgets/' + widgetId + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message,
          sessionId: sessionId
        })
      })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          state.loading = false;
          if (data.error) {
            addBotMessage(config.window?.customErrorMessage || 'Error: ' + (data.error || 'Failed to send message'));
          } else {
            // Direct chat returns message directly or in response
            var reply = data.message || data.content || data.reply || '';
            if (reply) {
              addBotMessage(reply);
            }
          }
          startPolling();
        })
        .catch(function(err) {
          console.error('[ProfitBot] Chat error:', err);
          state.loading = false;
          addBotMessage(config.window?.customErrorMessage || 'Error: Failed to send message');
          startPolling();
        });
    }

    function handleStreamingResponse(res, callback) {
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var content = '';
      var checkoutPreview = null;

      function processChunk() {
        reader.read().then(function(result) {
          if (result.done) {
            if (content.trim()) {
              callback(content.trim(), checkoutPreview);
            } else {
              callback(config.window?.customErrorMessage || 'Error: No response received', null);
            }
            return;
          }
          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          lines.forEach(function(line) {
            if (line.startsWith('data: ')) {
              var payload = line.slice(6).trim();
              if (payload === '[DONE]' || payload === '') return;
              try {
                var parsed = JSON.parse(payload);
                var chunk = parsed.text || parsed.content || parsed.delta || '';
                if (chunk && typeof chunk === 'string') {
                  content += chunk;
                  // Update streaming message
                  var lastMsg = state.messages[state.messages.length - 1];
                  if (lastMsg && lastMsg.role === 'bot' && !lastMsg.id) {
                    lastMsg.content = content;
                    renderMessages();
                  }
                }
                if (parsed.checkoutPreview) {
                  checkoutPreview = parsed.checkoutPreview;
                }
              } catch (e) {
                if (payload) {
                  content += payload;
                  var lastMsg = state.messages[state.messages.length - 1];
                  if (lastMsg && lastMsg.role === 'bot' && !lastMsg.id) {
                    lastMsg.content = content;
                    renderMessages();
                  }
                }
              }
            }
          });
          
          processChunk();
        }).catch(function(err) {
          console.error('[ProfitBot] Stream error:', err);
          callback(content.trim() || config.window?.customErrorMessage || 'Error: Stream failed', checkoutPreview);
        });
      }
      
      processChunk();
    }

    function addBotMessage(content, checkoutPreview) {
      if (!content && !checkoutPreview) return;
      var lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg && lastMsg.role === 'bot' && !lastMsg.id) {
        // Update existing streaming message
        lastMsg.content = content || '';
        lastMsg.checkoutPreview = checkoutPreview;
        lastMsg.createdAt = new Date().toISOString();
      } else {
        // Add new message
        state.messages.push({
          role: 'bot',
          content: content || '',
          checkoutPreview: checkoutPreview,
          createdAt: new Date().toISOString()
        });
      }
      renderMessages();
      startPolling();
    }

    // Initial load
    fetchMessages(true);
    startPolling();
    updateWelcomeMessage();
    updateStarterPrompts();

    // Handle form submit
    var form = chatWindow.querySelector('.profitbot-input-area');
    if (form) {
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        if (input && input.value) {
          sendMessage(input.value);
        }
      });
    }

    // Handle mobile resize
    window.addEventListener('resize', function() {
      var wasMobile = state.isMobile;
      state.isMobile = window.innerWidth <= 768;
      if (state.isMobile !== wasMobile) {
        updateWidget();
      }
    });

    // Handle Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && state.isOpen) {
        state.isOpen = false;
        updateWidget();
      }
    });

    // Listen for Shopify context (if available)
    window.addEventListener('message', function(e) {
      if (e.data && typeof e.data === 'object' && e.data.type && e.data.type.startsWith('shopify-')) {
        state.shopifyContext = e.data.data || null;
      }
    });

    // Request Shopify context
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'profitbot-context-request',
        widgetId: widgetId,
        sessionId: sessionId
      }, '*');
    }
  }

  function createBubble(config, onClick) {
    var bubble = document.createElement('button');
    bubble.className = 'profitbot-bubble';
    bubble.type = 'button';
    bubble.setAttribute('aria-label', 'Open chat');
    
    var bubbleConfig = config.bubble || {};
    var size = bubbleConfig.bubbleSizePx || 60;
    var bgColor = bubbleConfig.backgroundColor || '#3b82f6';
    var borderRadius = bubbleConfig.borderRadiusStyle === 'circle' ? '50%' : 
                      bubbleConfig.borderRadiusStyle === 'rounded' ? '16px' : '0';
    var rightPos = bubbleConfig.rightPositionPx || 20;
    var bottomPos = bubbleConfig.bottomPositionPx || 20;
    
    bubble.style.cssText = [
      'position: fixed',
      'bottom: ' + bottomPos + 'px',
      'right: ' + rightPos + 'px',
      'width: ' + size + 'px',
      'height: ' + size + 'px',
      'background-color: ' + bgColor,
      'border-radius: ' + borderRadius,
      'border: none',
      'cursor: pointer',
      'z-index: 2147483647',
      'box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25), 0 4px 8px rgba(0, 0, 0, 0.15)',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'transition: transform 0.2s',
      'pointer-events: auto'
    ].join('; ');

    // Add icon
    if (bubbleConfig.customIconUrl) {
      var img = document.createElement('img');
      img.src = bubbleConfig.customIconUrl;
      img.style.cssText = 'width: ' + (bubbleConfig.customIconSize || 50) + '%; height: ' + (bubbleConfig.customIconSize || 50) + '%; object-fit: contain; pointer-events: none;';
      img.onerror = function() {
        // Fallback to default icon
        bubble.innerHTML = '';
        addDefaultIcon(bubble, bubbleConfig.colorOfInternalIcons || '#ffffff');
      };
      bubble.appendChild(img);
    } else {
      addDefaultIcon(bubble, bubbleConfig.colorOfInternalIcons || '#ffffff');
    }

    bubble.addEventListener('click', onClick);
    return bubble;
  }

  function addDefaultIcon(container, color) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '50%');
    svg.setAttribute('height', '50%');
    svg.style.fill = color;
    svg.style.pointerEvents = 'none';
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z');
    svg.appendChild(path);
    container.appendChild(svg);
  }

  function createTooltip(config, onClick) {
    var tooltipConfig = config.tooltip || {};
    if (!tooltipConfig.displayTooltip) return null;

    var tooltip = document.createElement('div');
    tooltip.className = 'profitbot-tooltip';
    tooltip.setAttribute('role', 'button');
    tooltip.setAttribute('tabindex', '0');
    
    var message = tooltipConfig.message || 'Hi! How can I help?';
    tooltip.textContent = message;
    
    tooltip.style.cssText = [
      'position: fixed',
      'bottom: ' + ((config.bubble?.bottomPositionPx || 20) + (config.bubble?.bubbleSizePx || 60) + 12) + 'px',
      'right: ' + ((config.bubble?.rightPositionPx || 20) + (config.bubble?.bubbleSizePx || 60) + 12) + 'px',
      'background-color: ' + (tooltipConfig.backgroundColor || '#ffffff'),
      'color: ' + (tooltipConfig.textColor || '#111827'),
      'font-size: ' + (tooltipConfig.fontSizePx || 14) + 'px',
      'padding: 12px 16px',
      'border-radius: 10px',
      'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15)',
      'max-width: 220px',
      'cursor: pointer',
      'z-index: 2147483646',
      'pointer-events: auto'
    ].join('; ');

    tooltip.addEventListener('click', onClick);
    tooltip.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') onClick();
    });

    // Auto-hide after delay
    if (tooltipConfig.autoHideTooltip && tooltipConfig.autoHideDelaySeconds > 0) {
      setTimeout(function() {
        if (tooltip && tooltip.parentNode) {
          tooltip.style.display = 'none';
        }
      }, tooltipConfig.autoHideDelaySeconds * 1000);
    }

    return tooltip;
  }

  function createChatWindow(config, widgetId, state, onClose) {
    var win = document.createElement('div');
    win.className = 'profitbot-chat-window';
    
    var winConfig = config.window || {};
    var width = winConfig.widthPx || 400;
    var height = winConfig.heightPx || 600;
    var bgColor = winConfig.backgroundColor || '#ffffff';
    var borderRadius = winConfig.borderRadiusStyle === 'rounded' ? '12px' : '0';
    var bubbleSize = config.bubble?.bubbleSizePx || 60;
    var bottomPos = config.bubble?.bottomPositionPx || 20;
    
    win.style.cssText = [
      'position: fixed',
      'bottom: ' + (bubbleSize + bottomPos + 12) + 'px',
      'right: ' + (config.bubble?.rightPositionPx || 20) + 'px',
      'width: ' + width + 'px',
      'height: ' + height + 'px',
      'max-height: calc(100vh - ' + (bubbleSize + bottomPos + 32) + 'px)',
      'background-color: ' + bgColor,
      'border-radius: ' + borderRadius,
      'box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      'z-index: 2147483646',
      'display: flex',
      'flex-direction: column',
      'overflow: hidden',
      'pointer-events: auto'
    ].join('; ');

    // Header
    if (winConfig.showTitleSection) {
      var header = document.createElement('div');
      header.className = 'profitbot-chat-header';
      header.style.cssText = [
        'background-color: ' + (winConfig.headerBackgroundColor || '#f3f4f6'),
        'color: ' + (winConfig.headerTextColor || '#111827'),
        'padding: 12px 16px',
        'display: flex',
        'align-items: center',
        'gap: 8px',
        'border-radius: ' + borderRadius + ' ' + borderRadius + ' 0 0',
        'flex-shrink: 0'
      ].join('; ');
      
      if (winConfig.titleAvatarUrl) {
        var avatar = document.createElement('img');
        avatar.src = winConfig.titleAvatarUrl;
        avatar.style.cssText = 'width: 32px; height: 32px; border-radius: 50%; object-fit: contain;';
        header.appendChild(avatar);
      }
      
      var title = document.createElement('span');
      title.textContent = winConfig.title || 'Chat';
      title.style.cssText = 'flex: 1; font-weight: 600; font-size: 14px;';
      header.appendChild(title);

      var closeBtn = document.createElement('button');
      closeBtn.innerHTML = '&times;';
      closeBtn.type = 'button';
      closeBtn.className = 'profitbot-close-btn';
      closeBtn.style.cssText = 'background: none; border: none; font-size: 24px; cursor: pointer; color: inherit; padding: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; line-height: 1;';
      closeBtn.addEventListener('click', onClose);
      header.appendChild(closeBtn);
      
      win.appendChild(header);
    }

    // Messages area
    var messagesArea = document.createElement('div');
    messagesArea.className = 'profitbot-messages';
    messagesArea.style.cssText = [
      'flex: 1',
      'overflow-y: auto',
      'padding: 16px',
      'display: flex',
      'flex-direction: column',
      'gap: 12px',
      'min-height: 0'
    ].join('; ');
    win.appendChild(messagesArea);

    // Welcome message area (for initial state)
    var welcomeArea = document.createElement('div');
    welcomeArea.className = 'profitbot-welcome';
    welcomeArea.style.display = 'none';
    messagesArea.appendChild(welcomeArea);

    // Starter prompts
    var starterPromptsArea = document.createElement('div');
    starterPromptsArea.className = 'profitbot-starter-prompts';
    starterPromptsArea.style.cssText = [
      'padding: 12px 16px',
      'display: flex',
      'flex-wrap: wrap',
      'gap: 8px',
      'border-top: 1px solid #e5e7eb',
      'flex-shrink: 0'
    ].join('; ');
    win.appendChild(starterPromptsArea);

    // Input area
    var inputArea = document.createElement('form');
    inputArea.className = 'profitbot-input-area';
    inputArea.style.cssText = [
      'padding: 12px 16px',
      'border-top: 1px solid ' + (winConfig.sectionBorderColor || '#e5e7eb'),
      'display: flex',
      'gap: 8px',
      'flex-shrink: 0',
      'background-color: ' + bgColor
    ].join('; ');

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'profitbot-input';
    input.placeholder = winConfig.inputPlaceholder || 'Type your query';
    input.autocomplete = 'off';
    input.style.cssText = [
      'flex: 1',
      'padding: 8px 12px',
      'border: 1px solid ' + (winConfig.inputBorderColor || '#d1d5db'),
      'border-radius: 8px',
      'outline: none',
      'font-size: ' + (winConfig.fontSizePx || 14) + 'px',
      'background-color: ' + (winConfig.inputBackgroundColor || '#ffffff'),
      'color: ' + (winConfig.inputTextColor || '#111827')
    ].join('; ');

    var sendBtn = document.createElement('button');
    sendBtn.type = 'submit';
    sendBtn.className = 'profitbot-send-btn';
    sendBtn.innerHTML = '&#9650;';
    sendBtn.style.cssText = [
      'width: 40px',
      'height: 40px',
      'border-radius: 50%',
      'background-color: ' + (winConfig.sendButtonBackgroundColor || '#3b82f6'),
      'color: ' + (winConfig.sendButtonIconColor || '#ffffff'),
      'border: none',
      'cursor: pointer',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'font-size: 18px',
      'flex-shrink: 0'
    ].join('; ');

    inputArea.appendChild(input);
    inputArea.appendChild(sendBtn);
    win.appendChild(inputArea);

    // Footer
    if (winConfig.footerText) {
      var footer = document.createElement('div');
      footer.className = 'profitbot-footer';
      footer.textContent = winConfig.footerText;
      footer.style.cssText = [
        'padding: 8px 16px',
        'text-align: center',
        'font-size: 11px',
        'color: ' + (winConfig.footerTextColor || '#6b7280'),
        'background-color: ' + (winConfig.footerBackgroundColor || bgColor),
        'border-top: 1px solid ' + (winConfig.sectionBorderColor || '#e5e7eb'),
        'flex-shrink: 0'
      ].join('; ');
      win.appendChild(footer);
    }

    return win;
  }

  function getUserMessageStyle(config) {
    var bubbleConfig = config.bubble || {};
    return [
      'background-color: ' + (bubbleConfig.backgroundColor || '#3b82f6'),
      'color: ' + (bubbleConfig.colorOfInternalIcons || '#ffffff'),
      'padding: 12px 16px',
      'border-radius: ' + ((config.window?.messageBorderRadius || 12) + 'px'),
      'max-width: 85%',
      'align-self: flex-end',
      'word-wrap: break-word'
    ].join('; ');
  }

  function getBotMessageStyle(config) {
    var botConfig = config.window?.botMessageSettings || {};
    return [
      'background-color: ' + (botConfig.backgroundColor || '#f3f4f6'),
      'color: ' + (botConfig.textColor || '#111827'),
      'padding: 12px 16px',
      'border-radius: ' + ((config.window?.messageBorderRadius || 12) + 'px'),
      'max-width: 85%',
      'align-self: flex-start',
      'word-wrap: break-word'
    ].join('; ');
  }

  function getWidgetCSS(config) {
    var winConfig = config.window || {};
    var fontSize = winConfig.fontSizePx || 14;
    var bubbleBg = (config.bubble && config.bubble.backgroundColor) ? config.bubble.backgroundColor : '#3b82f6';
    var winBg = winConfig.backgroundColor || '#ffffff';
    var botText = (winConfig.botMessageSettings && winConfig.botMessageSettings.textColor) ? winConfig.botMessageSettings.textColor : '#111827';
    var starterBg = winConfig.starterPromptBackgroundColor || '#f9fafb';
    var starterHoverBg = winConfig.starterPromptBackgroundColor ? winConfig.starterPromptBackgroundColor : '#f3f4f6';
    var starterText = winConfig.starterPromptTextColor || '#374151';
    var starterFontSize = Math.max(11, (winConfig.starterPromptFontSizePx || 14) - 3);
    
    return '.profitbot-widget-wrapper {' +
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;' +
      'font-size: ' + fontSize + 'px;' +
      'line-height: 1.5;' +
      'color: #111827;' +
      '--profitbot-primary: ' + bubbleBg + ';' +
      '--profitbot-bg: ' + winBg + ';' +
      '--profitbot-text: ' + botText + ';' +
      '}' +
      '.profitbot-bubble { transition: transform 0.2s ease-out, box-shadow 0.2s ease-out; }' +
      '.profitbot-bubble:hover { transform: scale(1.05); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3), 0 6px 12px rgba(0, 0, 0, 0.2) !important; }' +
      '.profitbot-bubble.open { transform: scale(0.95); }' +
      '.profitbot-chat-window { animation: profitbot-slide-up 0.3s ease-out; }' +
      '@keyframes profitbot-slide-up { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }' +
      '.profitbot-messages { scrollbar-width: thin; scrollbar-color: #d1d5db transparent; }' +
      '.profitbot-messages::-webkit-scrollbar { width: 6px; }' +
      '.profitbot-messages::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }' +
      '.profitbot-message { word-wrap: break-word; overflow-wrap: break-word; }' +
      '.profitbot-message a { color: inherit; text-decoration: underline; }' +
      '.profitbot-message a.chat-cta-button { display: inline-block; margin-top: 8px; padding: 8px 16px; background: rgba(255, 255, 255, 0.25); border: 1px solid rgba(255, 255, 255, 0.4); border-radius: 8px; font-weight: 600; text-decoration: none; }' +
      '.profitbot-typing-dots { display: flex; gap: 4px; align-items: center; }' +
      '.profitbot-typing-dots span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.4; animation: profitbot-typing-bounce 1.4s ease-in-out infinite both; }' +
      '.profitbot-typing-dots span:nth-child(1) { animation-delay: 0s; }' +
      '.profitbot-typing-dots span:nth-child(2) { animation-delay: 0.2s; }' +
      '.profitbot-typing-dots span:nth-child(3) { animation-delay: 0.4s; }' +
      '@keyframes profitbot-typing-bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }' +
      '.profitbot-starter-prompt { padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 6px; background: ' + starterBg + '; color: ' + starterText + '; font-size: ' + starterFontSize + 'px; cursor: pointer; transition: all 0.2s; }' +
      '.profitbot-starter-prompt:hover { background: ' + starterHoverBg + '; transform: scale(1.02); }' +
      '.profitbot-checkout-preview { margin-top: 12px; }' +
      '.profitbot-checkout-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.15); }' +
      '.profitbot-checkout-header h3 { font-size: 18px; font-weight: 700; margin: 0; color: #22c55e; }' +
      '.profitbot-line-item { display: flex; gap: 16px; margin-bottom: 28px; }' +
      '.profitbot-image-wrap { position: relative; width: 80px; height: 80px; border-radius: 8px; background: rgba(255, 255, 255, 0.1); overflow: hidden; flex-shrink: 0; }' +
      '.profitbot-image-wrap img { width: 100%; height: 100%; object-fit: cover; }' +
      '.profitbot-qty-badge { position: absolute; top: -8px; right: -8px; background: #374151; color: #fff; font-size: 13px; font-weight: 700; padding: 6px 10px; border-radius: 6px; min-width: 28px; text-align: center; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2); }' +
      '.profitbot-product-name { font-weight: 700; font-size: 16px; margin-bottom: 4px; color: #22c55e; }' +
      '.profitbot-product-variant { font-size: 14px; opacity: 0.85; margin-bottom: 10px; }' +
      '.profitbot-price-row { display: flex; gap: 40px; margin-top: 6px; }' +
      '.profitbot-price-col { display: flex; flex-direction: column; gap: 4px; }' +
      '.profitbot-price-label { font-size: 12px; opacity: 0.7; font-weight: 500; }' +
      '.profitbot-price-value { font-size: 16px; font-weight: 700; }' +
      '.profitbot-checkout-summary { margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.2); }' +
      '.profitbot-summary-row { display: flex; justify-content: space-between; padding: 4px 0; }' +
      '.profitbot-summary-total { margin-top: 8px; font-size: 1.05em; }' +
      '.profitbot-summary-footer { font-size: 0.85em; opacity: 0.8; margin-top: 8px; }' +
      '.profitbot-cta-button { display: inline-block; margin-top: 16px; padding: 12px 24px; background: rgba(255, 255, 255, 0.25); border: 1px solid rgba(255, 255, 255, 0.4); border-radius: 8px; font-weight: 600; text-decoration: none; color: inherit; transition: all 0.15s; }' +
      '.profitbot-cta-button:hover { background: rgba(255, 255, 255, 0.35); border-color: rgba(255, 255, 255, 0.6); }' +
      '@media (max-width: 768px) { .profitbot-chat-window { bottom: 0 !important; right: 0 !important; width: 100% !important; height: 100% !important; max-height: 100vh !important; border-radius: 0 !important; } .profitbot-bubble.open { display: none; } }';
  }

  // Initialize when DOM is ready
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
