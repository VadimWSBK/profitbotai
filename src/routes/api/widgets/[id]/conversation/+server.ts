/**
 * GET /api/widgets/[id]/conversation?session_id=...
 * Returns { conversationId } for the widget+session, creating the conversation if needed.
 * Used by the chat widget so it can send conversationId to n8n (and by n8n to resolve conversationId from sessionId).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

export const GET: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	const sessionId = event.url.searchParams.get('session_id')?.trim();
	if (!widgetId) return json({ error: 'Missing widget id' }, { status: 400 });
	if (!sessionId || sessionId === 'preview') {
		return json({ error: 'Missing or invalid session_id' }, { status: 400 });
	}

	const supabase = getSupabaseClient(event);
	let { data: conv, error: convErr } = await supabase
		.from('widget_conversations')
		.select('id')
		.eq('widget_id', widgetId)
		.eq('session_id', sessionId)
		.single();

	if (convErr && convErr.code !== 'PGRST116') {
		console.error('widget_conversations select:', convErr);
		return json({ error: 'Failed to load conversation' }, { status: 500 });
	}

	if (!conv) {
		const { data: inserted, error: insertErr } = await supabase
			.from('widget_conversations')
			.insert({ widget_id: widgetId, session_id: sessionId, is_ai_active: true })
			.select('id')
			.single();
		if (insertErr || !inserted) {
			console.error('widget_conversations insert:', insertErr);
			return json({ error: 'Failed to create conversation' }, { status: 500 });
		}
		conv = inserted;
	}

	// Ensure a contact row exists for this conversation
	await supabase
		.from('contacts')
		.upsert(
			{ conversation_id: conv.id, widget_id: widgetId },
			{ onConflict: 'conversation_id', ignoreDuplicates: true }
		);

	return json({ conversationId: conv.id });
};
