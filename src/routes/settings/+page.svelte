<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { LLM_PROVIDERS } from '$lib/llm-providers';

	let keys = $state<Record<string, string>>({ openai: '', anthropic: '', google: '' });
	let saved = $state<string[]>([]);
	let saving = $state(false);
	let loaded = $state(false);
	let displayName = $state('');
	let avatarUrl = $state('');
	let profileSaving = $state(false);
	let profileUploading = $state(false);
	let fileInput: HTMLInputElement;

	type ProductRow = { id?: string; name: string; sizeLitres: number; price: number; currency: string; coverageSqm: number; imageUrl: string };
	let products = $state<ProductRow[]>([]);
	let productsSaving = $state(false);

	async function load() {
		const [keysRes, profileRes, productsRes] = await Promise.all([
			fetch('/api/settings/llm-keys'),
			fetch('/api/settings/profile'),
			fetch('/api/settings/product-pricing')
		]);
		const keysData = await keysRes.json().catch(() => ({}));
		const profileData = await profileRes.json().catch(() => ({}));
		const productsData = await productsRes.json().catch(() => ({}));
		saved = (keysData.providers as string[]) ?? [];
		displayName = profileData.displayName ?? '';
		avatarUrl = profileData.avatarUrl ?? '';
		const raw = productsData.products ?? [];
		products = raw.length > 0
			? raw.map((p: { id?: string; name: string; sizeLitres: number; price: number; currency?: string; coverageSqm: number; imageUrl?: string | null }) => ({
					id: p.id,
					name: p.name ?? '',
					sizeLitres: Number(p.sizeLitres) ?? 0,
					price: Number(p.price) ?? 0,
					currency: p.currency ?? 'AUD',
					coverageSqm: Number(p.coverageSqm) ?? 0,
					imageUrl: p.imageUrl ?? ''
				}))
			: [
					{ name: 'NetZero UltraTherm 15L Bucket', sizeLitres: 15, price: 389.99, currency: 'AUD', coverageSqm: 30, imageUrl: '' },
					{ name: 'NetZero UltraTherm 10L Bucket', sizeLitres: 10, price: 285.99, currency: 'AUD', coverageSqm: 20, imageUrl: '' },
					{ name: 'NetZero UltraTherm 5L Bucket', sizeLitres: 5, price: 149.99, currency: 'AUD', coverageSqm: 10, imageUrl: '' }
				];
		loaded = true;
	}

	async function saveProducts() {
		productsSaving = true;
		try {
			const res = await fetch('/api/settings/product-pricing', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					products: products.map((p) => ({
						name: p.name.trim(),
						sizeLitres: p.sizeLitres,
						price: p.price,
						currency: p.currency || 'AUD',
						coverageSqm: p.coverageSqm,
						imageUrl: p.imageUrl.trim() || null
					}))
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Failed to save');
			await load();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to save products');
		} finally {
			productsSaving = false;
		}
	}

	function addProduct() {
		products = [...products, { name: '', sizeLitres: 5, price: 0, currency: 'AUD', coverageSqm: 10, imageUrl: '' }];
	}

	function removeProduct(i: number) {
		products = products.filter((_, idx) => idx !== i);
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
			alert(e instanceof Error ? e.message : 'Failed to save profile');
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
			alert(err instanceof Error ? err.message : 'Upload failed');
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

	<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
		<h2 class="text-lg font-semibold text-gray-900 mb-1">Product pricing</h2>
		<p class="text-gray-500 text-sm mb-4">
			DIY bucket products used by the agent for quotes and checkout links. Prices and coverage are injected into the chat context.
		</p>
		<div class="space-y-4">
			{#each products as product, i}
				<div class="p-4 border border-gray-200 rounded-lg space-y-3">
					<div class="flex justify-between items-center">
						<span class="text-sm font-medium text-gray-600">Product {i + 1}</span>
						<button type="button" onclick={() => removeProduct(i)} class="text-red-600 hover:text-red-700 text-sm">Remove</button>
					</div>
					<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<label class="col-span-2">
							<span class="text-xs text-gray-500">Name</span>
							<input type="text" bind:value={product.name} placeholder="e.g. NetZero 15L Bucket" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
						</label>
						<label>
							<span class="text-xs text-gray-500">Size (L)</span>
							<input type="number" bind:value={product.sizeLitres} min="1" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
						</label>
						<label>
							<span class="text-xs text-gray-500">Coverage (m²)</span>
							<input type="number" bind:value={product.coverageSqm} min="0" step="0.1" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
						</label>
						<label>
							<span class="text-xs text-gray-500">Price</span>
							<input type="number" bind:value={product.price} min="0" step="0.01" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
						</label>
						<label>
							<span class="text-xs text-gray-500">Currency</span>
							<input type="text" bind:value={product.currency} placeholder="AUD" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
						</label>
						<label class="col-span-2 sm:col-span-4">
							<span class="text-xs text-gray-500">Image URL (optional)</span>
							<input type="url" bind:value={product.imageUrl} placeholder="https://..." class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
						</label>
					</div>
				</div>
			{/each}
		</div>
		<div class="flex gap-2 mt-4">
			<button type="button" onclick={addProduct} class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
				Add product
			</button>
			<button type="button" disabled={productsSaving} onclick={saveProducts} class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors">
				{productsSaving ? 'Saving…' : 'Save products'}
			</button>
		</div>
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
