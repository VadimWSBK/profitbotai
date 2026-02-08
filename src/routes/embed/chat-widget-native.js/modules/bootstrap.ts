/**
 * Bootstrap module - Script tag detection and initialization
 */
export const bootstrap = String.raw`
  /* ===== 1. BOOTSTRAP ===== */
  // Support both synchronous (document.currentScript) and deferred (find by data-widget-id) loading
  var script = document.currentScript;
  if (!script) {
    // Script loaded with defer/async - find it by data-widget-id attribute
    var scripts = document.querySelectorAll('script[data-widget-id]');
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      var srcAttr = s.getAttribute('src') || '';
      if (srcAttr.indexOf('/embed/chat-widget-native.js') >= 0) {
        script = s;
        break;
      }
    }
    // If still not found, try finding any script with the native.js path
    if (!script) {
      var allScripts = document.querySelectorAll('script[src*="chat-widget-native.js"]');
      if (allScripts.length > 0) {
        script = allScripts[allScripts.length - 1]; // Use the last one if multiple
      }
    }
  }
  if (!script) {
    console.error('[ProfitBot] Could not find script tag. Ensure the script tag includes data-widget-id attribute.');
    return;
  }
  var widgetId = script.getAttribute('data-widget-id');
  if (!widgetId || widgetId === 'YOUR_WIDGET_ID') {
    console.error('[ProfitBot] Missing or invalid data-widget-id. Found:', widgetId);
    return;
  }
  var src = script.getAttribute('src') || '';
  var base = src.replace(/\/embed\/chat-widget-native\.js.*$/, '');
  if (!base) {
    console.error('[ProfitBot] Could not determine base URL from script src:', src);
    return;
  }
  console.log('[ProfitBot] Initializing widget:', widgetId, 'Base URL:', base);
  // Prevent duplicate initialization
  if (!window.__profitbot_widget_loaded) window.__profitbot_widget_loaded = {};
  if (window.__profitbot_widget_loaded[widgetId]) {
    console.warn('[ProfitBot] Widget already loaded:', widgetId);
    return;
  }
  window.__profitbot_widget_loaded[widgetId] = true;
`;
