import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * DELETE /api/team/invitations/[id] – cancel/delete an invitation
 */
export const DELETE: RequestHandler = async (event) => {
	if (!event.locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const supabase = getSupabaseClient(event);
		const invitationId = event.params.id;

		// Get user's workspace_id
		const { data: profile } = await supabase
			.from('profiles')
			.select('workspace_id')
			.eq('user_id', event.locals.user.id)
			.single();

		if (!profile?.workspace_id) {
			return json({ error: 'Workspace not found' }, { status: 404 });
		}

		// Check if user is owner or admin
		const { data: member } = await supabase
			.from('team_members')
			.select('role')
			.eq('workspace_id', profile.workspace_id)
			.eq('user_id', event.locals.user.id)
			.single();

		if (!member || !['owner', 'admin'].includes(member.role)) {
			return json({ error: 'Only owners and admins can delete invitations' }, { status: 403 });
		}

		// Delete invitation
		const { error } = await supabase
			.from('workspace_invitations')
			.delete()
			.eq('id', invitationId)
			.eq('workspace_id', profile.workspace_id);

		if (error) {
			console.error('Error deleting invitation:', error);
			return json({ error: error.message }, { status: 500 });
		}

		return json({ success: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to delete invitation';
		console.error('DELETE /api/team/invitations/[id]:', e);
		return json({ error: msg }, { status: 500 });
	}
};
