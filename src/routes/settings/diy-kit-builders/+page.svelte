<script lang="ts">
	import { goto } from '$app/navigation';

	type KitBuilder = {
		id: string;
		calculator_key: string;
		name: string;
		product_entries: { product_handle: string; role: string; coverage_per_sqm?: number | null }[];
	};

	let kitBuilders = $state<KitBuilder[]>([]);
	let loaded = $state(false);
	let errorMessage = $state<string | null>(null);

	async function load() {
		const res = await fetch('/api/settings/diy-kit-builders');
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			errorMessage = (data.error as string) ?? 'Failed to load';
			return;
		}
		kitBuilders = (data.kitBuilders ?? []) as KitBuilder[];
		loaded = true;
	}

	function edit(key: string) {
		goto(`/settings/diy-kit-builders/${encodeURIComponent(key)}`);
	}

	$effect(() => {
		if (!loaded) load();
	});
</script>

<svelte:head>
	<title>DIY Kit Builders – Settings – ProfitBot</title>
</svelte:head>

<div class="max-w-2xl mx-auto">
	<div class="mb-6 flex items-center justify-between gap-4">
		<div>
			<a href="/settings" class="text-sm text-gray-500 hover:text-gray-700">← Settings</a>
			<h1 class="text-2xl font-bold text-gray-900 mt-1">DIY Kit Builders</h1>
			<p class="text-gray-500 mt-1">Configure kit builders with products and coverage per product. The default kit (e.g. roof-kit) is used when customers ask for a DIY quote by area.</p>
		</div>
		<a
			href="/settings/diy-kit-builders/new"
			class="shrink-0 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors"
		>
			Add kit builder
		</a>
	</div>

	{#if errorMessage}
		<div class="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">{errorMessage}</div>
	{/if}

	<div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
		{#if !loaded}
			<p class="p-6 text-gray-500">Loading…</p>
		{:else if kitBuilders.length === 0}
			<div class="p-8 text-center text-gray-500">
				<p class="mb-4">No kit builders yet.</p>
				<a href="/settings/diy-kit-builders/new" class="text-amber-600 hover:text-amber-700 font-medium">Create your first kit builder</a>
			</div>
		{:else}
			<ul class="divide-y divide-gray-200">
				{#each kitBuilders as kb}
					<li>
						<button
							type="button"
							onclick={() => edit(kb.calculator_key)}
							class="w-full text-left px-6 py-4 hover:bg-gray-50 flex items-center justify-between gap-4 transition-colors"
						>
							<div>
								<span class="font-medium text-gray-900">{kb.name}</span>
								<span class="text-gray-500 text-sm ml-2">({kb.calculator_key})</span>
								<p class="text-sm text-gray-500 mt-0.5">{kb.product_entries?.length ?? 0} product entries</p>
							</div>
							<span class="text-gray-400">→</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
