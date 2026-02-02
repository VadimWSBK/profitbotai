import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/templates – list current user's email templates.
 * POST /api/templates – create a new email template.
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const supabase = getSupabaseClient(event);
	const { data, error } = await supabase
		.from('email_templates')
		.select('id, name, subject, body, created_at, updated_at')
		.eq('user_id', event.locals.user.id)
		.order('created_at', { ascending: false });
	if (error) {
		console.error('GET /api/templates:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json({ templates: data ?? [] });
};

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	let body: { name?: string; subject?: string; body?: string };
	try {
		body = await event.request.json().catch(() => ({}));
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const supabase = getSupabaseClient(event);
	const name = typeof body?.name === 'string' ? body.name.trim() || 'Untitled template' : 'Untitled template';
	const subject = typeof body?.subject === 'string' ? body.subject : '';
	const bodyText = typeof body?.body === 'string' ? body.body : '';

	const { data, error } = await supabase
		.from('email_templates')
		.insert({
			user_id: event.locals.user.id,
			name,
			subject,
			body: bodyText
		})
		.select('id, name, subject, body, created_at, updated_at')
		.single();

	if (error) {
		console.error('POST /api/templates:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json({ template: data });
};
