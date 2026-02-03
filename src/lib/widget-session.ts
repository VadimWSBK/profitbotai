/**
 * Shared session ID logic for the chat widget (embed). Used by ChatWindow and WidgetPreview.
 */
const SESSION_STORAGE_KEY = (id: string) => `profitbot_session_${id}`;

export function getSessionId(widgetId: string | undefined, browser: boolean): string {
	if (!widgetId) return 'preview';
	if (!browser) return 'preview';
	const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('session_id') : null;
	const fromUrl = typeof params === 'string' ? params.trim() : '';
	if (fromUrl) return fromUrl;
	const key = SESSION_STORAGE_KEY(widgetId);
	let stored = '';
	try {
		stored = localStorage.getItem(key) ?? '';
	} catch {
		// ignore
	}
	if (stored.trim()) return stored.trim();
	const newId = `visitor_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
	try {
		localStorage.setItem(key, newId);
	} catch {
		// ignore
	}
	return newId;
}
