<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	type ProductOption = { name: string; productHandle: string };
	type ProductEntry = { product_handle: string; role: string; coverage_per_sqm?: number | null };

	const ROLE_OPTIONS: { value: string; label: string }[] = [
		{ value: 'sealant', label: 'Sealant' },
		{ value: 'thermal', label: 'Thermal coating' },
		{ value: 'sealer', label: 'Sealer' },
		{ value: 'geo', label: 'Geo-textile' },
		{ value: 'rapidCure', label: 'Rapid-cure' },
		{ value: 'brushRoller', label: 'Brush / Roller kit' }
	];

	const keyParam = $derived($page.params.key);
	const isNew = $derived(keyParam === 'new');

	let calculatorKey = $state('');
	let name = $state('');
	let productEntries = $state<ProductEntry[]>([]);
	let products = $state<ProductOption[]>([]);
	let loaded = $state(false);
	let saving = $state(false);
	let errorMessage = $state<string | null>(null);

	async function loadProducts() {
		const res = await fetch('/api/settings/product-pricing');
		const data = await res.json().catch(() => ({}));
		const raw = (data.products ?? []) as Array<{ name?: string; productHandle?: string | null }>;
		products = raw
			.filter((p) => p.productHandle && String(p.productHandle).trim())
			.map((p) => ({ name: p.name ?? p.productHandle ?? '', productHandle: String(p.productHandle).trim() }));
	}

	async function loadKitBuilder() {
		if (isNew) {
			calculatorKey = '';
			name = '';
			productEntries = [];
			loaded = true;
			return;
		}
		const res = await fetch(`/api/settings/diy-kit-builders/${encodeURIComponent(keyParam ?? '')}`);
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			errorMessage = (data.error as string) ?? 'Not found';
			loaded = true;
			return;
		}
		const kb = data.kitBuilder as { calculator_key: string; name: string; product_entries?: ProductEntry[] };
		calculatorKey = kb.calculator_key ?? '';
		name = kb.name ?? '';
		productEntries = Array.isArray(kb.product_entries) ? [...kb.product_entries] : [];
		loaded = true;
	}

	async function load() {
		await loadProducts();
		await loadKitBuilder();
	}

	function addEntry() {
		productEntries = [...productEntries, { product_handle: products[0]?.productHandle ?? '', role: 'sealant', coverage_per_sqm: null }];
	}

	function removeEntry(i: number) {
		productEntries = productEntries.filter((_, idx) => idx !== i);
	}

	function updateEntry(i: number, field: keyof ProductEntry, value: string | number | boolean | null | undefined) {
		productEntries = productEntries.map((e, idx) =>
			idx === i ? { ...e, [field]: value } : e
		);
	}

	async function save() {
		const slug = isNew ? calculatorKey.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') : keyParam;
		if (!slug) {
			errorMessage = 'Calculator key is required (e.g. roof-kit)';
			return;
		}
		if (!/^[a-z0-9-]+$/.test(slug)) {
			errorMessage = 'Key must be lowercase letters, numbers and hyphens only';
			return;
		}
		saving = true;
		errorMessage = null;
		try {
			const res = await fetch(`/api/settings/diy-kit-builders/${encodeURIComponent(slug)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name.trim() || slug,
					product_entries: productEntries.filter((e) => e.product_handle && e.role)
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				errorMessage = (data.error as string) ?? 'Failed to save';
				return;
			}
			goto(`/settings/diy-kit-builders/${encodeURIComponent(slug)}`);
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		if (!loaded) load();
	});
</script>

<svelte:head>
	<title>{isNew ? 'New' : name || keyParam} Kit Builder – Settings – ProfitBot</title>
</svelte:head>

<div class="max-w-3xl mx-auto">
	<div class="mb-6">
		<a href="/settings/diy-kit-builders" class="text-sm text-gray-500 hover:text-gray-700">← DIY Kit Builders</a>
		<h1 class="text-2xl font-bold text-gray-900 mt-1">{isNew ? 'New kit builder' : (name || keyParam)}</h1>
		<p class="text-gray-500 mt-1">Assign products to roles and set optional coverage (L/m² or m/m² for geo) per product. First product in each role with coverage set is used as the override.</p>
	</div>

	{#if errorMessage}
		<div class="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">{errorMessage}</div>
	{/if}

	<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
		{#if isNew}
			<label class="block">
				<span class="text-sm font-medium text-gray-700">Calculator key</span>
				<input
					type="text"
					bind:value={calculatorKey}
					placeholder="e.g. roof-kit"
					class="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
				/>
				<p class="text-xs text-gray-500 mt-1">Lowercase letters, numbers and hyphens only. Used in API and as default when only one kit exists.</p>
			</label>
		{:else}
			<p class="text-sm text-gray-600"><span class="font-medium">Key:</span> {keyParam}</p>
		{/if}

		<label class="block">
			<span class="text-sm font-medium text-gray-700">Display name</span>
			<input type="text" bind:value={name} placeholder="e.g. Roof kit" class="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
		</label>

		<div>
			<div class="flex items-center justify-between mb-2">
				<span class="text-sm font-medium text-gray-700">Product entries</span>
				<button
					type="button"
					onclick={addEntry}
					class="text-sm text-amber-600 hover:text-amber-700 font-medium"
				>
					+ Add row
				</button>
			</div>
			{#if products.length === 0}
				<p class="text-sm text-gray-500 py-4">Sync products in <a href="/products" class="text-amber-600 hover:underline">Products</a> first, then add entries here.</p>
			{:else}
				<div class="border border-gray-200 rounded-lg overflow-hidden">
					<table class="w-full text-sm">
						<thead class="bg-gray-50 border-b border-gray-200">
							<tr>
								<th class="text-left py-2 px-3 font-medium text-gray-700">Product</th>
								<th class="text-left py-2 px-3 font-medium text-gray-700">Role</th>
								<th class="text-left py-2 px-3 font-medium text-gray-700">Coverage (optional)</th>
								<th class="w-10"></th>
							</tr>
						</thead>
						<tbody>
							{#each productEntries as entry, i}
								<tr class="border-t border-gray-100">
									<td class="py-2 px-3">
										<select
											value={entry.product_handle}
											onchange={(e) => updateEntry(i, 'product_handle', (e.currentTarget as HTMLSelectElement).value)}
											class="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
										>
											<option value="">Select product</option>
											{#each products as p}
												<option value={p.productHandle}>{p.name}</option>
											{/each}
										</select>
									</td>
									<td class="py-2 px-3">
										<select
											value={entry.role}
											onchange={(e) => updateEntry(i, 'role', (e.currentTarget as HTMLSelectElement).value)}
											class="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
										>
											{#each ROLE_OPTIONS as opt}
												<option value={opt.value}>{opt.label}</option>
											{/each}
										</select>
									</td>
									<td class="py-2 px-3">
										<input
											type="number"
											step="any"
											min="0"
											placeholder="—"
											value={entry.coverage_per_sqm ?? ''}
											oninput={(e) => {
												const v = (e.currentTarget as HTMLInputElement).value;
												updateEntry(i, 'coverage_per_sqm', v === '' ? null : Number(v));
											}}
											class="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm"
										/>
									</td>
									<td class="py-2 px-2">
										<button type="button" onclick={() => removeEntry(i)} class="text-gray-400 hover:text-red-600" title="Remove">×</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

		<div class="flex gap-3 pt-2">
			<button
				type="button"
				disabled={saving}
				onclick={save}
				class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors"
			>
				{saving ? 'Saving…' : 'Save'}
			</button>
			<a href="/settings/diy-kit-builders" class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">Cancel</a>
		</div>
	</div>
</div>
