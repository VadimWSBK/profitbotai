/**
 * CSS generator module - Generates scoped CSS with !important flags
 */
export const cssgenerator = String.raw`
  /* ===== 5. CSS GENERATOR ===== */
  function getWidgetCSS(config, scopeId) {
    // Scope all selectors to the widget container to avoid conflicts
    var scope = scopeId ? '[data-profitbot-id="' + scopeId + '"]' : '';
    
    function scopeSelector(sel) {
      if (!scope) return sel;
      // Don't scope keyframes, media queries, or global resets
      if (sel.indexOf('@') === 0 || sel.indexOf('*') === 0) return sel;
      // Handle pseudo-selectors (e.g., .pb-bubble:hover)
      var pseudoMatch = sel.match(/^([^:]+)(:[\w-()]+)?$/);
      if (pseudoMatch) {
        var baseSelector = pseudoMatch[1];
        var pseudo = pseudoMatch[2] || '';
        return scope + ' ' + baseSelector + pseudo;
      }
      // Scope class and ID selectors
      return scope + ' ' + sel;
    }
    
    var b = config.bubble || {};
    var w = config.window || {};
    var t = config.tooltip || {};
    var bot = w.botMessageSettings || {};
    var bubbleBg = b.backgroundColor || '#3b82f6';
    var winBg = w.backgroundColor || '#ffffff';
    var botBg = bot.backgroundColor || '#f3f4f6';
    var botText = bot.textColor || '#111827';
    var fontSize = w.fontSizePx || 14;
    var msgRadius = w.messageBorderRadius || 12;
    var winRadius = w.borderRadiusStyle === 'rounded' ? '12px' : '0';
    var headerRadius = w.borderRadiusStyle === 'rounded' ? '12px 12px 0 0' : '0';
    var bubbleSize = b.bubbleSizePx || 60;
    var bubbleRight = b.rightPositionPx || 20;
    var bubbleBottom = b.bottomPositionPx || 20;
    var bubbleRadius = b.borderRadiusStyle === 'circle' ? '50%' : b.borderRadiusStyle === 'rounded' ? '16px' : '0';
    var starterBg = w.starterPromptBackgroundColor || '#f9fafb';
    var starterText = w.starterPromptTextColor || '#374151';
    var starterBorder = w.starterPromptBorderColor || '#d1d5db';
    var starterFontSize = Math.max(11, (w.starterPromptFontSizePx || 14) - 3);
    var borderColor = w.sectionBorderColor || '#e5e7eb';
    var inputBorder = w.inputBorderColor || '#d1d5db';
    var inputBg = w.inputBackgroundColor || '#ffffff';
    var inputText = w.inputTextColor || '#111827';
    var inputPh = w.inputPlaceholderColor || '#9ca3af';
    var sendBg = w.sendButtonBackgroundColor || '#3b82f6';
    var sendIcon = w.sendButtonIconColor || '#ffffff';
    var headerBg = w.headerBackgroundColor || '#f3f4f6';
    var headerText = w.headerTextColor || '#111827';
    var headerIcon = w.headerIconColor || '#374151';
    var footerBg = w.footerBackgroundColor || winBg;
    var footerText = w.footerTextColor || '#6b7280';
    var avatarSize = w.avatarSize || 40;
    var avatarRadius = w.avatarBorderRadius || 25;
    
    // Helper to add !important to critical properties for maximum specificity
    function important(prop, val) {
      return prop + ': ' + val + ' !important;';
    }
    
    var cssArray = [
      /* Aggressive CSS reset to prevent host page interference */
      scope + ' *, ' + scope + ' *::before, ' + scope + ' *::after { ' +
        'box-sizing: border-box !important; ' +
        'margin: 0 !important; ' +
        'padding: 0 !important; ' +
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important; ' +
        'line-height: 1.5 !important; ' +
        ' }',
      scope + ' { ' +
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important; ' +
        'font-size: ' + fontSize + 'px !important; ' +
        'line-height: 1.5 !important; ' +
        'color: #111827 !important; ' +
        'all: initial !important; ' +
        'display: block !important; ' +
        ' }',
      scopeSelector('.pb-wrapper') + ' { ' + 
        important('position', 'fixed') + 
        important('z-index', '2147483647') + 
        important('right', bubbleRight + 'px') + 
        important('bottom', bubbleBottom + 'px') + 
        important('display', 'flex') + 
        important('flex-direction', 'column') + 
        important('align-items', 'flex-end') + 
        important('pointer-events', 'none') + 
        ' }',

      /* Bubble - with !important for maximum specificity */
      scopeSelector('.pb-bubble') + ' { ' + 
        important('pointer-events', 'auto') +
        important('width', bubbleSize + 'px') +
        important('height', bubbleSize + 'px') +
        important('min-width', bubbleSize + 'px') +
        important('min-height', bubbleSize + 'px') +
        important('background-color', bubbleBg) +
        important('border-radius', bubbleRadius) +
        important('border', 'none') +
        important('cursor', 'pointer') +
        important('display', 'flex') +
        important('align-items', 'center') +
        important('justify-content', 'center') +
        ' box-shadow: 0 8px 24px rgba(0,0,0,0.25), 0 4px 8px rgba(0,0,0,0.15) !important; ' +
        ' transition: transform 0.2s ease-out, box-shadow 0.2s ease-out !important; ' +
        important('position', 'relative') +
        important('z-index', '20') +
        important('flex-shrink', '0') +
        important('outline', 'none') +
        ' }',
      scopeSelector('.pb-bubble:hover') + ' { transform: scale(1.05); box-shadow: 0 12px 32px rgba(0,0,0,0.3), 0 6px 12px rgba(0,0,0,0.2); }',
      scopeSelector('.pb-bubble.pb-open') + ' { transform: scale(0.95); }',
      scopeSelector('.pb-bubble-pulse') + ' { animation: pb-pulse 2s ease-in-out 3; }',
      '@keyframes pb-pulse { 0%,100% { box-shadow: 0 8px 24px rgba(0,0,0,0.25), 0 4px 8px rgba(0,0,0,0.15), 0 0 0 0 rgba(0,0,0,0.15); } 50% { box-shadow: 0 8px 24px rgba(0,0,0,0.25), 0 4px 8px rgba(0,0,0,0.15), 0 0 0 8px rgba(0,0,0,0); } }',

      /* Tooltip */
      scopeSelector('.pb-tooltip') + ' { pointer-events: auto; position: relative; background-color: ' + (t.backgroundColor || '#ffffff') + '; color: ' + (t.textColor || '#111827') + '; font-size: ' + (t.fontSizePx || 14) + 'px; padding: 16px 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-width: 340px; min-width: 240px; line-height: 1.5; cursor: pointer; z-index: 19; white-space: nowrap; animation: pb-fade-in 0.2s ease-out; }',
      scopeSelector('.pb-tooltip-hidden') + ' { opacity: 0; pointer-events: none; transition: opacity 0.3s; }',

      /* Chat window - with !important */
      scopeSelector('.pb-window') + ' { ' +
        important('pointer-events', 'auto') +
        important('position', 'absolute') +
        important('bottom', (bubbleSize + 12) + 'px') +
        important('right', '0') +
        important('width', (w.widthPx || 400) + 'px') +
        important('height', (w.heightPx || 600) + 'px') +
        important('max-height', 'calc(100vh - ' + (bubbleSize + bubbleBottom + 32) + 'px)') +
        important('background-color', winBg) +
        important('border-radius', winRadius) +
        ' box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25) !important; ' +
        important('display', 'flex') +
        important('flex-direction', 'column') +
        important('overflow', 'hidden') +
        important('z-index', '18') +
        ' animation: pb-window-in ' + dur(250) + 'ms cubic-bezier(0.33,1,0.68,1) both !important; ' +
        ' }',
      scopeSelector('.pb-window.pb-closing') + ' { animation: pb-window-out ' + dur(180) + 'ms cubic-bezier(0.33,1,0.68,1) both; }',
      '@keyframes pb-window-in { from { opacity: 0; transform: translateY(12px) scale(0.95); transform-origin: bottom right; } to { opacity: 1; transform: translateY(0) scale(1); } }',
      '@keyframes pb-window-out { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(8px) scale(0.96); } }',

      /* Header */
      '.pb-header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background-color: ' + headerBg + '; color: ' + headerText + '; border-radius: ' + headerRadius + '; flex-shrink: 0; }',
      '.pb-header-avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: contain; }',
      '.pb-header-title { flex: 1; font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.pb-header-btn { background: none; border: none; padding: 6px; border-radius: 4px; cursor: pointer; color: ' + headerIcon + '; display: flex; align-items: center; justify-content: center; transition: opacity 0.15s; outline: none; }',
      '.pb-header-btn:hover { opacity: 0.7; }',
      '.pb-header-btn:disabled { opacity: 0.4; cursor: default; }',
      '.pb-spin { animation: pb-spin 1s linear infinite; }',
      '@keyframes pb-spin { to { transform: rotate(360deg); } }',

      /* Messages area */
      '.pb-messages { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow-anchor: none; scroll-behavior: smooth; position: relative; }',
      '.pb-messages::-webkit-scrollbar { width: 6px; }',
      '.pb-messages::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }',
      w.showScrollbar === false ? '.pb-messages { scrollbar-width: none; -ms-overflow-style: none; } .pb-messages::-webkit-scrollbar { display: none; }' : '.pb-messages { scrollbar-width: thin; scrollbar-color: #d1d5db transparent; }',

      /* Message rows */
      '.pb-msg-row { display: flex; gap: 8px; align-items: flex-start; animation: pb-fly-left ' + dur(280) + 'ms cubic-bezier(0.33,1,0.68,1) both; }',
      '.pb-msg-row-user { justify-content: flex-end; animation-name: pb-fly-right; }',
      '.pb-msg-row.pb-no-anim, .pb-msg-row-user.pb-no-anim { animation: none; }',
      '@keyframes pb-fly-left { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: translateX(0); } }',
      '@keyframes pb-fly-right { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }',

      /* Bubbles */
      '.pb-msg { padding: 12px 16px; border-radius: ' + msgRadius + 'px; max-width: 100%; word-wrap: break-word; overflow-wrap: break-word; position: relative; }',
      '.pb-msg-bot { background-color: ' + botBg + '; color: ' + botText + '; align-self: flex-start; }',
      '.pb-msg-user { background-color: ' + bubbleBg + '; color: ' + (b.colorOfInternalIcons || '#ffffff') + '; align-self: flex-end; }',
      '.pb-msg-content { min-width: 0; overflow-x: auto; overflow-y: visible; max-width: 100%; }',

      /* Avatar */
      '.pb-avatar { width: ' + avatarSize + 'px; height: ' + avatarSize + 'px; border-radius: ' + avatarRadius + 'px; object-fit: contain; flex-shrink: 0; }',
      '.pb-avatar-placeholder { width: ' + avatarSize + 'px; height: ' + avatarSize + 'px; border-radius: ' + avatarRadius + 'px; background-color: ' + botBg + '; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }',

      /* Timestamps */
      '.pb-timestamp { font-size: 0.85rem; opacity: 0.7; margin-top: 4px; padding: 0 4px; user-select: none; line-height: 1.3; }',

      /* Copy button */
      '.pb-copy-btn { position: absolute; top: 8px; right: 8px; background: none; border: none; cursor: pointer; opacity: 0; transition: opacity 0.2s; padding: 2px; border-radius: 4px; color: inherit; display: flex; align-items: center; justify-content: center; }',
      '.pb-msg:hover .pb-copy-btn { opacity: 0.6; }',
      '.pb-copy-btn:hover { opacity: 1 !important; }',

      /* Typing indicator */
      '.pb-typing { display: flex; gap: 4px; align-items: center; padding: 12px 16px; }',
      '.pb-typing-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.4; animation: pb-dot-bounce 1.4s ease-in-out infinite both; }',
      '.pb-typing-dot:nth-child(2) { animation-delay: 0.2s; }',
      '.pb-typing-dot:nth-child(3) { animation-delay: 0.4s; }',
      '@keyframes pb-dot-bounce { 0%,80%,100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }',

      /* Streaming cursor */
      '.pb-streaming-cursor { display: inline; animation: pb-blink 530ms steps(1) infinite; font-weight: 100; margin-left: 1px; }',
      '@keyframes pb-blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }',

      /* Scroll-to-bottom FAB */
      '.pb-scroll-fab { position: sticky; bottom: 8px; align-self: flex-end; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.15); color: ' + botText + '; border: none; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.2); transition: opacity 0.2s, background 0.2s; animation: pb-fade-in 0.2s ease-out; pointer-events: auto; }',
      '.pb-scroll-fab:hover { background: rgba(0,0,0,0.25); }',

      /* Starter prompts */
      '.pb-starters { padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px solid ' + borderColor + '; flex-shrink: 0; background-color: ' + winBg + '; }',
      '.pb-starter-btn { padding: 6px 12px; border: 1px solid ' + starterBorder + '; border-radius: 6px; background: ' + starterBg + '; color: ' + starterText + '; font-size: ' + starterFontSize + 'px; cursor: pointer; transition: all 0.2s; outline: none; }',
      '.pb-starter-btn:hover { transform: scale(1.02); opacity: 0.9; }',

      /* Input area */
      '.pb-input-area { padding: 12px 16px; border-top: 1px solid ' + borderColor + '; display: flex; gap: 8px; flex-shrink: 0; background-color: ' + winBg + '; }',
      '.pb-input { flex: 1; padding: 8px 12px; border: 1px solid ' + inputBorder + '; border-radius: 8px; outline: none; font-size: ' + fontSize + 'px; background-color: ' + inputBg + '; color: ' + inputText + '; font-family: inherit; transition: border-color 0.15s, box-shadow 0.15s; }',
      '.pb-input:focus { border-color: ' + sendBg + '; box-shadow: 0 0 0 2px ' + sendBg + '33; }',
      '.pb-input::placeholder { color: ' + inputPh + '; }',
      '.pb-send-btn { width: 40px; height: 40px; border-radius: 50%; background-color: ' + sendBg + '; color: ' + sendIcon + '; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: transform 0.15s ease-out, opacity 0.15s; outline: none; }',
      '.pb-send-btn:active { transform: scale(0.92); }',
      '.pb-send-btn:disabled { opacity: 0.5; cursor: default; }',
      '.pb-send-pulse { transform: scale(0.88); }',

      /* Footer */
      '.pb-footer { padding: 8px 16px; text-align: center; font-size: 11px; color: ' + footerText + '; background-color: ' + footerBg + '; border-top: 1px solid ' + borderColor + '; flex-shrink: 0; }',

      /* Links */
      '.pb-msg-link { color: inherit; text-decoration: underline; word-break: normal; overflow-wrap: break-word; }',
      '.pb-msg-link:hover { opacity: 0.9; }',
      '.pb-underline { text-decoration: underline; }',
      '.pb-cta-button { display: inline-block; text-decoration: none; padding: 0.5em 1em; margin-top: 0.5em; border-radius: 8px; font-weight: 600; background-color: rgba(255,255,255,0.25); border: 1px solid rgba(255,255,255,0.4); transition: background-color 0.15s, border-color 0.15s; }',
      '.pb-cta-button:hover { background-color: rgba(255,255,255,0.35); border-color: rgba(255,255,255,0.6); }',

      /* Images in messages */
      '.pb-msg-image { max-width: 100%; height: auto; border-radius: 8px; margin: 4px 0; }',

      /* Tables */
      '.pb-table-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 0.5em 0; max-width: 100%; }',
      '.pb-table { border-collapse: collapse; font-size: 0.95em; width: max-content; min-width: 100%; }',
      '.pb-table th, .pb-table td { border: 1px solid currentColor; opacity: 0.9; padding: 0.4em 0.6em; text-align: left; }',
      '.pb-table th { font-weight: 600; opacity: 1; }',
      '.pb-summary-table { border-collapse: collapse; width: 100%; margin-top: 0.25rem; font-size: 0.95em; }',
      '.pb-summary-head { display: none; }',
      '.pb-summary-table td { border: none; padding: 0.25em 0; }',
      '.pb-summary-table tr + tr td { border-top: 1px solid rgba(255,255,255,0.16); }',
      '.pb-summary-table td:first-child { font-weight: 600; padding-right: 1.5em; white-space: nowrap; }',
      '.pb-summary-table td:last-child { text-align: right; font-weight: 600; white-space: nowrap; }',

      /* Checkout table cells */
      '.pb-checkout-table { border: none; width: 100%; }',
      '.pb-checkout-table thead th { border: none; background: transparent; font-weight: 500; font-size: 0.9em; opacity: 0.8; padding-bottom: 0.5em; }',
      '.pb-checkout-table td { border: none; border-bottom: 1px solid rgba(255,255,255,0.12); background: transparent; padding: 0.75em 0; vertical-align: top; }',
      '.pb-checkout-table th:first-child, .pb-checkout-table td:first-child { width: 1%; white-space: nowrap; vertical-align: top; padding-right: 1em; }',
      '.pb-checkout-table th:last-child, .pb-checkout-table td:last-child { display: none; }',
      '.pb-checkout-img-wrap { position: relative; display: inline-block; width: 64px; height: 64px; flex-shrink: 0; overflow: hidden; border-radius: 6px; }',
      '.pb-table-cell-image { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 6px; }',
      '.pb-qty-badge { position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,0.75); color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; line-height: 1.2; z-index: 1; }',
      '.pb-checkout-product-cell { display: block; font-size: 0.95em; }',
      '.pb-checkout-variant-line { display: block; margin-top: 0.2em; font-size: 0.85em; opacity: 0.85; font-weight: 400; }',
      '.pb-checkout-qty-price-line { display: block; margin-top: 0.2em; font-size: 0.85em; opacity: 0.9; font-weight: 400; }',
      '.pb-checkout-price-grid { display: flex; gap: 1.5em; margin-top: 0.5em; }',
      '.pb-checkout-price-block { display: flex; flex-direction: column; font-size: 0.85em; }',
      '.pb-checkout-price-label { opacity: 0.85; }',
      '.pb-checkout-price-value { margin-top: 0.1em; font-weight: 600; }',

      /* Structured checkout preview (from checkoutPreview data) */
      '.pb-checkout-preview { margin-top: 12px; }',
      '.pb-checkout-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.15); }',
      '.pb-checkout-header h3 { font-size: 18px; font-weight: 700; margin: 0; color: #22c55e; }',
      '.pb-line-item { display: flex; gap: 16px; margin-bottom: 28px; }',
      '.pb-image-wrap { position: relative; width: 80px; height: 80px; border-radius: 8px; background: rgba(255,255,255,0.1); overflow: hidden; flex-shrink: 0; }',
      '.pb-image-wrap img { width: 100%; height: 100%; object-fit: cover; }',
      '.pb-image-wrap .pb-qty-badge { top: -8px; right: -8px; background: #374151; font-size: 13px; font-weight: 700; padding: 6px 10px; border-radius: 6px; min-width: 28px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }',
      '.pb-product-name { font-weight: 700; font-size: 16px; margin-bottom: 4px; color: #22c55e; }',
      '.pb-product-variant { font-size: 14px; opacity: 0.85; margin-bottom: 10px; }',
      '.pb-price-row { display: flex; gap: 40px; margin-top: 6px; }',
      '.pb-price-col { display: flex; flex-direction: column; gap: 4px; }',
      '.pb-price-label { font-size: 12px; opacity: 0.7; font-weight: 500; }',
      '.pb-price-value { font-size: 16px; font-weight: 700; }',
      '.pb-checkout-summary { margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.2); }',
      '.pb-summary-row { display: flex; justify-content: space-between; padding: 4px 0; }',
      '.pb-summary-total { margin-top: 8px; font-size: 1.05em; }',
      '.pb-summary-footer { font-size: 0.85em; opacity: 0.8; margin-top: 8px; }',
      '.pb-checkout-cta { display: inline-block; margin-top: 16px; padding: 12px 24px; background: rgba(255,255,255,0.25); border: 1px solid rgba(255,255,255,0.4); border-radius: 8px; font-weight: 600; text-decoration: none; color: inherit; transition: all 0.15s; }',
      '.pb-checkout-cta:hover { background: rgba(255,255,255,0.35); border-color: rgba(255,255,255,0.6); }',

      /* Backdrop for mobile */
      '.pb-backdrop { display: none; }',

      /* Loading spinner */
      '.pb-loader { display: flex; align-items: center; justify-content: center; min-height: 120px; }',
      '.pb-loader svg { animation: pb-spin 1s linear infinite; color: #9ca3af; }',

      /* Generic animations */
      '@keyframes pb-fade-in { from { opacity: 0; } to { opacity: 1; } }',
      '@keyframes pb-fade-out { from { opacity: 1; } to { opacity: 0; } }',

      /* Mobile full-screen */
      '@media (max-width: 768px) {',
      '  ' + scopeSelector('.pb-wrapper') + ' { right: ' + bubbleRight + 'px; bottom: ' + bubbleBottom + 'px; }',
      '  ' + scopeSelector('.pb-window') + ' { position: fixed !important; inset: 0 !important; width: 100% !important; height: 100% !important; max-height: 100dvh !important; border-radius: 0 !important; padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); padding-top: env(safe-area-inset-top); }',
      '  ' + scopeSelector('.pb-header') + ' { border-radius: 0 !important; }',
      '  ' + scopeSelector('.pb-input-area') + ' { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }',
      '  ' + scopeSelector('.pb-bubble.pb-open') + ' { display: none !important; }',
      '  ' + scopeSelector('.pb-backdrop') + ' { display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.3); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); z-index: 17; pointer-events: auto; animation: pb-fade-in 0.2s ease-out; }',
      '  ' + scopeSelector('.pb-tooltip') + ' { display: none !important; }',
      '}',

      /* Desktop hide tooltip on mobile */
      t.hideTooltipOnMobile ? '@media (max-width: 768px) { ' + scopeSelector('.pb-tooltip') + ' { display: none !important; } }' : '',

      /* Reduced motion */
      '@media (prefers-reduced-motion: reduce) {',
      '  .pb-bubble-pulse, .pb-typing-dot, .pb-streaming-cursor { animation: none !important; }',
      '  .pb-bubble, .pb-send-btn, .pb-starter-btn, .pb-msg-row, .pb-msg-row-user { animation: none !important; transition-duration: 0.01ms !important; }',
      '  .pb-window { animation-duration: 0.01ms !important; }',
      '}'
    ];
    
    console.log('[ProfitBot] CSS array length before processing:', cssArray.length);
    console.log('[ProfitBot] First few CSS rules:', cssArray.slice(0, 5));
    console.log('[ProfitBot] Scope ID:', scopeId, 'Scope selector:', scope);
    
    // Process CSS array: scope ALL selectors and add !important to ALL properties
    var processedCSS = [];
    try {
      for (var i = 0; i < cssArray.length; i++) {
        var rule = cssArray[i];
        if (!rule || typeof rule !== 'string') {
          console.warn('[ProfitBot] Skipping invalid CSS rule at index', i);
          continue;
        }
        
        // Don't modify keyframes
        if (rule.indexOf('@keyframes') === 0) {
          processedCSS.push(rule);
          continue;
        }
        
        // Handle media queries
        if (rule.indexOf('@media') === 0) {
          var openBrace = rule.indexOf('{');
          if (openBrace >= 0) {
            var mediaQuery = rule.substring(0, openBrace + 1);
            var content = rule.substring(openBrace + 1);
            if (scope) {
              content = content.replace(/\.pb-[\w-]+/g, function(match) {
                return scope + ' ' + match;
              });
            }
            content = content.replace(/([a-z-]+)\s*:\s*([^;!}]+)(;|$)/gi, function(match, prop, val, end) {
              if (match.indexOf('!important') >= 0 || prop === 'animation' || prop === 'transition') {
                return match;
              }
              return prop.trim() + ': ' + val.trim() + ' !important' + end;
            });
            processedCSS.push(mediaQuery + content);
          } else {
            processedCSS.push(rule);
          }
          continue;
        }
        
        // Process regular CSS rules
        var parts = rule.split('{');
        if (parts.length === 2) {
          var selector = parts[0].trim();
          var styles = parts[1];
          
          // Scope .pb- selectors
          var scopedSelector = selector;
          if (selector.indexOf('.pb-') >= 0 && scope && selector.indexOf(scope) === -1) {
            scopedSelector = scopeSelector(selector);
          }
          
          // Add !important
          styles = styles.replace(/([a-z-]+)\s*:\s*([^;!}]+)(;|$)/gi, function(match, prop, val, end) {
            if (match.indexOf('!important') >= 0 || prop === 'animation' || prop === 'transition') {
              return match;
            }
            return prop.trim() + ': ' + val.trim() + ' !important' + end;
          });
          
          processedCSS.push(scopedSelector + ' {' + styles);
        } else {
          processedCSS.push(rule);
        }
      }
    } catch (e) {
      console.error('[ProfitBot] Error processing CSS:', e, e.stack);
      return cssArray.join('\n');
    }
    
    var result = processedCSS.join('\n');
    console.log('[ProfitBot] CSS processing complete:');
    console.log('[ProfitBot] - Input rules:', cssArray.length);
    console.log('[ProfitBot] - Processed rules:', processedCSS.length);
    console.log('[ProfitBot] - Output length:', result.length);
    if (result.length < 1000) {
      console.error('[ProfitBot] ⚠️ CSS output is too short! First 200 chars:', result.substring(0, 200));
    }
    return result;
  }
`;
