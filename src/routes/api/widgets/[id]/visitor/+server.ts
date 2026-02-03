import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/supabase.server';

/**
 * GET /api/widgets/[id]/visitor?session_id= – contact name for this widget + session (for embed).
 * No auth; used by the chat widget to personalize the tooltip (e.g. "Hi {first_name} 👋").
 */
export const GET: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	const sessionId = event.url.searchParams.get('session_id');
	if (!widgetId || !sessionId?.trim()) {
		return json({ name: null });
	}
	try {
		const supabase = getSupabase();
		const { data: conv, error: convError } = await supabase
			.from('widget_conversations')
			.select('id')
			.eq('widget_id', widgetId)
			.eq('session_id', sessionId.trim())
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
