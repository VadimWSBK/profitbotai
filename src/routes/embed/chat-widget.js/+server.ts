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
  // Increased height to accommodate chat window opening above the icon (700px window + ~80px icon + gap + padding)
  // Using 900px to ensure enough room for chat window above icon at various positions
  // Width increased slightly to prevent icon clipping at edges
  iframe.style.cssText = 'position:fixed;bottom:0;right:0;width:440px;height:900px;max-width:100vw;max-height:100vh;border:none;z-index:2147483647;overflow:hidden;';
  var wrap = document.createElement('div');
  wrap.setAttribute('data-profitbot-container', '1');
  wrap.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2147483647;pointer-events:none;overflow:visible;';
  wrap.appendChild(iframe);
  iframe.style.pointerEvents = 'auto';
  document.body.appendChild(wrap);
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
