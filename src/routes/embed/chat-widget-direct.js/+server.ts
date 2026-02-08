/**
 * Direct embed script - injects widget directly into page DOM (no iframe)
 * This avoids pointer-events issues and allows better integration
 */
const EMBED_SCRIPT = String.raw`
(function() {
  // Support both synchronous (document.currentScript) and deferred (find by data-widget-id) loading
  var script = document.currentScript;
  if (!script) {
    // Script loaded with defer/async - find it by data-widget-id attribute
    var scripts = document.querySelectorAll('script[data-widget-id]');
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      var srcAttr = s.getAttribute('src') || '';
      if (srcAttr.indexOf('/embed/chat-widget-direct.js') >= 0) {
        script = s;
        break;
      }
    }
  }
  if (!script) {
    console.warn('[ProfitBot] Could not find script tag. Ensure the script tag includes data-widget-id attribute.');
    return;
  }
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
    
    // Initial iframe positioning - will be adjusted dynamically based on widget dimensions
    if (isMobile) {
      iframe.style.cssText = 'position:fixed;bottom:0;right:0;width:100px;height:100px;border:none;z-index:2147483647;background:transparent;overflow:visible;pointer-events:auto;';
    } else {
      // Desktop: start with reasonable default, will be adjusted when widget sends dimensions
      iframe.style.cssText = 'position:fixed;bottom:0;right:0;width:500px;height:300px;border:none;z-index:2147483647;background:transparent;pointer-events:auto;overflow:visible;';
    }

    try {
      document.body.appendChild(iframe);
    } catch (e) {
      console.error('[ProfitBot] Failed to append iframe:', e);
      return;
    }

    // Function to resize iframe based on widget dimensions + 10% padding
    function resizeIframe(dimensions) {
      if (!dimensions || !dimensions.width || !dimensions.height) return;
      
      // Calculate iframe size: widget size + 10% padding
      var iframeWidth = Math.ceil(dimensions.width * 1.1);
      var iframeHeight = Math.ceil(dimensions.height * 1.1);
      
      // Get widget position relative to viewport
      var widgetRight = window.innerWidth - dimensions.right;
      var widgetBottom = window.innerHeight - dimensions.bottom;
      
      // Position iframe to cover widget area with padding
      // Calculate left position: widget left - 5% padding (half of 10%)
      var paddingLeft = Math.ceil(dimensions.width * 0.05);
      var paddingTop = Math.ceil(dimensions.height * 0.05);
      var iframeLeft = Math.max(0, dimensions.left - paddingLeft);
      var iframeTop = Math.max(0, dimensions.top - paddingTop);
      
      // Adjust iframe size if it would overflow viewport
      var maxWidth = window.innerWidth - iframeLeft;
      var maxHeight = window.innerHeight - iframeTop;
      iframeWidth = Math.min(iframeWidth, maxWidth);
      iframeHeight = Math.min(iframeHeight, maxHeight);
      
      // Update iframe position and size
      iframe.style.position = 'fixed';
      iframe.style.left = iframeLeft + 'px';
      iframe.style.top = iframeTop + 'px';
      iframe.style.width = iframeWidth + 'px';
      iframe.style.height = iframeHeight + 'px';
      iframe.style.right = 'auto';
      iframe.style.bottom = 'auto';
    }

    // Listen for postMessage to resize iframe
    window.addEventListener('message', function(e) {
      if (!e.data || e.data.source !== 'profitbot-widget') return;
      
      if (e.data.type === 'widget-dimensions') {
        // Dynamically resize iframe based on widget dimensions
        resizeIframe(e.data);
      } else if (e.data.type === 'chat-opened') {
        if (isMobile) {
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          iframe.style.bottom = '0';
          iframe.style.right = '0';
          iframe.style.left = 'auto';
          iframe.style.top = 'auto';
        }
        // Desktop: dimensions will be sent via widget-dimensions message
      } else if (e.data.type === 'chat-closed') {
        if (isMobile) {
          iframe.style.width = '100px';
          iframe.style.height = '100px';
          iframe.style.bottom = '0';
          iframe.style.right = '0';
          iframe.style.left = 'auto';
          iframe.style.top = 'auto';
        }
        // Desktop: dimensions will be sent via widget-dimensions message
      }
    });

    // Handle resize
    window.addEventListener('resize', function() {
      var wasMobile = isMobile;
      isMobile = window.innerWidth <= 768;
      
      if (isMobile && !wasMobile) {
        iframe.style.cssText = 'position:fixed;bottom:0;right:0;width:100px;height:100px;border:none;z-index:2147483647;background:transparent;overflow:visible;pointer-events:auto;';
      } else if (!isMobile && wasMobile) {
        // Desktop: will be adjusted when widget sends dimensions
        iframe.style.cssText = 'position:fixed;bottom:0;right:0;width:500px;height:300px;border:none;z-index:2147483647;background:transparent;pointer-events:auto;overflow:visible;';
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
