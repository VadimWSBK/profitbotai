import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getSupabaseClient } from '$lib/supabase.server';
import { parseChatwootConversationId } from '$lib/chatwoot-conversation-id';

/**
 * POST /api/conversations/[id]/messages – send a message as human_agent (take over reply).
 * Supports widget conversations (UUID id) and Chatwoot (chatwoot-{accountId}-{conversationId}).
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
	const chatwoot = parseChatwootConversationId(id);

	if (chatwoot) {
		const { accountId, conversationId } = chatwoot;
		const botToken = (env.CHATWOOT_BOT_ACCESS_TOKEN ?? '').trim();
		const baseUrl = (env.CHATWOOT_BASE_URL ?? '').trim().replace(/\/+$/, '');
		if (!botToken || !baseUrl) {
			return json({ error: 'Chatwoot not configured. Set CHATWOOT_BOT_ACCESS_TOKEN and CHATWOOT_BASE_URL.' }, { status: 503 });
		}
		const { data: contactRow, error: contactErr } = await supabase
			.from('contacts')
			.select('id, agent_id')
			.eq('chatwoot_account_id', accountId)
			.eq('chatwoot_conversation_id', conversationId)
			.maybeSingle();
		if (contactErr || !contactRow) return json({ error: 'Conversation not found' }, { status: 404 });
		const agentId = (contactRow as { agent_id: string | null }).agent_id;
		const postUrl = `${baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
		const postRes = await fetch(postUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				api_access_token: botToken
			},
			body: JSON.stringify({ content, message_type: 'outgoing' })
		});
		if (!postRes.ok) {
			const errText = await postRes.text();
			console.error('[conversations/messages] Chatwoot API error:', postRes.status, errText);
			return json({ error: 'Failed to send message to Chatwoot' }, { status: 502 });
		}
		const { data: msg, error } = await supabase
			.from('chatwoot_conversation_messages')
			.insert({
				account_id: accountId,
				conversation_id: conversationId,
				agent_id: agentId,
				role: 'human_agent',
				content
			})
			.select('id, role, content, created_at')
			.single();
		if (error) {
			console.error('[conversations/messages] Failed to store Chatwoot human reply:', error);
			return json({ error: error.message }, { status: 500 });
		}
		return json({
			message: {
				id: msg.id,
				role: msg.role,
				content: msg.content,
				createdAt: msg.created_at
			}
		}, { status: 201 });
	}

	// Widget conversation
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
