import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/team/invitations – list invitations for current user's workspace
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

		// Get invitations for this workspace (include token for generating links)
		const { data: invitations, error } = await supabase
			.from('workspace_invitations')
			.select('id, email, role, status, created_at, expires_at, invited_by, token')
			.eq('workspace_id', profile.workspace_id)
			.order('created_at', { ascending: false });

		if (error) {
			console.error('Error fetching invitations:', error);
			return json({ error: error.message }, { status: 500 });
		}

		return json({ invitations: invitations ?? [] });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to fetch invitations';
		console.error('GET /api/team/invitations:', e);
		return json({ error: msg }, { status: 500 });
	}
};

/**
 * POST /api/team/invitations – create a new invitation
 * Body: { email: string, role?: 'admin' | 'member' }
 */
export const POST: RequestHandler = async (event) => {
	if (!event.locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const supabase = getSupabaseClient(event);
		const body = await event.request.json().catch(() => ({}));

		const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
		const role = body.role === 'admin' ? 'admin' : 'member';

		if (!email || !email.includes('@')) {
			return json({ error: 'Valid email is required' }, { status: 400 });
		}

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
			return json({ error: 'Only owners and admins can invite members' }, { status: 403 });
		}

		// Check if user is already a member
		const { data: existingUser } = await supabase
			.from('auth.users')
			.select('id')
			.eq('email', email)
			.single();

		if (existingUser) {
			const { data: existingMember } = await supabase
				.from('team_members')
				.select('id')
				.eq('workspace_id', profile.workspace_id)
				.eq('user_id', existingUser.id)
				.single();

			if (existingMember) {
				return json({ error: 'User is already a member of this workspace' }, { status: 400 });
			}
		}

		// Create invitation
		const { data: invitation, error } = await supabase
			.from('workspace_invitations')
			.insert({
				workspace_id: profile.workspace_id,
				email,
				role,
				invited_by: event.locals.user.id
			})
			.select('id, email, role, status, created_at, expires_at, token')
			.single();

		if (error) {
			console.error('Error creating invitation:', error);
			// Handle duplicate invitation error
			if (error.code === '23505') {
				return json({ error: 'An invitation for this email already exists' }, { status: 400 });
			}
			return json({ error: error.message }, { status: 500 });
		}

		return json({ invitation }, { status: 201 });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to create invitation';
		console.error('POST /api/team/invitations:', e);
		return json({ error: msg }, { status: 500 });
	}
};
