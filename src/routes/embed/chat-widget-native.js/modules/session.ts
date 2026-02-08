/**
 * Session management - Get or create session ID
 */
export const session = String.raw`
  /* ===== 3. SESSION ===== */
  function getSessionId() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('session_id');
    if (fromUrl) return fromUrl.trim();
    var key = 'profitbot_session_' + widgetId;
    try {
      var stored = localStorage.getItem(key);
      if (stored && stored.trim()) return stored.trim();
    } catch (e) {}
    var newId = 'visitor_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);
    try { localStorage.setItem(key, newId); } catch (e) {}
    return newId;
  }
`;
