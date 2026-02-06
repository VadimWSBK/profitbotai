import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';

/**
 * POST /api/team/accept – accept an invitation by token
 * Body: { token: string }
 */
export const POST: RequestHandler = async (event) => {
	if (!event.locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await event.request.json().catch(() => ({}));
		const token = typeof body.token === 'string' ? body.token : null;

		if (!token) {
			return json({ error: 'Token is required' }, { status: 400 });
		}

		const supabase = getSupabaseAdmin();

		// Call the accept_workspace_invitation function
		const { data, error } = await supabase.rpc('accept_workspace_invitation', {
			p_token: token,
			p_user_id: event.locals.user.id
		});

		if (error) {
			console.error('Error accepting invitation:', error);
			return json({ error: error.message }, { status: 400 });
		}

		return json({ success: true, workspace_id: data });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to accept invitation';
		console.error('POST /api/team/accept:', e);
		return json({ error: msg }, { status: 500 });
	}
};
