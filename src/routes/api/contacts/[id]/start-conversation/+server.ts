import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * POST /api/contacts/[id]/start-conversation
 * Ensures the contact has a conversation: if they already have one, returns it;
 * otherwise creates a new widget_conversation, links it to the contact, and returns it.
 * User must own the contact (via RLS). If contact has no widget_id, uses the user's first widget.
 */
export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const contactId = event.params.id;
	if (!contactId) return json({ error: 'Missing contact id' }, { status: 400 });

	const supabase = getSupabaseClient(event);

	// Load contact (RLS: user must own the contact's widget or contact has null widget)
	const { data: contact, error: contactError } = await supabase
		.from('contacts')
		.select('id, conversation_id, widget_id')
		.eq('id', contactId)
		.maybeSingle();

	if (contactError) {
		console.error('POST /api/contacts/[id]/start-conversation:', contactError);
		return json({ error: contactError.message }, { status: 500 });
	}
	if (!contact) return json({ error: 'Contact not found' }, { status: 404 });

	const r = contact as { id: string; conversation_id: string | null; widget_id: string | null };

	// Already has a conversation: return it
	if (r.conversation_id) {
		return json({ conversationId: r.conversation_id });
	}

	// Need a widget: use contact's widget or first widget the user owns
	let widgetId = r.widget_id;
	if (!widgetId) {
		const { data: widgets } = await supabase
			.from('widgets')
			.select('id')
			.limit(1);
		const first = Array.isArray(widgets) && widgets.length > 0 ? (widgets[0] as { id: string }).id : null;
		if (!first) {
			return json({ error: 'No widget found. Create a widget first.' }, { status: 400 });
		}
		widgetId = first;
	}

	// One conversation per contact per widget
	const sessionId = `contact-${r.id}`;

	// Create conversation (unique on widget_id, session_id)
	const { data: newConv, error: insertError } = await supabase
		.from('widget_conversations')
		.insert({ widget_id: widgetId, session_id: sessionId, is_ai_active: true })
		.select('id')
		.single();

	if (insertError) {
		// Might already exist from a race
		if (insertError.code === '23505') {
			const { data: existing } = await supabase
				.from('widget_conversations')
				.select('id')
				.eq('widget_id', widgetId)
				.eq('session_id', sessionId)
				.maybeSingle();
			if (existing) {
				const convId = (existing as { id: string }).id;
				await supabase.from('contacts').update({ conversation_id: convId, widget_id: widgetId }).eq('id', r.id);
				return json({ conversationId: convId });
			}
		}
		console.error('POST /api/contacts/[id]/start-conversation insert:', insertError);
		return json({ error: insertError.message }, { status: 500 });
	}

	const conversationId = (newConv as { id: string }).id;

	// Link contact to the new conversation
	const { error: updateError } = await supabase
		.from('contacts')
		.update({ conversation_id: conversationId, widget_id: widgetId })
		.eq('id', r.id);

	if (updateError) {
		console.error('POST /api/contacts/[id]/start-conversation update contact:', updateError);
		return json({ error: updateError.message }, { status: 500 });
	}

	return json({ conversationId });
};
