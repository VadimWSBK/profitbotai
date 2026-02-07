import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';

/**
 * POST /api/conversations/[id]/messages/save
 * Saves a message to widget_conversation_messages using conversationId directly.
 * More efficient than /api/widgets/[widgetId]/messages/save - no need to know widgetId.
 * 
 * Body: {
 *   role: 'user' | 'assistant' | 'human_agent',
 *   content: string,
 *   createdAt?: string (optional ISO 8601 timestamp, defaults to now())
 * }
 * 
 * Auth: Public (for n8n webhook calls) or X-API-Key
 */
export const POST: RequestHandler = async (event) => {
	const conversationId = event.params.id;
	if (!conversationId) {
		return json({ error: 'Missing conversation id' }, { status: 400 });
	}

	let body: {
		role?: string;
		content?: string;
		createdAt?: string;
	};
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const role = typeof body.role === 'string' ? body.role.trim() : '';
	const content = typeof body.content === 'string' ? body.content.trim() : '';
	let createdAt: string | undefined = undefined;
	if (typeof body.createdAt === 'string' && body.createdAt.trim()) {
		const parsed = new Date(body.createdAt.trim());
		if (!isNaN(parsed.getTime())) {
			createdAt = parsed.toISOString();
		}
	}

	if (!role || !['user', 'assistant', 'human_agent'].includes(role)) {
		return json({ error: 'Invalid role. Must be: user, assistant, or human_agent' }, { status: 400 });
	}
	if (!content) {
		return json({ error: 'Missing content' }, { status: 400 });
	}

	try {
		const admin = getSupabaseAdmin();
		
		// Verify conversation exists and get widgetId (for validation)
		const { data: conv, error: convError } = await admin
			.from('widget_conversations')
			.select('id, widget_id')
			.eq('id', conversationId)
			.single();
		
		if (convError || !conv) {
			return json({ error: 'Conversation not found' }, { status: 404 });
		}

		// Insert message
		const insertData: {
			conversation_id: string;
			role: 'user' | 'assistant' | 'human_agent';
			content: string;
			created_at?: string;
		} = {
			conversation_id: conversationId,
			role: role as 'user' | 'assistant' | 'human_agent',
			content
		};
		if (createdAt) {
			insertData.created_at = createdAt;
		}

		const { data: message, error: msgError } = await admin
			.from('widget_conversation_messages')
			.insert(insertData)
			.select('id, role, content, created_at')
			.single();

		if (msgError || !message) {
			console.error('Error inserting message:', msgError);
			return json({ error: 'Failed to save message' }, { status: 500 });
		}

		return json({
			success: true,
			message: {
				id: message.id,
				role: message.role,
				content: message.content,
				createdAt: message.created_at
			},
			conversationId: conversationId,
			widgetId: conv.widget_id
		}, { status: 201 });
	} catch (e) {
		console.error('POST /api/conversations/[id]/messages/save error:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
