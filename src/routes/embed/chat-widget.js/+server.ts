/**
 * Serves the embed loader script.
 * When included on a site (e.g. Shopify), it injects an iframe that loads the widget from /embed/widget?id=xxx.
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
  var iframe = document.createElement('iframe');
  iframe.src = base + '/embed/widget?id=' + encodeURIComponent(widgetId);
  iframe.title = 'Chat';
  iframe.setAttribute('data-profitbot-embed', '1');
  iframe.setAttribute('allowtransparency', 'true');
  // Modern chat widget: compact height for floating chat window
  // Height accommodates chat window (600px default) + bubble icon (~80px) + gap (~20px) = ~700px max
  // Using max-height to ensure it doesn't exceed viewport on smaller screens
  iframe.style.cssText = 'position:fixed;bottom:0;right:0;width:440px;height:700px;max-width:100vw;max-height:85vh;border:none;z-index:2147483647;overflow:hidden;background:transparent !important;background-color:transparent !important;';
  var wrap = document.createElement('div');
  wrap.setAttribute('data-profitbot-container', '1');
  wrap.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2147483647;pointer-events:none;overflow:visible;background:transparent !important;background-color:transparent !important;';
  wrap.appendChild(iframe);
  iframe.style.pointerEvents = 'auto';
  document.body.appendChild(wrap);
  
  // Forward messages from parent page (Shopify) to iframe
  // This allows Shopify to send context, cart updates, etc. to the widget
  window.addEventListener('message', function(event) {
    // Only forward messages intended for ProfitBot widget
    if (event.data && typeof event.data === 'object' && 
        (event.data.type && (event.data.type.startsWith('shopify-') || event.data.type.startsWith('profitbot-')))) {
      // Forward to iframe
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage(event.data, '*');
      }
    }
  });
  
  // Forward messages from iframe to parent page (Shopify)
  // This allows widget to send events to Shopify
  window.addEventListener('message', function(event) {
    // Only forward messages from the iframe
    if (event.source === iframe.contentWindow && 
        event.data && typeof event.data === 'object' && 
        event.data.type && event.data.type.startsWith('profitbot-')) {
      // Forward to parent (Shopify)
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(event.data, '*');
      }
    }
  });
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
