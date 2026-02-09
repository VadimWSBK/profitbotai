<script lang="ts">
	type ProductRow = {
		id?: string;
		name: string;
		sizeLitres: number;
		price: number;
		currency: string;
		coverageSqm: number;
		imageUrl: string;
		description: string;
		colors: string[];
		productHandle: string;
	};

	const PRODUCT_HANDLES = [
		{ value: '', label: 'Sealant (default)' },
		{ value: 'waterproof-sealant', label: 'Waterproof sealant' },
		{ value: 'protective-top-coat', label: 'Thermal coating' },
		{ value: 'sealer', label: 'Sealer' },
		{ value: 'geo-textile', label: 'Geo-textile' },
		{ value: 'rapid-cure-spray', label: 'Rapid-cure spray' },
		{ value: 'brush-roller', label: 'Brush / Roller kit' }
	] as const;

	let products = $state<ProductRow[]>([]);
	let productsSaving = $state(false);
	let loaded = $state(false);
	let errorMessage = $state<string | null>(null);
	let shopifyConnected = $state(false);
	let shopifyDomain = $state('');
	let syncProductsLoading = $state(false);
	let syncProductsResult = $state<{ synced: number } | null>(null);

	async function load() {
		const [integrationsRes, productsRes] = await Promise.all([
			fetch('/api/settings/integrations'),
			fetch('/api/settings/product-pricing')
		]);
		const integrationsData = await integrationsRes.json().catch(() => ({}));
		const productsData = await productsRes.json().catch(() => ({}));

		shopifyConnected = Array.isArray(integrationsData.connected) && integrationsData.connected.includes('shopify');
		shopifyDomain = integrationsData.configs?.shopify?.shopDomain ?? '';

		const raw = productsData.products ?? [];
		products =
			raw.length > 0
				? raw.map(
						(p: {
							id?: string;
							name: string;
							sizeLitres: number;
							price: number;
							currency?: string;
							coverageSqm: number;
							imageUrl?: string | null;
							description?: string | null;
							colors?: string[] | null;
							productHandle?: string | null;
						}) => ({
							id: p.id,
							name: p.name ?? '',
							sizeLitres: Number(p.sizeLitres) ?? 0,
							price: Number(p.price) ?? 0,
							currency: p.currency ?? 'AUD',
							coverageSqm: Number(p.coverageSqm) ?? 0,
							imageUrl: p.imageUrl ?? '',
							description: p.description ?? '',
							colors: Array.isArray(p.colors) ? p.colors : [],
							productHandle: p.productHandle && String(p.productHandle).trim() ? p.productHandle.trim() : ''
						})
					)
				: [
						{ name: 'NetZero UltraTherm 15L Bucket', sizeLitres: 15, price: 389.99, currency: 'AUD', coverageSqm: 2, imageUrl: '', description: '', colors: [] as string[], productHandle: '' },
						{ name: 'NetZero UltraTherm 10L Bucket', sizeLitres: 10, price: 285.99, currency: 'AUD', coverageSqm: 2, imageUrl: '', description: '', colors: [] as string[], productHandle: '' },
						{ name: 'NetZero UltraTherm 5L Bucket', sizeLitres: 5, price: 149.99, currency: 'AUD', coverageSqm: 2, imageUrl: '', description: '', colors: [] as string[], productHandle: '' }
					];
		loaded = true;
	}

	async function syncShopifyProducts() {
		syncProductsLoading = true;
		syncProductsResult = null;
		errorMessage = null;
		try {
			const res = await fetch('/api/settings/integrations/shopify/sync-products', {
				method: 'POST'
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				errorMessage = (data.error as string) ?? 'Failed to sync products';
				return;
			}
			syncProductsResult = { synced: data.synced ?? 0 };
			await load();
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : 'Failed to sync products';
		} finally {
			syncProductsLoading = false;
		}
	}

	async function saveProducts() {
		productsSaving = true;
		errorMessage = null;
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
						imageUrl: p.imageUrl.trim() || null,
						description: p.description.trim() || null,
						colors: p.colors.length > 0 ? p.colors : null,
						productHandle: p.productHandle?.trim() || null
					}))
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Failed to save');
			await load();
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : 'Failed to save products';
		} finally {
			productsSaving = false;
		}
	}

	function addProduct() {
		products = [
			...products,
			{ name: '', sizeLitres: 5, price: 0, currency: 'AUD', coverageSqm: 2, imageUrl: '', description: '', colors: [], productHandle: '' }
		];
	}

	function removeProduct(i: number) {
		products = products.filter((_, idx) => idx !== i);
	}

	function closeError() {
		errorMessage = null;
	}

	$effect(() => {
		if (!loaded) load();
	});
</script>

<svelte:head>
	<title>Products – ProfitBot</title>
</svelte:head>

<div class="max-w-3xl mx-auto">
	<h1 class="text-2xl font-bold text-gray-900">Products</h1>
	<p class="text-gray-500 mt-1 mb-6">
		Sync products from Shopify and manage product pricing. Used by the agent for DIY quotes, roof-kit calculator, and checkout links.
	</p>

	{#if errorMessage}
		<div
			class="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center justify-between gap-2"
			role="alert"
		>
			<span>{errorMessage}</span>
			<button
				type="button"
				onclick={closeError}
				class="shrink-0 text-red-600 hover:text-red-800 p-1"
				aria-label="Dismiss"
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
			</button>
		</div>
	{/if}

	{#if !loaded}
		<div class="text-gray-500">Loading…</div>
	{:else}
		<!-- Sync from Shopify -->
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
			<h2 class="text-lg font-semibold text-gray-900 mb-1">Sync from Shopify</h2>
			<p class="text-gray-500 text-sm mb-4">
				Pull product names, images, variant IDs, and prices from your connected Shopify store into the product list below. Connect Shopify in <a href="/integrations" class="text-amber-600 hover:text-amber-700 underline">Integrations</a> first.
			</p>
			{#if shopifyConnected}
				<div class="flex flex-wrap items-center gap-2">
					<button
						type="button"
						disabled={syncProductsLoading}
						onclick={syncShopifyProducts}
						class="px-4 py-2 bg-gray-800 hover:bg-gray-900 disabled:opacity-60 text-white font-medium rounded-lg transition-colors text-sm"
					>
						{syncProductsLoading ? 'Syncing…' : 'Sync products from Shopify'}
					</button>
					{#if syncProductsResult}
						<span class="text-sm text-gray-500">{syncProductsResult.synced} product(s) synced</span>
					{/if}
					<span class="text-xs text-gray-500">{shopifyDomain}</span>
				</div>
			{:else}
				<p class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
					Shopify is not connected. <a href="/integrations" class="font-medium underline">Connect your store</a> to sync products.
				</p>
			{/if}
		</div>

		<!-- Product pricing list -->
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h2 class="text-lg font-semibold text-gray-900 mb-1">Product pricing</h2>
			<p class="text-gray-500 text-sm mb-4">
				DIY products used by the agent for quotes and checkout links. Prices and coverage are injected into the chat context. Set <strong>Product type</strong> for roof-kit calculator (e.g. sealant, thermal coating, brush-roller).
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
								<input type="number" bind:value={product.sizeLitres} min="0" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
							</label>
							<label>
								<span class="text-xs text-gray-500">Coverage (sqm/L)</span>
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
							<label class="col-span-2">
								<span class="text-xs text-gray-500">Product type (roof-kit)</span>
								<select
									bind:value={product.productHandle}
									class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
								>
									{#each PRODUCT_HANDLES as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							</label>
							<label class="col-span-2 sm:col-span-4">
								<span class="text-xs text-gray-500">Image URL (optional)</span>
								<input type="url" bind:value={product.imageUrl} placeholder="https://..." class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
							</label>
							<label class="col-span-2 sm:col-span-4">
								<span class="text-xs text-gray-500">Description (optional)</span>
								<textarea bind:value={product.description} placeholder="Product description…" rows="2" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y"></textarea>
							</label>
							{#if product.colors.length > 0}
								<div class="col-span-2 sm:col-span-4">
									<span class="text-xs text-gray-500">Colors</span>
									<div class="flex flex-wrap gap-1.5 mt-1">
										{#each product.colors as color}
											<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{color}</span>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
			<div class="flex gap-2 mt-4">
				<button
					type="button"
					onclick={addProduct}
					class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
				>
					Add product
				</button>
				<button
					type="button"
					disabled={productsSaving}
					onclick={saveProducts}
					class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors"
				>
					{productsSaving ? 'Saving…' : 'Save products'}
				</button>
			</div>
		</div>
	{/if}
</div>
