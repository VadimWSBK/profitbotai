<script lang="ts">
	let { data } = $props();
	type TopSpender = {
		id: string;
		name: string | null;
		email: string | null;
		totalSpend: number;
		orderCount: number;
		quoteCount: number;
	};
	const topSpenders = $derived((data?.topSpenders ?? []) as TopSpender[]);
	const totalMessagesSent = $derived(typeof data?.totalMessagesSent === 'number' ? data.totalMessagesSent : 0);
	const quotesSent = $derived(typeof data?.quotesSent === 'number' ? data.quotesSent : 0);
	const totalQuotedAmount = $derived(typeof data?.totalQuotedAmount === 'number' ? data.totalQuotedAmount : 0);
	function formatCurrency(n: number) {
		return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
	}
</script>

<div class="max-w-5xl mx-auto">
	<h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
	<p class="text-gray-500 mt-0.5 mb-8">Overview of your activity and key metrics</p>

	<!-- Top 10 customers by spend -->
	{#if topSpenders.length > 0}
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-8">
			<h2 class="text-lg font-semibold text-gray-800 mb-1">Top 10 customers by spend</h2>
			<p class="text-gray-500 text-sm mb-4">Customers ranked by total orders and quoted amounts</p>
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-200 text-left text-gray-500 font-medium">
							<th class="py-3 px-2">#</th>
							<th class="py-3 px-2">Customer</th>
							<th class="py-3 px-2">Email</th>
							<th class="py-3 px-2 text-right">Total spend</th>
						</tr>
					</thead>
					<tbody>
						{#each topSpenders as spender, i}
							<tr class="border-b border-gray-100 hover:bg-gray-50/50">
								<td class="py-3 px-2 text-gray-400">{i + 1}</td>
								<td class="py-3 px-2">
									<a href="/contacts?contact={spender.id}" class="font-medium text-gray-900 hover:text-blue-600">
										{spender.name || spender.email || 'Unknown'}
									</a>
								</td>
								<td class="py-3 px-2 text-gray-600">{spender.email ?? '—'}</td>
								<td class="py-3 px-2 text-right font-semibold text-emerald-600">{formatCurrency(spender.totalSpend)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<a href="/contacts" class="inline-flex items-center gap-1.5 mt-4 text-sm font-medium text-blue-600 hover:text-blue-700">
				View all contacts
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
			</a>
		</div>
	{/if}

	<!-- Key metrics -->
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<div class="flex items-center gap-3">
				<div class="w-12 h-12 rounded-lg bg-amber-100 flex items-center justify-center">
					<svg class="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
				</div>
				<div>
					<p class="text-sm font-medium text-gray-500">Total messages sent</p>
					<p class="text-2xl font-bold text-gray-900">{totalMessagesSent.toLocaleString()}</p>
				</div>
			</div>
			<p class="text-xs text-gray-400 mt-3">AI and agent replies to visitors</p>
		</div>
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<div class="flex items-center gap-3">
				<div class="w-12 h-12 rounded-lg bg-emerald-100 flex items-center justify-center">
					<svg class="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
				</div>
				<div>
					<p class="text-sm font-medium text-gray-500">Quotes sent</p>
					<p class="text-2xl font-bold text-gray-900">{quotesSent.toLocaleString()}</p>
				</div>
			</div>
			<p class="text-xs text-gray-400 mt-3">PDF quotes generated</p>
		</div>
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<div class="flex items-center gap-3">
				<div class="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
					<svg class="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
				</div>
				<div>
					<p class="text-sm font-medium text-gray-500">Total quoted amount</p>
					<p class="text-2xl font-bold text-gray-900">{formatCurrency(totalQuotedAmount)}</p>
				</div>
			</div>
			<p class="text-xs text-gray-400 mt-3">Sum of all quote totals</p>
		</div>
	</div>

	<!-- Graphs placeholder -->
	<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
		<h2 class="text-lg font-semibold text-gray-800 mb-2">Charts & trends</h2>
		<p class="text-gray-500 text-sm">Graphs and detailed stats will appear here.</p>
		<div class="mt-6 h-48 rounded-lg bg-gray-50 border border-dashed border-gray-200 flex items-center justify-center">
			<span class="text-sm text-gray-400">Charts coming soon</span>
		</div>
	</div>
</div>
