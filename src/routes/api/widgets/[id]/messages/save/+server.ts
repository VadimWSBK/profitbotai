import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase, getSupabaseAdmin } from '$lib/supabase.server';

/**
 * POST /api/widgets/[id]/messages/save
 * Saves a message to widget_conversation_messages.
 * Used by n8n workflows to sync messages from n8n_chat_histories to widget_conversation_messages.
 * 
 * Body: {
 *   sessionId: string (required if conversationId not provided),
 *   conversationId?: string (optional, will be resolved from sessionId if not provided),
 *   role: 'user' | 'assistant' | 'human_agent',
 *   content: string,
 *   createdAt?: string (optional ISO 8601 timestamp, defaults to now())
 * }
 * 
 * Auth: Public (for n8n webhook calls) or X-API-Key
 */
export const POST: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	if (!widgetId) {
		return json({ error: 'Missing widget id' }, { status: 400 });
	}

	let body: {
		sessionId?: string;
		conversationId?: string;
		role?: string;
		content?: string;
		createdAt?: string;
		checkoutPreview?: {
			lineItemsUI?: unknown[];
			summary?: Record<string, unknown>;
			checkoutUrl?: string;
		};
	};
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : null;
	const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : null;
	const role = typeof body.role === 'string' ? body.role.trim() : '';
	const content = typeof body.content === 'string' ? body.content.trim() : '';
	let createdAt: string | undefined = undefined;
	if (typeof body.createdAt === 'string' && body.createdAt.trim()) {
		// Validate it's a valid ISO 8601 timestamp
		const parsed = new Date(body.createdAt.trim());
		if (!isNaN(parsed.getTime())) {
			createdAt = parsed.toISOString();
		}
	}

	if (!sessionId && !conversationId) {
		return json({ error: 'Missing sessionId or conversationId' }, { status: 400 });
	}
	if (!role || !['user', 'assistant', 'human_agent'].includes(role)) {
		return json({ error: 'Invalid role. Must be: user, assistant, or human_agent' }, { status: 400 });
	}
	if (!content) {
		return json({ error: 'Missing content' }, { status: 400 });
	}

	try {
		const admin = getSupabaseAdmin();
		
		// Verify widget exists
		const { data: widget, error: widgetError } = await admin
			.from('widgets')
			.select('id')
			.eq('id', widgetId)
			.single();
		if (widgetError || !widget) {
			return json({ error: 'Widget not found' }, { status: 404 });
		}

		let finalConversationId: string;

		if (conversationId) {
			// Verify conversation exists and belongs to this widget
			const { data: conv, error: convError } = await admin
				.from('widget_conversations')
				.select('id')
				.eq('id', conversationId)
				.eq('widget_id', widgetId)
				.single();
			if (convError || !conv) {
				return json({ error: 'Conversation not found or does not belong to this widget' }, { status: 404 });
			}
			finalConversationId = conversationId;
		} else if (sessionId) {
			// Get or create conversation
			const { data: existingConv, error: findError } = await admin
				.from('widget_conversations')
				.select('id')
				.eq('widget_id', widgetId)
				.eq('session_id', sessionId)
				.single();
			
			if (findError && findError.code !== 'PGRST116') {
				console.error('Error finding conversation:', findError);
				return json({ error: 'Failed to find conversation' }, { status: 500 });
			}

			if (existingConv) {
				finalConversationId = existingConv.id;
			} else {
				// Create conversation
				const { data: newConv, error: createError } = await admin
					.from('widget_conversations')
					.insert({
						widget_id: widgetId,
						session_id: sessionId,
						is_ai_active: true
					})
					.select('id')
					.single();
				if (createError || !newConv) {
					console.error('Error creating conversation:', createError);
					return json({ error: 'Failed to create conversation' }, { status: 500 });
				}
				finalConversationId = newConv.id;

				// Ensure a contact row exists for this conversation
				await admin
					.from('contacts')
					.upsert(
						{ conversation_id: finalConversationId, widget_id: widgetId },
						{ onConflict: 'conversation_id', ignoreDuplicates: true }
					);
			}
		} else {
			return json({ error: 'Missing sessionId or conversationId' }, { status: 400 });
		}

		// Insert message with optional timestamp
		const insertData: {
			conversation_id: string;
			role: 'user' | 'assistant' | 'human_agent';
			content: string;
			created_at?: string;
		} = {
			conversation_id: finalConversationId,
			role: role as 'user' | 'assistant' | 'human_agent',
			content
		};
		// Only set created_at if provided (otherwise database default will be used)
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

		// If assistant message includes checkoutPreview, persist so Messages and embed show full breakdown (line items + images + summary)
		const preview = body.checkoutPreview;
		if (
			role === 'assistant' &&
			preview &&
			typeof preview === 'object' &&
			Array.isArray(preview.lineItemsUI) &&
			preview.lineItemsUI.length > 0 &&
			typeof preview.checkoutUrl === 'string' &&
			preview.checkoutUrl.trim()
		) {
			const summary = preview.summary && typeof preview.summary === 'object' ? preview.summary : {};
			await admin.from('widget_checkout_previews').insert({
				conversation_id: finalConversationId,
				widget_id: widgetId,
				message_id: message.id,
				line_items_ui: preview.lineItemsUI,
				summary,
				checkout_url: preview.checkoutUrl.trim()
			});
		}

		return json({
			success: true,
			message: {
				id: message.id,
				role: message.role,
				content: message.content,
				createdAt: message.created_at
			},
			conversationId: finalConversationId
		}, { status: 201 });
	} catch (e) {
		console.error('POST /api/widgets/[id]/messages/save error:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
