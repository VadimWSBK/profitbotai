<script lang="ts">
	import { LLM_PROVIDERS } from '$lib/llm-providers';

	let keys = $state<Record<string, string>>({ openai: '', anthropic: '', google: '' });
	let saved = $state<string[]>([]);
	let saving = $state(false);
	let loaded = $state(false);
	let displayName = $state('');
	let avatarUrl = $state('');
	let profileSaving = $state(false);

	async function load() {
		const [keysRes, profileRes] = await Promise.all([
			fetch('/api/settings/llm-keys'),
			fetch('/api/settings/profile')
		]);
		const keysData = await keysRes.json().catch(() => ({}));
		const profileData = await profileRes.json().catch(() => ({}));
		saved = (keysData.providers as string[]) ?? [];
		displayName = profileData.displayName ?? '';
		avatarUrl = profileData.avatarUrl ?? '';
		loaded = true;
	}

	async function saveProfile() {
		profileSaving = true;
		try {
			const res = await fetch('/api/settings/profile', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ displayName: displayName.trim(), avatarUrl: avatarUrl.trim() })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save');
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to save profile');
		} finally {
			profileSaving = false;
		}
	}

	async function saveKeys() {
		saving = true;
		try {
			// Only send non-empty keys so we don't clear others
			const payload: Record<string, string> = {};
			if (keys.openai?.trim()) payload.openai = keys.openai.trim();
			if (keys.anthropic?.trim()) payload.anthropic = keys.anthropic.trim();
			if (keys.google?.trim()) payload.google = keys.google.trim();
			const res = await fetch('/api/settings/llm-keys', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Failed to save');
			await load();
			keys = { openai: '', anthropic: '', google: '' };
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to save');
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		if (!loaded) load();
	});
</script>

<svelte:head>
	<title>Settings – ProfitBot</title>
</svelte:head>

<div class="max-w-2xl mx-auto">
	<h1 class="text-2xl font-bold text-gray-900">Settings</h1>
	<p class="text-gray-500 mt-1 mb-8">App and LLM API keys for Direct LLM chat.</p>

	<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
		<h2 class="text-lg font-semibold text-gray-900 mb-1">Profile</h2>
		<p class="text-gray-500 text-sm mb-4">Your profile photo appears when you take over a chat (instead of the bot logo).</p>
		<div class="space-y-4">
			<label class="block">
				<span class="text-sm font-medium text-gray-700 mb-1">Display name</span>
				<input type="text" bind:value={displayName} placeholder="Your name" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
			</label>
			<label class="block">
				<span class="text-sm font-medium text-gray-700 mb-1">Profile photo URL</span>
				<input type="url" bind:value={avatarUrl} placeholder="https://..." class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
			</label>
		</div>
		<button type="button" disabled={profileSaving} onclick={saveProfile} class="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-60 text-gray-800 font-medium rounded-lg transition-colors">
			{profileSaving ? 'Saving…' : 'Save profile'}
		</button>
	</div>

	<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
		<h2 class="text-lg font-semibold text-gray-900 mb-1">LLM API keys</h2>
		<p class="text-gray-500 text-sm mb-6">
			Add API keys for providers you want to use in the Connect tab (Direct LLM). Keys are stored per account and only used when a widget is set to Direct LLM.
		</p>
		<div class="space-y-4">
			{#each LLM_PROVIDERS as provider}
				<label class="block">
					<span class="text-sm font-medium text-gray-700 mb-1">{provider.name}</span>
					<div class="flex items-center gap-2">
						<input
							type="password"
							autocomplete="off"
							bind:value={keys[provider.id]}
							placeholder={saved.includes(provider.id) ? '•••••••• (leave empty to keep current)' : 'Paste API key (e.g. sk-...)'}
							class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
						/>
						{#if saved.includes(provider.id)}
							<span class="text-xs text-green-600 shrink-0">Saved</span>
						{/if}
					</div>
				</label>
			{/each}
		</div>
		<button
			type="button"
			disabled={saving}
			onclick={saveKeys}
			class="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors"
		>
			{saving ? 'Saving…' : 'Save keys'}
		</button>
	</div>
</div>
