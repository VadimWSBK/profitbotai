/**
 * POST /api/conversations/[id]/send-email
 * Send an email to the contact from the Messages view. Stores in contact_emails for tracking.
 * Body: { subject: string, body: string }
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient, getSupabaseAdmin } from '$lib/supabase.server';
import { sendContactEmail } from '$lib/send-quote-email.server';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = event.params.id;
	if (!id) return json({ error: 'Missing conversation id' }, { status: 400 });

	let body: { subject?: string; body?: string };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
	const emailBody = typeof body?.body === 'string' ? body.body.trim() : '';
	if (!subject) return json({ error: 'subject required' }, { status: 400 });
	if (!emailBody) return json({ error: 'body required' }, { status: 400 });

	const supabase = user.id === 'api-key' ? getSupabaseAdmin() : getSupabaseClient(event);
	const { data: conv, error: convError } = await supabase
		.from('widget_conversations')
		.select('id, widget_id, widgets(created_by)')
		.eq('id', id)
		.single();
	if (convError || !conv) return json({ error: 'Conversation not found' }, { status: 404 });

	const { data: contactRow } = await supabase
		.from('contacts')
		.select('id, name, email')
		.eq('conversation_id', id)
		.maybeSingle();
	if (!contactRow?.email) return json({ error: 'Contact has no email' }, { status: 400 });

	const widget = Array.isArray(conv.widgets) ? conv.widgets[0] : conv.widgets;
	const ownerId = (widget as { created_by?: string })?.created_by;
	if (!ownerId) return json({ error: 'Could not determine widget owner' }, { status: 500 });

	const result = await sendContactEmail(supabase, ownerId, {
		toEmail: (contactRow as { email: string }).email,
		subject,
		body: emailBody,
		contactId: (contactRow as { id: string }).id,
		conversationId: id,
		customerName: (contactRow as { name: string | null }).name ?? null
	});

	if (result.sent) return json({ sent: true });
	return json({ error: result.error ?? 'Failed to send' }, { status: 500 });
};
