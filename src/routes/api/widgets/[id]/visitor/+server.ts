import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/supabase.server';

function sessionCookieName(widgetId: string): string {
	return 'pb_sid_' + (widgetId || '').replace(/[^a-z0-9-]/gi, '_');
}

/**
 * GET /api/widgets/[id]/visitor?session_id= – contact name for this widget + session (for embed).
 * No auth; used by the chat widget to personalize the tooltip (e.g. "Hi {first_name} 👋").
 * Sets session cookie so GET /messages can restore session after refresh.
 */
export const GET: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	const sessionId = event.url.searchParams.get('session_id')?.trim();
	if (!widgetId || !sessionId) {
		return json({ name: null });
	}
	try {
		const cookieName = sessionCookieName(widgetId);
		const isSecure = event.url.protocol === 'https:';
		event.cookies.set(cookieName, sessionId, {
			path: '/',
			maxAge: 31536000,
			sameSite: isSecure ? 'none' : 'lax',
			secure: isSecure
		});

		const supabase = getSupabase();
		const { data: conv, error: convError } = await supabase
			.from('widget_conversations')
			.select('id')
			.eq('widget_id', widgetId)
			.eq('session_id', sessionId)
			.maybeSingle();
		if (convError || !conv) return json({ name: null });
		const { data: contact } = await supabase
			.from('contacts')
			.select('name')
			.eq('conversation_id', conv.id)
			.maybeSingle();
		const name = (contact?.name as string | null) ?? null;
		return json({ name: name?.trim() || null });
	} catch {
		return json({ name: null });
	}
};
