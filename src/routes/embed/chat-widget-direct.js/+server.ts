/**
 * Direct embed script - injects widget directly into page DOM (no iframe)
 * This avoids pointer-events issues and allows better integration
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
  var base = src.replace(/\/embed\/chat-widget-direct\.js.*$/, '');
  if (!base) return;

  // Create a container for the widget iframe (we'll still use iframe for isolation, but smaller)
  // Actually, let's use a direct iframe approach but make it work better
  function initWidget() {
    if (!document.body) {
      setTimeout(initWidget, 10);
      return;
    }

    // Check if widget already exists
    if (document.querySelector('[data-profitbot-widget="' + widgetId + '"]')) {
      return; // Already loaded
    }

    var isMobile = window.innerWidth <= 768;
    
    // Create iframe but position it only where widget will be (bottom-right)
    var iframe = document.createElement('iframe');
    iframe.src = base + '/embed/widget?id=' + encodeURIComponent(widgetId);
    iframe.title = 'Chat';
    iframe.setAttribute('data-profitbot-widget', widgetId);
    iframe.setAttribute('data-profitbot-embed', '1');
    iframe.setAttribute('allowtransparency', 'true');
    iframe.allow = 'clipboard-write';
    iframe.setAttribute('scrolling', 'no');
    
    // Position iframe only where widget is (not full viewport)
    // Need enough space for tooltip (left) + bubble (right) + chat window padding
    if (isMobile) {
      iframe.style.cssText = 'position:fixed;bottom:0;right:0;width:100px;height:100px;border:none;z-index:2147483647;background:transparent;overflow:visible;pointer-events:auto;';
    } else {
      // Desktop: need space for tooltip (~250px) + bubble (~100px) + chat window with padding (~500px)
      // Position from right edge but allow content to extend left
      // Use larger dimensions and ensure overflow is visible
      iframe.style.cssText = 'position:fixed;bottom:0;right:0;width:900px;height:900px;border:none;z-index:2147483647;background:transparent;pointer-events:auto;overflow:visible;';
    }

    try {
      document.body.appendChild(iframe);
    } catch (e) {
      console.error('[ProfitBot] Failed to append iframe:', e);
      return;
    }

    // Listen for postMessage to resize iframe when chat opens/closes
    window.addEventListener('message', function(e) {
      if (!e.data || e.data.source !== 'profitbot-widget') return;
      
      if (e.data.type === 'chat-opened') {
        if (isMobile) {
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          iframe.style.bottom = '0';
          iframe.style.right = '0';
        } else {
          // Desktop: expand to fit chat window (keep wide enough for tooltip + chat)
          iframe.style.width = '900px';
          iframe.style.height = '900px';
        }
      } else if (e.data.type === 'chat-closed') {
        if (isMobile) {
          iframe.style.width = '100px';
          iframe.style.height = '100px';
        } else {
          // Desktop: keep wide enough for tooltip + bubble
          iframe.style.width = '500px';
          iframe.style.height = '250px';
        }
      }
    });

    // Handle resize
    window.addEventListener('resize', function() {
      var wasMobile = isMobile;
      isMobile = window.innerWidth <= 768;
      
      if (isMobile && !wasMobile) {
        iframe.style.cssText = 'position:fixed;bottom:0;right:0;width:100px;height:100px;border:none;z-index:2147483647;background:transparent;overflow:visible;pointer-events:auto;';
      } else if (!isMobile && wasMobile) {
        iframe.style.cssText = 'position:fixed;bottom:0;right:0;width:900px;height:900px;border:none;z-index:2147483647;background:transparent;pointer-events:auto;overflow:visible;';
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
