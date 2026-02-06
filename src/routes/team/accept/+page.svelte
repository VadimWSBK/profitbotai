<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';

	let loading = $state(true);
	let error = $state<string | null>(null);
	let success = $state(false);

	async function acceptInvitation() {
		const token = $page.url.searchParams.get('token');
		if (!token) {
			error = 'Invalid invitation link';
			loading = false;
			return;
		}

		try {
			const res = await fetch('/api/team/accept', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token })
			});

			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Failed to accept invitation');

			success = true;
			setTimeout(() => {
				goto('/team');
			}, 2000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to accept invitation';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		acceptInvitation();
	});
</script>

<div class="max-w-md mx-auto mt-12">
	<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
		{#if loading}
			<div class="mb-4">
				<div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600"></div>
			</div>
			<p class="text-gray-600">Accepting invitation...</p>
		{:else if success}
			<div class="mb-4">
				<svg
					class="mx-auto h-12 w-12 text-green-500"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M5 13l4 4L19 7"
					/>
				</svg>
			</div>
			<h1 class="text-2xl font-bold text-gray-900 mb-2">Invitation Accepted!</h1>
			<p class="text-gray-600 mb-4">You've been added to the workspace.</p>
			<p class="text-sm text-gray-500">Redirecting to team page...</p>
		{:else if error}
			<div class="mb-4">
				<svg class="mx-auto h-12 w-12 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
			</div>
			<h1 class="text-2xl font-bold text-gray-900 mb-2">Invitation Error</h1>
			<p class="text-gray-600 mb-4">{error}</p>
			<a
				href="/login"
				class="inline-block px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
			>
				Go to Login
			</a>
		{/if}
	</div>
</div>
