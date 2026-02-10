/**
 * Shared session ID logic for the chat widget (embed). Used by ChatWindow and WidgetPreview.
 * Persists in both localStorage and cookie so conversation survives refresh (cookie fallback when localStorage is blocked or cleared).
 */
const SESSION_STORAGE_KEY = (id: string) => `profitbot_session_${id}`;

const COOKIE_NAME = (id: string) => `pb_sid_${id.replace(/[^a-z0-9-]/gi, '_')}`;

function getSessionFromCookie(widgetId: string): string | null {
	if (typeof document === 'undefined' || !document.cookie) return null;
	const name = COOKIE_NAME(widgetId);
	const cookies = document.cookie.split(';');
	for (const part of cookies) {
		const trimmed = part.trim();
		if (trimmed.startsWith(name + '=')) {
			const val = decodeURIComponent(trimmed.slice(name.length + 1)).trim();
			return val || null;
		}
	}
	return null;
}

function setSessionCookie(widgetId: string, sessionId: string): void {
	try {
		const name = COOKIE_NAME(widgetId);
		document.cookie = `${name}=${encodeURIComponent(sessionId)}; path=/; max-age=31536000; SameSite=Lax`;
	} catch {
		// ignore
	}
}

function setSessionInUrl(sessionId: string): void {
	try {
		if (typeof window === 'undefined' || !window.history?.replaceState || !window.location) return;
		const url = new URL(window.location.href);
		url.searchParams.set('session_id', sessionId);
		window.history.replaceState(null, '', url.toString());
	} catch {
		// ignore
	}
}

export function getSessionId(widgetId: string | undefined, browser: boolean): string {
	if (!widgetId) return 'preview';
	if (!browser) return 'preview';
	const params = globalThis.window === undefined ? null : new URLSearchParams(globalThis.window.location.search).get('session_id');
	const fromUrl = typeof params === 'string' ? params.trim() : '';
	if (fromUrl) return fromUrl;
	const key = SESSION_STORAGE_KEY(widgetId);
	try {
		const stored = localStorage.getItem(key) ?? '';
		if (stored.trim()) {
			const sid = stored.trim();
			setSessionCookie(widgetId, sid);
			setSessionInUrl(sid);
			return sid;
		}
	} catch {
		// ignore
	}
	try {
		const fromCookie = getSessionFromCookie(widgetId);
		if (fromCookie) {
			try {
				localStorage.setItem(key, fromCookie);
				setSessionInUrl(fromCookie);
			} catch {
				// ignore
			}
			return fromCookie;
		}
	} catch {
		// ignore
	}
	const newId = `visitor_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
	try {
		localStorage.setItem(key, newId);
	} catch {
		// ignore
	}
	setSessionCookie(widgetId, newId);
	setSessionInUrl(newId);
	return newId;
}

/** Persist session (e.g. after API returns reattach sessionId) so it survives refresh. */
export function setSessionId(widgetId: string | undefined, sessionId: string): void {
	if (!widgetId || !sessionId.trim()) return;
	const key = SESSION_STORAGE_KEY(widgetId);
	try {
		localStorage.setItem(key, sessionId.trim());
		setSessionCookie(widgetId, sessionId.trim());
		setSessionInUrl(sessionId.trim());
	} catch {
		// ignore
	}
}
