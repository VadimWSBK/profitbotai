import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * POST /api/conversations/[id]/typing – set agent typing state (debounced from Messages UI).
 * Body: { active?: boolean } – default true. Sets agent_typing_until 5s from now when active.
 */
export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = event.params.id;
	if (!id) return json({ error: 'Missing conversation id' }, { status: 400 });

	let body: { active?: boolean };
	try {
		body = await event.request.json().catch(() => ({}));
	} catch {
		body = {};
	}
	const active = body.active !== false;

	const supabase = getSupabaseClient(event);
	const { error } = await supabase
		.from('widget_conversations')
		.update({
			agent_typing_until: active ? new Date(Date.now() + 5000).toISOString() : null,
			agent_typing_by: active ? user.id : null
		})
		.eq('id', id);

	if (error) return json({ error: error.message }, { status: 500 });
	return json({ ok: true });
};
