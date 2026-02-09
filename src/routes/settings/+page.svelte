<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { LLM_PROVIDERS } from '$lib/llm-providers';
	import { Check } from '@lucide/svelte';

	let keys = $state<Record<string, string>>({ openai: '', anthropic: '', google: '' });
	let saved = $state<string[]>([]);
	let saving = $state(false);
	let loaded = $state(false);
	let displayName = $state('');
	let avatarUrl = $state('');
	let profileSaving = $state(false);
	let profileUploading = $state(false);
	let fileInput: HTMLInputElement;

	type MCPKey = {
		id: string;
		name: string | null;
		apiKey: string | null;
		fullApiKey?: string | null;
		lastUsedAt: string | null;
		createdAt: string;
	};
	let mcpKeys = $state<MCPKey[]>([]);
	let mcpKeysLoading = $state(false);
	let mcpKeysCreating = $state(false);
	let mcpKeyName = $state('');
	let newlyCreatedKey: string | null = $state(null);
	let copiedKeys = $state<Set<string>>(new Set());
	let deleteConfirmKey: MCPKey | null = $state(null);
	let errorMessage: string | null = $state(null);

	async function load() {
		const [keysRes, profileRes, mcpKeysRes] = await Promise.all([
			fetch('/api/settings/llm-keys'),
			fetch('/api/settings/profile'),
			fetch('/api/settings/mcp-keys')
		]);
		const keysData = await keysRes.json().catch(() => ({}));
		const profileData = await profileRes.json().catch(() => ({}));
		const mcpKeysData = await mcpKeysRes.json().catch(() => ({}));
		saved = (keysData.providers as string[]) ?? [];
		displayName = profileData.displayName ?? '';
		avatarUrl = profileData.avatarUrl ?? '';
		mcpKeys = (mcpKeysData.keys as MCPKey[]) ?? [];
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
			await invalidateAll();
		} catch (e) {
			showError(e instanceof Error ? e.message : 'Failed to save profile');
		} finally {
			profileSaving = false;
		}
	}

	async function onProfilePhotoSelected(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		profileUploading = true;
		try {
			const formData = new FormData();
			formData.append('file', file);
			const res = await fetch('/api/settings/profile/upload', { method: 'POST', body: formData });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Upload failed');
			avatarUrl = data.url ?? '';
			await saveProfile();
		} catch (err) {
			showError(err instanceof Error ? err.message : 'Upload failed');
		} finally {
			profileUploading = false;
			input.value = '';
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
			showError(e instanceof Error ? e.message : 'Failed to save');
		} finally {
			saving = false;
		}
	}

	async function createMCPKey() {
		if (mcpKeysCreating) return;
		mcpKeysCreating = true;
		newlyCreatedKey = null;
		try {
			const res = await fetch('/api/settings/mcp-keys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: mcpKeyName.trim() || null })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Failed to create key');
			newlyCreatedKey = data.key?.apiKey || null;
			mcpKeyName = '';
			await load();
		} catch (e) {
			showError(e instanceof Error ? e.message : 'Failed to create MCP key');
		} finally {
			mcpKeysCreating = false;
		}
	}

	function showDeleteConfirm(key: MCPKey) {
		deleteConfirmKey = key;
	}

	function cancelDelete() {
		deleteConfirmKey = null;
	}

	function showError(message: string) {
		errorMessage = message;
	}

	function closeError() {
		errorMessage = null;
	}

	async function confirmDelete() {
		if (!deleteConfirmKey) return;
		const keyId = deleteConfirmKey.id;
		deleteConfirmKey = null;
		try {
			const res = await fetch(`/api/settings/mcp-keys/${keyId}`, {
				method: 'DELETE'
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Failed to delete key');
			await load();
		} catch (e) {
			showError(e instanceof Error ? e.message : 'Failed to delete MCP key');
		}
	}

	function copyToClipboard(text: string, keyId: string) {
		navigator.clipboard.writeText(text).then(() => {
			// Create a new Set to trigger reactivity in Svelte 5
			copiedKeys = new Set([...copiedKeys, keyId]);
			// Reset after 2 seconds
			setTimeout(() => {
				const newSet = new Set(copiedKeys);
				newSet.delete(keyId);
				copiedKeys = newSet;
			}, 2000);
		});
	}

	function formatDate(iso: string | null): string {
		if (!iso) return 'Never';
		const d = new Date(iso);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
	<p class="text-gray-500 mt-1 mb-8">App and LLM API keys for Direct LLM chat. Manage products and Shopify sync in <a href="/products" class="text-amber-600 hover:text-amber-700 underline">Products</a>. Configure DIY quote kits in <a href="/settings/diy-kit-builders" class="text-amber-600 hover:text-amber-700 underline">DIY Kit Builders</a>.</p>

	<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
		<h2 class="text-lg font-semibold text-gray-900 mb-1">Profile</h2>
		<p class="text-gray-500 text-sm mb-4">Your profile photo appears when you take over a chat (instead of the bot logo).</p>
		<div class="space-y-4">
			<label class="block">
				<span class="text-sm font-medium text-gray-700 mb-1">Display name</span>
				<input type="text" bind:value={displayName} placeholder="Your name" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
			</label>
			<div class="flex items-start gap-4">
				{#if avatarUrl}
					<img src={avatarUrl} alt="Profile" class="w-16 h-16 rounded-full object-cover border border-gray-200 shrink-0" />
				{:else}
					<div class="w-16 h-16 rounded-full bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center text-gray-400 text-xs">No photo</div>
				{/if}
				<div class="flex-1 min-w-0 space-y-2">
					<input
						type="file"
						accept="image/png,image/jpeg,image/gif,image/webp"
						class="hidden"
						bind:this={fileInput}
						onchange={onProfilePhotoSelected}
					/>
					<button
						type="button"
						disabled={profileUploading}
						onclick={() => fileInput?.click()}
						class="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-60 rounded-lg transition-colors"
					>
						{profileUploading ? 'Uploading…' : 'Upload photo'}
					</button>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Or paste profile photo URL</span>
						<input type="url" bind:value={avatarUrl} placeholder="https://..." class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
					</label>
				</div>
			</div>
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

	<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mt-6">
		<h2 class="text-lg font-semibold text-gray-900 mb-1">MCP API Keys</h2>
		<p class="text-gray-500 text-sm mb-4">
			Generate API keys to connect OpenClaw or other MCP clients to your workspace. Each key is scoped to your workspace and allows full access to manage leads, send messages, and more.
		</p>

		{#if newlyCreatedKey}
			<div class="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
				<p class="text-sm font-medium text-green-800 mb-2">New API key created! Copy it now - you won't be able to see it again.</p>
				<div class="flex items-center gap-2">
					<code class="flex-1 px-3 py-2 bg-white border border-green-300 rounded text-sm font-mono break-all">{newlyCreatedKey}</code>
					<button
						type="button"
						onclick={() => copyToClipboard(newlyCreatedKey!, 'new-key')}
						class="px-3 py-2 text-white text-sm font-medium rounded-lg transition-colors shrink-0 flex items-center gap-1.5 {copiedKeys.has('new-key') ? 'bg-green-600 hover:bg-green-700' : 'bg-green-600 hover:bg-green-700'}"
					>
						{#if copiedKeys.has('new-key')}
							<Check class="w-4 h-4" />
							<span>Copied</span>
						{:else}
							<span>Copy</span>
						{/if}
					</button>
				</div>
			</div>
		{/if}

		<div class="space-y-3 mb-4">
			{#if mcpKeys.length === 0}
				<p class="text-gray-500 text-sm">No MCP API keys yet. Create one to connect OpenClaw.</p>
			{:else}
				{#each mcpKeys as key}
					<div class="p-4 border border-gray-200 rounded-lg">
						<div class="flex items-start justify-between gap-4">
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 mb-1">
									<span class="text-sm font-medium text-gray-900">{key.name || 'Unnamed key'}</span>
									{#if key.fullApiKey}
										<span class="text-xs text-green-600">New</span>
									{/if}
								</div>
								<code class="text-xs text-gray-600 font-mono block mb-2 break-all">{key.apiKey || '••••••••'}</code>
								<div class="text-xs text-gray-500">
									Created {formatDate(key.createdAt)} • Last used {formatDate(key.lastUsedAt)}
								</div>
							</div>
							<div class="flex items-center gap-2 shrink-0">
								{#if key.fullApiKey}
									<button
										type="button"
										onclick={() => copyToClipboard(key.fullApiKey!, key.id)}
										class="px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5 {copiedKeys.has(key.id) ? 'text-green-700 bg-green-100 hover:bg-green-200 border border-green-300' : 'text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100'}"
									>
										{#if copiedKeys.has(key.id)}
											<Check class="w-3.5 h-3.5" />
											<span>Copied</span>
										{:else}
											<span>Copy</span>
										{/if}
									</button>
								{/if}
								<button
									type="button"
									onclick={() => showDeleteConfirm(key)}
									class="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded transition-colors"
								>
									Delete
								</button>
							</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<div class="flex gap-2">
			<input
				type="text"
				bind:value={mcpKeyName}
				placeholder="Optional name (e.g., 'OpenClaw Production')"
				class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
				onkeydown={(e) => e.key === 'Enter' && createMCPKey()}
			/>
			<button
				type="button"
				disabled={mcpKeysCreating}
				onclick={createMCPKey}
				class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors"
			>
				{mcpKeysCreating ? 'Creating…' : 'Create Key'}
			</button>
		</div>

		<div class="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
			<p class="text-xs text-blue-800">
				<strong>How to use:</strong> Copy the API key and add it to your MCP configuration as <code class="bg-blue-100 px-1 rounded">MCP_API_KEY</code>. See the MCP server README for setup instructions.
			</p>
		</div>
	</div>

	<!-- Delete Confirmation Modal -->
	{#if deleteConfirmKey}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
			onclick={cancelDelete}
			onkeydown={(e) => e.key === 'Escape' && cancelDelete()}
			role="presentation"
		>
			<div
				class="rounded-xl border border-gray-200 bg-white shadow-xl max-w-md w-full"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="delete-confirm-title"
				tabindex="-1"
			>
				<div class="p-6">
					<h2 id="delete-confirm-title" class="text-lg font-semibold text-gray-900 mb-2">
						Delete MCP API Key?
					</h2>
					<p class="text-sm text-gray-600 mb-1">
						Are you sure you want to delete the MCP API key <strong>"{deleteConfirmKey.name || 'Unnamed key'}"</strong>?
					</p>
					<p class="text-sm text-gray-600 mb-6">
						This will disconnect OpenClaw or any other MCP client using this key. This action cannot be undone.
					</p>
					<div class="flex gap-3 justify-end">
						<button
							type="button"
							onclick={cancelDelete}
							class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
						>
							Cancel
						</button>
						<button
							type="button"
							onclick={confirmDelete}
							class="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
						>
							Delete
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Error Modal -->
	{#if errorMessage}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
			onclick={closeError}
			onkeydown={(e) => e.key === 'Escape' && closeError()}
			role="presentation"
		>
			<div
				class="rounded-xl border border-gray-200 bg-white shadow-xl max-w-md w-full"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="error-title"
				tabindex="-1"
			>
				<div class="p-6">
					<h2 id="error-title" class="text-lg font-semibold text-gray-900 mb-2">
						Error
					</h2>
					<p class="text-sm text-gray-600 mb-6">
						{errorMessage}
					</p>
					<div class="flex justify-end">
						<button
							type="button"
							onclick={closeError}
							class="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors"
						>
							OK
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
