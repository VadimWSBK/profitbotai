import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * DELETE /api/team/members/[id] – remove a team member
 */
export const DELETE: RequestHandler = async (event) => {
	if (!event.locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const memberId = event.params.id;
	if (!memberId) {
		return json({ error: 'Missing member id' }, { status: 400 });
	}

	try {
		const supabase = getSupabaseClient(event);

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
			return json({ error: 'Only owners and admins can remove members' }, { status: 403 });
		}

		// Get the member to remove
		const { data: memberToRemove } = await supabase
			.from('team_members')
			.select('user_id, role')
			.eq('id', memberId)
			.eq('workspace_id', profile.workspace_id)
			.single();

		if (!memberToRemove) {
			return json({ error: 'Member not found' }, { status: 404 });
		}

		// Prevent removing the owner
		if (memberToRemove.role === 'owner') {
			return json({ error: 'Cannot remove workspace owner' }, { status: 400 });
		}

		// Prevent removing yourself
		if (memberToRemove.user_id === event.locals.user.id) {
			return json({ error: 'Cannot remove yourself' }, { status: 400 });
		}

		// Remove member
		const { error } = await supabase
			.from('team_members')
			.delete()
			.eq('id', memberId)
			.eq('workspace_id', profile.workspace_id);

		if (error) {
			console.error('Error removing member:', error);
			return json({ error: error.message }, { status: 500 });
		}

		return json({ success: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to remove member';
		console.error('DELETE /api/team/members/[id]:', e);
		return json({ error: msg }, { status: 500 });
	}
};
