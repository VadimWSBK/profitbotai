<script lang="ts">
	import { onMount } from 'svelte';

	type Member = {
		id: string;
		user_id: string;
		display_name: string;
		avatar_url: string | null;
		role: 'owner' | 'admin' | 'member';
		created_at: string;
	};

	type Invitation = {
		id: string;
		email: string;
		role: 'admin' | 'member';
		status: 'pending' | 'accepted' | 'expired' | 'cancelled';
		created_at: string;
		expires_at: string;
		token?: string;
	};

	let members = $state<Member[]>([]);
	let invitations = $state<Invitation[]>([]);
	let loaded = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Invite form
	let inviteEmail = $state('');
	let inviteRole = $state<'admin' | 'member'>('member');
	let inviting = $state(false);

	// Current user's role
	let currentUserRole = $state<'owner' | 'admin' | 'member' | null>(null);

	async function load() {
		loading = true;
		error = null;
		try {
			const [membersRes, invitationsRes, userRes] = await Promise.all([
				fetch('/api/team/members'),
				fetch('/api/team/invitations'),
				fetch('/api/auth/user').catch(() => ({ ok: false, json: async () => ({}) } as Response))
			]);

			const membersData = await membersRes.json().catch(() => ({}));
			const invitationsData = await invitationsRes.json().catch(() => ({}));
			const userData = await userRes.json().catch(() => ({}));

			if (!membersRes.ok) throw new Error(membersData.error || 'Failed to load members');
			if (!invitationsRes.ok) throw new Error(invitationsData.error || 'Failed to load invitations');

			members = membersData.members ?? [];
			invitations = invitationsData.invitations ?? [];

			// Find current user's role
			const currentUserId = userData.user?.id;
			if (currentUserId) {
				const currentMember = members.find((m) => m.user_id === currentUserId);
				currentUserRole = currentMember?.role ?? null;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load team data';
		} finally {
			loading = false;
			loaded = true;
		}
	}

	async function invite() {
		const email = inviteEmail.trim().toLowerCase();
		if (!email || !email.includes('@')) {
			error = 'Please enter a valid email address';
			return;
		}

		inviting = true;
		error = null;
		try {
			const res = await fetch('/api/team/invitations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, role: inviteRole })
			});

			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Failed to send invitation');

			inviteEmail = '';
			inviteRole = 'member';
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to send invitation';
		} finally {
			inviting = false;
		}
	}

	async function cancelInvitation(invitationId: string) {
		if (!confirm('Cancel this invitation?')) return;

		loading = true;
		try {
			const res = await fetch(`/api/team/invitations/${invitationId}`, {
				method: 'DELETE'
			});

			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Failed to cancel invitation');

			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to cancel invitation';
		} finally {
			loading = false;
		}
	}

	async function removeMember(memberId: string, memberName: string) {
		if (!confirm(`Remove ${memberName} from the team?`)) return;

		loading = true;
		try {
			const res = await fetch(`/api/team/members/${memberId}`, {
				method: 'DELETE'
			});

			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Failed to remove member');

			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to remove member';
		} finally {
			loading = false;
		}
	}

	function copyInviteLink(invitation: Invitation) {
		const origin = typeof window !== 'undefined' ? window.location.origin : '';
		const url = `${origin}/team/accept?token=${invitation.token}`;
		navigator.clipboard.writeText(url).then(() => {
			alert('Invitation link copied to clipboard!');
		});
	}

	function formatDate(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function getRoleBadgeColor(role: string): string {
		if (role === 'owner') return 'bg-purple-100 text-purple-800';
		if (role === 'admin') return 'bg-blue-100 text-blue-800';
		return 'bg-gray-100 text-gray-800';
	}

	onMount(() => {
		load();
	});
</script>

<div class="max-w-4xl">
	<div class="mb-6">
		<h1 class="text-2xl font-bold text-gray-900">Team Members</h1>
		<p class="text-sm text-gray-500 mt-1">Manage who has access to your workspace</p>
	</div>

	{#if error}
		<div class="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
			{error}
		</div>
	{/if}

	{#if !loaded}
		<div class="flex items-center justify-center py-12">
			<div class="text-gray-500">Loading...</div>
		</div>
	{:else}
		<!-- Invite new member -->
		{#if currentUserRole === 'owner' || currentUserRole === 'admin'}
			<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
				<h2 class="text-lg font-semibold text-gray-800 mb-4">Invite Team Member</h2>
				<div class="flex gap-3">
					<input
						type="email"
						bind:value={inviteEmail}
						placeholder="Enter email address"
						class="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
					/>
					<select
						bind:value={inviteRole}
						class="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
					>
						<option value="member">Member</option>
						<option value="admin">Admin</option>
					</select>
					<button
						onclick={invite}
						disabled={inviting || !inviteEmail.trim()}
						class="px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
					>
						{inviting ? 'Sending...' : 'Send Invitation'}
					</button>
				</div>
			</div>
		{/if}

		<!-- Team Members -->
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
			<h2 class="text-lg font-semibold text-gray-800 mb-4">Team Members ({members.length})</h2>
			{#if members.length === 0}
				<p class="text-gray-500 text-sm">No team members yet.</p>
			{:else}
				<div class="space-y-3">
					{#each members as member (member.id)}
						<div class="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50">
							<div class="flex items-center gap-3">
								{#if member.avatar_url}
									<img
										src={member.avatar_url}
										alt={member.display_name || 'Member'}
										class="w-10 h-10 rounded-full object-cover"
									/>
								{:else}
									<div
										class="w-10 h-10 rounded-full bg-amber-600 flex items-center justify-center text-white font-semibold"
									>
										{(member.display_name || 'M').charAt(0).toUpperCase()}
									</div>
								{/if}
								<div>
									<div class="font-medium text-gray-900">
										{member.display_name || 'Unnamed User'}
									</div>
									<div class="text-sm text-gray-500">Member since {formatDate(member.created_at)}</div>
								</div>
							</div>
							<div class="flex items-center gap-3">
								<span
									class="px-2 py-1 text-xs font-medium rounded {getRoleBadgeColor(member.role)}"
								>
									{member.role.charAt(0).toUpperCase() + member.role.slice(1)}
								</span>
								{#if (currentUserRole === 'owner' || currentUserRole === 'admin') &&
									member.role !== 'owner'}
									<button
										onclick={() => removeMember(member.id, member.display_name || 'this member')}
										class="text-red-600 hover:text-red-700 text-sm font-medium"
									>
										Remove
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Pending Invitations -->
		{#if currentUserRole === 'owner' || currentUserRole === 'admin'}
			<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
				<h2 class="text-lg font-semibold text-gray-800 mb-4">
					Pending Invitations ({invitations.filter((i) => i.status === 'pending').length})
				</h2>
				{#if invitations.filter((i) => i.status === 'pending').length === 0}
					<p class="text-gray-500 text-sm">No pending invitations.</p>
				{:else}
					<div class="space-y-3">
						{#each invitations.filter((i) => i.status === 'pending') as invitation (invitation.id)}
							<div class="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50">
								<div>
									<div class="font-medium text-gray-900">{invitation.email}</div>
									<div class="text-sm text-gray-500">
										Invited {formatDate(invitation.created_at)} • Expires{' '}
										{formatDate(invitation.expires_at)}
									</div>
								</div>
								<div class="flex items-center gap-3">
									<span
										class="px-2 py-1 text-xs font-medium rounded {getRoleBadgeColor(invitation.role)}"
									>
										{invitation.role.charAt(0).toUpperCase() + invitation.role.slice(1)}
									</span>
									{#if invitation.token}
										<button
											onclick={() => copyInviteLink(invitation)}
											class="text-amber-600 hover:text-amber-700 text-sm font-medium"
											title="Copy invitation link"
										>
											Copy Link
										</button>
									{/if}
									<button
										onclick={() => cancelInvitation(invitation.id)}
										class="text-red-600 hover:text-red-700 text-sm font-medium"
									>
										Cancel
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>
