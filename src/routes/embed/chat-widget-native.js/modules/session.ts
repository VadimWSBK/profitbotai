/**
 * Session management - Get or create session ID.
 * Persists in both localStorage and cookie so conversation survives refresh (cookie fallback when localStorage is blocked or cleared).
 */
export const session = String.raw`
  /* ===== 3. SESSION ===== */
  function getSessionId() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('session_id');
    if (fromUrl) return fromUrl.trim();
    var key = 'profitbot_session_' + widgetId;
    var cookieName = 'pb_sid_' + (widgetId || '').replace(/[^a-z0-9-]/gi, '_');
    // Try cookie first (survives refresh even when localStorage is partitioned in iframes)
    try {
      var cookies = document.cookie.split(';');
      for (var i = 0; i < cookies.length; i++) {
        var part = cookies[i].trim();
        if (part.indexOf(cookieName + '=') === 0) {
          var val = decodeURIComponent(part.slice(cookieName.length + 1)).trim();
          if (val) {
            try { localStorage.setItem(key, val); } catch (e2) {}
            return val;
          }
          break;
        }
      }
    } catch (e) {}
    try {
      var stored = localStorage.getItem(key);
      if (stored && stored.trim()) {
        setSessionCookie(stored.trim());
        return stored.trim();
      }
    } catch (e) {}
    var newId = 'visitor_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);
    try { localStorage.setItem(key, newId); } catch (e) {}
    setSessionCookie(newId);
    return newId;
  }
  function setSessionCookie(sessionId) {
    try {
      var cookieName = 'pb_sid_' + (widgetId || '').replace(/[^a-z0-9-]/gi, '_');
      var isSecure = (typeof location !== 'undefined' && location.protocol === 'https:');
      var sameSite = isSecure ? '; SameSite=None; Secure' : '; SameSite=Lax';
      document.cookie = cookieName + '=' + encodeURIComponent(sessionId) + '; path=/; max-age=31536000' + sameSite;
    } catch (e) {}
  }
`;
