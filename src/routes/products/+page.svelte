<script lang="ts">
	type VariantRow = {
		shopifyVariantId: number | null;
		sizeLitres: number;
		color: string | null;
		price: number;
		currency: string;
		coverageSqm: number;
		imageUrl: string | null;
	};

	type ProductRow = {
		id?: string;
		name: string;
		description: string;
		colors: string[];
		shopifyProductId: number | null;
		productHandle: string;
		variants: VariantRow[];
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
	let syncProductsResult = $state<{ synced: number; products?: number } | null>(null);

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
		if (raw.length > 0) {
			products = raw.map(
				(p: {
					id?: string;
					name?: string;
					description?: string | null;
					colors?: string[] | null;
					shopifyProductId?: number | null;
					productHandle?: string | null;
					variants?: Array<{
						shopifyVariantId?: number | null;
						sizeLitres?: number;
						color?: string | null;
						price?: number;
						currency?: string;
						coverageSqm?: number;
						imageUrl?: string | null;
					}>;
				}) => ({
					id: p.id,
					name: p.name ?? '',
					description: p.description ?? '',
					colors: Array.isArray(p.colors) ? p.colors : [],
					shopifyProductId: p.shopifyProductId != null ? Number(p.shopifyProductId) : null,
					productHandle: (p.productHandle && String(p.productHandle).trim()) || '',
					variants: (Array.isArray(p.variants) ? p.variants : []).map((v) => ({
						shopifyVariantId: v?.shopifyVariantId != null ? Number(v.shopifyVariantId) : null,
						sizeLitres: Number(v?.sizeLitres) ?? 0,
						color: typeof v?.color === 'string' ? v.color : null,
						price: Number(v?.price) ?? 0,
						currency: v?.currency ?? 'AUD',
						coverageSqm: Number(v?.coverageSqm) ?? 0,
						imageUrl: typeof v?.imageUrl === 'string' ? v.imageUrl : null
					}))
				})
			);
		} else {
			products = [
				{
					name: 'NetZero UltraTherm Roof Coating',
					description: '',
					colors: [],
					shopifyProductId: null,
					productHandle: '',
					variants: [
						{ shopifyVariantId: null, sizeLitres: 15, color: null, price: 389.99, currency: 'AUD', coverageSqm: 2, imageUrl: null },
						{ shopifyVariantId: null, sizeLitres: 10, color: null, price: 285.99, currency: 'AUD', coverageSqm: 2, imageUrl: null },
						{ shopifyVariantId: null, sizeLitres: 5, color: null, price: 149.99, currency: 'AUD', coverageSqm: 2, imageUrl: null }
					]
				}
			];
		}
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
			syncProductsResult = { synced: data.synced ?? 0, products: data.products };
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
						description: p.description.trim() || null,
						colors: p.colors.length > 0 ? p.colors : null,
						shopifyProductId: p.shopifyProductId,
						productHandle: p.productHandle?.trim() || null,
						variants: p.variants.map((v) => ({
							shopifyVariantId: v.shopifyVariantId,
							sizeLitres: v.sizeLitres,
							color: v.color?.trim() || null,
							price: v.price,
							currency: v.currency || 'AUD',
							coverageSqm: v.coverageSqm,
							imageUrl: v.imageUrl?.trim() || null
						}))
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
			{
				name: '',
				description: '',
				colors: [],
				shopifyProductId: null,
				productHandle: '',
				variants: [
					{ shopifyVariantId: null, sizeLitres: 5, color: null, price: 0, currency: 'AUD', coverageSqm: 2, imageUrl: null }
				]
			}
		];
	}

	function addVariant(product: ProductRow) {
		const first = product.variants[0];
		const newVariant: VariantRow = {
			shopifyVariantId: null,
			sizeLitres: first?.sizeLitres ?? 5,
			color: null,
			price: first?.price ?? 0,
			currency: first?.currency ?? 'AUD',
			coverageSqm: first?.coverageSqm ?? 2,
			imageUrl: null
		};
		products = products.map((p) =>
			p === product ? { ...p, variants: [...p.variants, newVariant] } : p
		);
	}

	function removeVariant(product: ProductRow, variant: VariantRow) {
		products = products.map((p) =>
			p === product ? { ...p, variants: p.variants.filter((v) => v !== variant) } : p
		);
	}

	function removeProduct(product: ProductRow) {
		products = products.filter((p) => p !== product);
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

<div class="max-w-4xl mx-auto">
	<h1 class="text-2xl font-bold text-gray-900">Products</h1>
	<p class="text-gray-500 mt-1 mb-6">
		Sync products from Shopify and manage product pricing. One row per product; each variant (size × color) has its own variant ID and image. Used by the agent for DIY quotes, roof-kit calculator, and checkout links.
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
				Pull products from your connected store. One product row per Shopify product; all variants (each size × color with its own variant ID and image) are stored in the variants table below.
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
						<span class="text-sm text-gray-500">
							{syncProductsResult.synced} variant(s) across {syncProductsResult.products ?? 0} product(s)
						</span>
					{/if}
					<span class="text-xs text-gray-500">{shopifyDomain}</span>
				</div>
			{:else}
				<p class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
					Shopify is not connected. <a href="/integrations" class="font-medium underline">Connect your store</a> to sync products.
				</p>
			{/if}
		</div>

		<!-- Product pricing: one card per product, variants table with Size, Color, Variant ID, Image -->
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h2 class="text-lg font-semibold text-gray-900 mb-1">Product pricing</h2>
			<p class="text-gray-500 text-sm mb-4">
				Colors are shown as options for the product. Each variant row is a specific size × color with its own Shopify variant ID and image URL for checkout links.
			</p>
			<div class="space-y-6">
				{#each products as product, i (product.id ?? String(product.shopifyProductId ?? `new-${i}`))}
					<div class="p-4 border border-gray-200 rounded-lg space-y-4">
						<div class="flex justify-between items-start gap-2">
							<div class="flex-1 min-w-0 space-y-2">
								<label class="block">
									<span class="text-xs text-gray-500">Product name</span>
									<input
										type="text"
										bind:value={product.name}
										placeholder="e.g. NetZero UltraTherm Roof Coating"
										class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium"
									/>
								</label>
								<div class="flex flex-wrap gap-3 items-center">
									<label class="flex items-center gap-2">
										<span class="text-xs text-gray-500">Product type (roof-kit)</span>
										<select
											bind:value={product.productHandle}
											class="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
										>
											{#each PRODUCT_HANDLES as opt}
												<option value={opt.value}>{opt.label}</option>
											{/each}
										</select>
									</label>
									<button
										type="button"
										onclick={() => addVariant(product)}
										class="text-sm text-amber-600 hover:text-amber-700 font-medium"
									>
										+ Add variant
									</button>
								</div>
								<label class="block">
									<span class="text-xs text-gray-500">Description (optional)</span>
									<textarea
										bind:value={product.description}
										placeholder="Product description…"
										rows="2"
										class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y"
									></textarea>
								</label>
								{#if product.colors.length > 0}
									<div>
										<span class="text-xs text-gray-500">Colors (options for this product)</span>
										<div class="flex flex-wrap gap-1.5 mt-1">
											{#each product.colors as color}
												<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{color}</span>
											{/each}
										</div>
									</div>
								{/if}
							</div>
							<button
								type="button"
								onclick={() => removeProduct(product)}
								class="text-red-600 hover:text-red-700 text-sm shrink-0"
							>
								Remove product
							</button>
						</div>

						<!-- Variants table: Size, Color, Variant ID, Image URL, Price, Currency, Coverage -->
						<div class="border border-gray-100 rounded-lg overflow-x-auto">
							<table class="w-full text-sm min-w-[700px]">
								<thead class="bg-gray-50 border-b border-gray-200">
									<tr>
										<th class="text-left py-2 px-3 font-medium text-gray-600">Size (L)</th>
										<th class="text-left py-2 px-3 font-medium text-gray-600">Color</th>
										<th class="text-left py-2 px-3 font-medium text-gray-600">Variant ID</th>
										<th class="text-left py-2 px-3 font-medium text-gray-600">Image URL</th>
										<th class="text-left py-2 px-3 font-medium text-gray-600">Price</th>
										<th class="text-left py-2 px-3 font-medium text-gray-600">Currency</th>
										<th class="text-left py-2 px-3 font-medium text-gray-600">Coverage (sqm/L)</th>
										<th class="w-20"></th>
									</tr>
								</thead>
								<tbody>
									{#each product.variants as v}
										<tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
											<td class="py-2 px-3">
												<input
													type="number"
													bind:value={v.sizeLitres}
													min="0"
													class="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
												/>
											</td>
											<td class="py-2 px-3">
												<input
													type="text"
													bind:value={v.color}
													placeholder="e.g. White"
													class="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
												/>
											</td>
											<td class="py-2 px-3">
												<input
													type="text"
													value={v.shopifyVariantId ?? ''}
													oninput={(e) => {
														const raw = (e.currentTarget as HTMLInputElement).value.trim();
														v.shopifyVariantId = raw === '' ? null : (Number(raw) || null);
													}}
													placeholder="Variant ID"
													class="w-full max-w-[100px] px-2 py-1 border border-gray-300 rounded text-sm font-mono"
												/>
											</td>
											<td class="py-2 px-3 min-w-0">
												<input
													type="url"
													bind:value={v.imageUrl}
													placeholder="Image URL"
													class="w-full min-w-[120px] max-w-[180px] px-2 py-1 border border-gray-300 rounded text-sm truncate"
												/>
												{#if v.imageUrl}
													<img src={v.imageUrl} alt="" class="mt-1 w-10 h-10 object-contain rounded border border-gray-200" />
												{/if}
											</td>
											<td class="py-2 px-3">
												<input type="number" bind:value={v.price} min="0" step="0.01" class="w-20 px-2 py-1 border border-gray-300 rounded text-sm" />
											</td>
											<td class="py-2 px-3">
												<input type="text" bind:value={v.currency} class="w-14 px-2 py-1 border border-gray-300 rounded text-sm" />
											</td>
											<td class="py-2 px-3">
												<input type="number" bind:value={v.coverageSqm} min="0" step="0.1" class="w-16 px-2 py-1 border border-gray-300 rounded text-sm" />
											</td>
											<td class="py-2 px-2">
												<button
													type="button"
													onclick={() => removeVariant(product, v)}
													class="text-red-600 hover:text-red-700 text-xs"
												>
													Remove
												</button>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
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
