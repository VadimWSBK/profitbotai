import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient, getSupabaseAdmin } from '$lib/supabase.server';

/**
 * GET /api/team/members – list team members for current user's workspace
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
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

		// Get team members
		const { data: members, error } = await supabase
			.from('team_members')
			.select('id, role, created_at, user_id')
			.eq('workspace_id', profile.workspace_id)
			.order('created_at', { ascending: true });

		if (error) {
			console.error('Error fetching team members:', error);
			return json({ error: error.message }, { status: 500 });
		}

		if (!members || members.length === 0) {
			return json({ members: [] });
		}

		// Get user IDs
		const userIds = members.map((m: any) => m.user_id);

		// Get profiles for these users
		const { data: profiles } = await supabase
			.from('profiles')
			.select('user_id, display_name, avatar_url')
			.in('user_id', userIds);

		// Create a map of user_id to profile
		const profileMap = new Map(
			(profiles ?? []).map((p: any) => [p.user_id, { display_name: p.display_name, avatar_url: p.avatar_url }])
		);

		// Get emails using the function
		const supabaseAdmin = getSupabaseAdmin();
		const formattedMembers = await Promise.all(
			members.map(async (member: any) => {
				const { data: emailData } = await supabaseAdmin.rpc('get_user_email', {
					p_user_id: member.user_id
				});
				const profile = profileMap.get(member.user_id);
				return {
					id: member.id,
					user_id: member.user_id,
					email: emailData ?? '',
					display_name: profile?.display_name ?? '',
					avatar_url: profile?.avatar_url ?? null,
					role: member.role,
					created_at: member.created_at
				};
			})
		);

		return json({ members: formattedMembers });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to fetch team members';
		console.error('GET /api/team/members:', e);
		return json({ error: msg }, { status: 500 });
	}
};

/**
 * DELETE /api/team/members/[id] – remove a team member
 */
export const DELETE: RequestHandler = async (event) => {
	if (!event.locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const supabase = getSupabaseClient(event);
		const memberId = event.params.id;

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
