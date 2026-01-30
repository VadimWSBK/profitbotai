import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * POST /api/conversations/[id]/messages – send a message as human_agent (take over reply).
 * Body: { content: string }
 */
export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = event.params.id;
	if (!id) return json({ error: 'Missing conversation id' }, { status: 400 });

	let body: { content?: string };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const content = typeof body?.content === 'string' ? body.content.trim() : '';
	if (!content) return json({ error: 'content required' }, { status: 400 });

	const supabase = getSupabaseClient(event);
	// Verify user can access this conversation (RLS will block if not owner)
	const { data: conv, error: convError } = await supabase
		.from('widget_conversations')
		.select('id')
		.eq('id', id)
		.single();
	if (convError || !conv) return json({ error: 'Conversation not found' }, { status: 404 });

	const { data: msg, error } = await supabase
		.from('widget_conversation_messages')
		.insert({
			conversation_id: id,
			role: 'human_agent',
			content,
			created_by: user.id
		})
		.select('id, role, content, created_at')
		.single();
	if (error) return json({ error: error.message }, { status: 500 });

	return json({
		message: {
			id: msg.id,
			role: msg.role,
			content: msg.content,
			createdAt: msg.created_at
		}
	}, { status: 201 });
};
