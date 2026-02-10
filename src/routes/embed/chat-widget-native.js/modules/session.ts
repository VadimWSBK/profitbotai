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
    // Prefer localStorage (set when we created the session / had the conversation) so we show the same conversation as Messages menu
    try {
      var stored = localStorage.getItem(key);
      if (stored && stored.trim()) {
        var sid = stored.trim();
        setSessionCookie(sid);
        setSessionInUrl(sid);
        return sid;
      }
    } catch (e) {}
    try {
      var cookies = document.cookie.split(';');
      for (var i = 0; i < cookies.length; i++) {
        var part = cookies[i].trim();
        if (part.indexOf(cookieName + '=') === 0) {
          var val = decodeURIComponent(part.slice(cookieName.length + 1)).trim();
          if (val) {
            try { localStorage.setItem(key, val); } catch (e2) {}
            setSessionInUrl(val);
            return val;
          }
          break;
        }
      }
    } catch (e) {}
    var newId = 'visitor_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);
    try { localStorage.setItem(key, newId); } catch (e) {}
    setSessionCookie(newId);
    setSessionInUrl(newId);
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
  function setSessionInUrl(sessionId) {
    try {
      if (typeof window === 'undefined' || !window.history || !window.location) return;
      var url = new URL(window.location.href);
      url.searchParams.set('session_id', sessionId);
      window.history.replaceState(null, '', url.toString());
    } catch (e) {}
  }
`;
