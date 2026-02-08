/**
 * Native embed script - injects widget directly into page DOM (no iframe)
 * Uses Shadow DOM for CSS isolation, similar to GoHighLevel widget
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
    
    // Create Shadow DOM for CSS isolation
    var shadow = container.attachShadow({ mode: 'open' });
    
    // Create widget wrapper
    var wrapper = document.createElement('div');
    wrapper.className = 'profitbot-widget-wrapper';
    shadow.appendChild(wrapper);

    // Inject CSS (scoped to shadow DOM)
    var style = document.createElement('style');
    style.textContent = getWidgetCSS();
    shadow.appendChild(style);

    // Widget state
    var isOpen = false;
    var isMobile = window.innerWidth <= 768;

    // Create bubble button
    var bubble = createBubble(config, function() {
      isOpen = !isOpen;
      updateWidget();
    });
    wrapper.appendChild(bubble);

    // Create chat window
    var chatWindow = createChatWindow(config, widgetId, function() {
      isOpen = false;
      updateWidget();
    });
    chatWindow.style.display = 'none';
    wrapper.appendChild(chatWindow);

    function updateWidget() {
      if (isOpen) {
        chatWindow.style.display = 'block';
        bubble.classList.add('open');
      } else {
        chatWindow.style.display = 'none';
        bubble.classList.remove('open');
      }
    }

    // Handle mobile resize
    window.addEventListener('resize', function() {
      var wasMobile = isMobile;
      isMobile = window.innerWidth <= 768;
      if (isMobile !== wasMobile) {
        updateWidget();
      }
    });
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
    
    bubble.style.cssText = [
      'position: fixed',
      'bottom: ' + (bubbleConfig.bottomPositionPx || 20) + 'px',
      'right: ' + (bubbleConfig.rightPositionPx || 20) + 'px',
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
      'transition: transform 0.2s'
    ].join('; ');

    // Add icon
    if (bubbleConfig.customIconUrl) {
      var img = document.createElement('img');
      img.src = bubbleConfig.customIconUrl;
      img.style.cssText = 'width: ' + (bubbleConfig.customIconSize || 50) + '%; height: ' + (bubbleConfig.customIconSize || 50) + '%; object-fit: contain; pointer-events: none;';
      bubble.appendChild(img);
    } else {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '50%');
      svg.setAttribute('height', '50%');
      svg.style.fill = bubbleConfig.colorOfInternalIcons || '#ffffff';
      svg.style.pointerEvents = 'none';
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z');
      svg.appendChild(path);
      bubble.appendChild(svg);
    }

    bubble.addEventListener('click', onClick);
    return bubble;
  }

  function createChatWindow(config, widgetId, onClose) {
    var win = document.createElement('div');
    win.className = 'profitbot-chat-window';
    
    var winConfig = config.window || {};
    var width = winConfig.widthPx || 400;
    var height = winConfig.heightPx || 600;
    var bgColor = winConfig.backgroundColor || '#ffffff';
    var borderRadius = winConfig.borderRadiusStyle === 'rounded' ? '12px' : '0';
    
    win.style.cssText = [
      'position: fixed',
      'bottom: 80px',
      'right: 20px',
      'width: ' + width + 'px',
      'height: ' + height + 'px',
      'max-height: calc(100vh - 100px)',
      'background-color: ' + bgColor,
      'border-radius: ' + borderRadius,
      'box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      'z-index: 2147483646',
      'display: flex',
      'flex-direction: column',
      'overflow: hidden'
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
        'border-radius: ' + borderRadius + ' ' + borderRadius + ' 0 0'
      ].join('; ');
      
      var title = document.createElement('span');
      title.textContent = winConfig.title || 'Chat';
      title.style.cssText = 'flex: 1; font-weight: 600; font-size: 14px;';
      header.appendChild(title);

      var closeBtn = document.createElement('button');
      closeBtn.innerHTML = '&times;';
      closeBtn.type = 'button';
      closeBtn.style.cssText = 'background: none; border: none; font-size: 24px; cursor: pointer; color: inherit; padding: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;';
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
      'gap: 12px'
    ].join('; ');

    // Welcome message
    var welcomeMsg = document.createElement('div');
    welcomeMsg.className = 'profitbot-message profitbot-message-bot';
    welcomeMsg.textContent = winConfig.welcomeMessage || 'Hi! How can I help you today?';
    welcomeMsg.style.cssText = [
      'background-color: ' + (winConfig.botMessageSettings?.backgroundColor || '#f3f4f6'),
      'color: ' + (winConfig.botMessageSettings?.textColor || '#111827'),
      'padding: 12px 16px',
      'border-radius: 12px',
      'max-width: 85%',
      'align-self: flex-start'
    ].join('; ');
    messagesArea.appendChild(welcomeMsg);
    win.appendChild(messagesArea);

    // Input area
    var inputArea = document.createElement('form');
    inputArea.className = 'profitbot-input-area';
    inputArea.style.cssText = [
      'padding: 12px 16px',
      'border-top: 1px solid #e5e7eb',
      'display: flex',
      'gap: 8px'
    ].join('; ');

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = winConfig.inputPlaceholder || 'Type your query';
    input.className = 'profitbot-input';
    input.style.cssText = [
      'flex: 1',
      'padding: 8px 12px',
      'border: 1px solid #d1d5db',
      'border-radius: 8px',
      'outline: none',
      'font-size: 14px'
    ].join('; ');

    var sendBtn = document.createElement('button');
    sendBtn.type = 'submit';
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
      'font-size: 18px'
    ].join('; ');

    inputArea.addEventListener('submit', function(e) {
      e.preventDefault();
      var message = input.value.trim();
      if (!message) return;
      
      // Add user message
      var userMsg = document.createElement('div');
      userMsg.className = 'profitbot-message profitbot-message-user';
      userMsg.textContent = message;
      userMsg.style.cssText = [
        'background-color: ' + (config.bubble?.backgroundColor || '#3b82f6'),
        'color: ' + (config.bubble?.colorOfInternalIcons || '#ffffff'),
        'padding: 12px 16px',
        'border-radius: 12px',
        'max-width: 85%',
        'align-self: flex-end'
      ].join('; ');
      messagesArea.appendChild(userMsg);
      input.value = '';
      messagesArea.scrollTop = messagesArea.scrollHeight;

      // Send to API (simplified - you'll need to implement full chat logic)
      fetch(base + '/api/widgets/' + widgetId + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message })
      }).then(function(res) {
        return res.json();
      }).then(function(data) {
        // Handle response (simplified)
        console.log('Chat response:', data);
      }).catch(function(err) {
        console.error('Chat error:', err);
      });
    });

    inputArea.appendChild(input);
    inputArea.appendChild(sendBtn);
    win.appendChild(inputArea);

    return win;
  }

  function getWidgetCSS() {
    return \`
      .profitbot-widget-wrapper {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: #111827;
      }
      .profitbot-bubble:hover {
        transform: scale(1.05);
      }
      .profitbot-bubble.open {
        transform: scale(0.95);
      }
      .profitbot-chat-window {
        animation: profitbot-slide-up 0.3s ease-out;
      }
      @keyframes profitbot-slide-up {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @media (max-width: 768px) {
        .profitbot-chat-window {
          bottom: 0 !important;
          right: 0 !important;
          width: 100% !important;
          height: 100% !important;
          max-height: 100vh !important;
          border-radius: 0 !important;
        }
      }
      .profitbot-messages::-webkit-scrollbar {
        width: 6px;
      }
      .profitbot-messages::-webkit-scrollbar-thumb {
        background: #d1d5db;
        border-radius: 3px;
      }
    \`;
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
