/**
 * Serves the embed loader script.
 * When included on a site (e.g. Shopify), it injects an iframe that loads the widget from /embed/widget?id=xxx.
 *
 * The iframe is a transparent full-viewport overlay with pointer-events:none.
 * Only the bubble + chat window inside have pointer-events:auto, so the rest
 * of the host page stays fully interactive.
 *
 * On mobile, the widget sends postMessage events to resize the iframe to
 * full-screen when the chat opens and back to bubble-only when it closes.
 */
const EMBED_SCRIPT = String.raw`
(function() {
  var script = document.currentScript;
  if (!script) return;
  var widgetId = script.getAttribute('data-widget-id');
  if (!widgetId || widgetId === 'YOUR_WIDGET_ID') {
    console.warn('[ProfitBot] Missing or invalid data-widget-id. Replace with your widget ID from the Embed tab.');
    return;
  }
  var src = script.getAttribute('src') || '';
  var base = src.replace(/\/embed\/chat-widget\.js.*$/, '');
  if (!base) return;

  function initWidget() {
    // Ensure document.body exists
    if (!document.body) {
      setTimeout(initWidget, 10);
      return;
    }

    var isMobile = window.innerWidth <= 768;

    var iframe = document.createElement('iframe');
    iframe.src = base + '/embed/widget?id=' + encodeURIComponent(widgetId);
    iframe.title = 'Chat';
    iframe.setAttribute('data-profitbot-embed', '1');
    iframe.setAttribute('allowtransparency', 'true');
    iframe.allow = 'clipboard-write';

    if (isMobile) {
      // Mobile: start small (just the bubble), expand to fullscreen when chat opens
      iframe.style.cssText = 'position:fixed;bottom:0;right:0;width:100px;height:100px;border:none;z-index:2147483647;background:transparent;overflow:visible;pointer-events:auto;';
    } else {
      // Desktop: only cover widget area (bottom-right), not full viewport
      // This allows clicks to pass through to the host page everywhere else
      // Start with enough space for bubble + potential chat window
      iframe.style.cssText = 'position:fixed;bottom:0;right:0;width:450px;height:700px;border:none;z-index:2147483647;background:transparent;pointer-events:auto;overflow:visible;';
    }

    try {
      document.body.appendChild(iframe);
    } catch (e) {
      console.error('[ProfitBot] Failed to append iframe:', e);
      return;
    }

  // Listen for postMessage from the widget to resize
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.source !== 'profitbot-widget') return;
    if (e.data.type === 'chat-opened') {
      if (isMobile) {
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.pointerEvents = 'auto';
      } else {
        // Desktop: expand iframe to accommodate chat window (keep it reasonable)
        iframe.style.width = '450px';
        iframe.style.height = '700px';
      }
    } else if (e.data.type === 'chat-closed') {
      if (isMobile) {
        iframe.style.width = '100px';
        iframe.style.height = '100px';
        iframe.style.pointerEvents = 'auto';
      } else {
        // Desktop: shrink back to just bubble area
        iframe.style.width = '120px';
        iframe.style.height = '120px';
      }
    }
  });

  // Forward messages from parent page (Shopify) to iframe
  // This allows Shopify to send context, cart updates, etc. to the widget
  window.addEventListener('message', function(event) {
    if (event.data && typeof event.data === 'object' &&
        (event.data.type && (event.data.type.startsWith('shopify-') || event.data.type.startsWith('profitbot-')))) {
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage(event.data, '*');
      }
    }
  });

  // Forward messages from iframe to parent page (Shopify)
  window.addEventListener('message', function(event) {
    if (event.source === iframe.contentWindow &&
        event.data && typeof event.data === 'object' &&
        event.data.type && event.data.type.startsWith('profitbot-')) {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(event.data, '*');
      }
    }
  });

    // Re-check mobile state on resize
    window.addEventListener('resize', function() {
      var wasMobile = isMobile;
      isMobile = window.innerWidth <= 768;
      if (!isMobile && wasMobile) {
        // Switched to desktop: resize iframe to widget area only
        iframe.style.cssText = 'position:fixed;bottom:0;right:0;width:450px;height:700px;border:none;z-index:2147483647;background:transparent;pointer-events:auto;overflow:visible;';
      } else if (isMobile && !wasMobile) {
        // Switched to mobile: resize to small bubble area
        iframe.style.cssText = 'position:fixed;bottom:0;right:0;width:100px;height:100px;border:none;z-index:2147483647;background:transparent;overflow:visible;pointer-events:auto;';
      }
    });
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
