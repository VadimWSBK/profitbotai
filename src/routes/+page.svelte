<script lang="ts">
	type Widget = {
		id: string;
		name: string;
		tags: string[];
		createdAt: string;
	};

	let searchQuery = $state('');
	let embedFilter = $state('');
	let typeFilter = $state('');
	let currentPage = $state(1);
	let widgets = $state<Widget[]>([
		{ id: '1', name: 'NetZero Coating', tags: ['Standalone', 'Popup'], createdAt: '30th Jan, 2026' }
	]);
	let loading = $state(true);
	const perPage = 10;

	$effect(() => {
		let cancelled = false;
		fetch('/api/widgets')
			.then((r) => r.json())
			.then((data: { widgets: Widget[] }) => {
				if (!cancelled && Array.isArray(data?.widgets)) widgets = data.widgets;
			})
			.catch(() => {})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	const totalWidgets = $derived(widgets.length);
	const filteredWidgets = $derived(
		widgets.filter((w) => {
			const matchesSearch = !searchQuery || w.name.toLowerCase().includes(searchQuery.toLowerCase());
			return matchesSearch;
		})
	);
	const totalPages = $derived(Math.max(1, Math.ceil(filteredWidgets.length / perPage)));
	const paginatedWidgets = $derived(
		filteredWidgets.slice((currentPage - 1) * perPage, currentPage * perPage)
	);

	function editWidget(id: string) {
		window.location.href = `/widgets/${id}`;
	}
	function viewStats(id: string) {
		window.location.href = `/analytics?widget_id=${id}`;
	}
	async function deleteWidget(id: string) {
		if (!confirm('Delete this widget? This cannot be undone.')) return;
		try {
			const res = await fetch(`/api/widgets/${id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error('Failed to delete');
			widgets = widgets.filter((w) => w.id !== id);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete');
		}
	}
</script>

<div class="max-w-4xl">
	<!-- Title row -->
	<div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
			<p class="text-gray-500 mt-0.5">Manage all your widgets</p>
		</div>
		<a
			href="/widgets/new"
			class="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors shrink-0"
		>
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
			Add Widget
		</a>
	</div>

	<!-- Search and filters -->
	<div class="flex flex-col sm:flex-row gap-3 mb-6">
		<div class="relative flex-1">
			<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
			<input
				type="text"
				placeholder="Search widgets by name..."
				class="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none transition-colors"
				bind:value={searchQuery}
			/>
		</div>
		<select
			bind:value={embedFilter}
			class="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-700 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none min-w-[120px]"
		>
			<option value="">Embed</option>
			<option value="standalone">Standalone</option>
			<option value="popup">Popup</option>
			<option value="inline">Inline</option>
		</select>
		<select
			bind:value={typeFilter}
			class="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-700 focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none min-w-[120px]"
		>
			<option value="">Type</option>
			<option value="chat">Chat</option>
			<option value="form">Form</option>
			<option value="popup">Popup</option>
		</select>
	</div>

	<!-- Your Widgets section -->
	<div class="bg-gray-100 rounded-xl p-4 mb-4">
		<div class="flex items-center gap-2 mb-1">
			<svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
			<h2 class="font-semibold text-gray-800">Your Widgets</h2>
		</div>
		<p class="text-sm text-gray-500">Showing {paginatedWidgets.length} of {filteredWidgets.length} widgets</p>
	</div>

	<!-- Widget list -->
	<div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
		<table class="w-full">
			<thead>
				<tr class="border-b border-gray-200 bg-gray-50/80">
					<th class="text-left py-3 px-4 text-sm font-medium text-gray-600">Widget</th>
					<th class="text-right py-3 px-4 text-sm font-medium text-gray-600">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr>
						<td colspan="2" class="py-8 px-4 text-center text-gray-500">Loading widgets…</td>
					</tr>
				{:else}
				{#each paginatedWidgets as widget (widget.id)}
					<tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition-colors">
						<td class="py-4 px-4">
							<div class="flex items-start gap-3">
								<div class="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
									<svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
								</div>
								<div>
									<p class="font-semibold text-gray-900">{widget.name}</p>
									<div class="flex flex-wrap gap-1.5 mt-1">
										{#each widget.tags as tag}
											<span
												class="text-xs font-medium px-2 py-0.5 rounded-full {tag === 'Popup'
													? 'bg-emerald-600 text-white'
													: 'bg-gray-200 text-gray-700'}"
											>
												{tag}
											</span>
										{/each}
									</div>
									<p class="text-sm text-gray-500 mt-0.5">Created on {widget.createdAt}</p>
								</div>
							</div>
						</td>
						<td class="py-4 px-4 text-right">
							<div class="flex items-center justify-end gap-2">
								<button
									type="button"
									class="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
									title="Edit"
									onclick={() => editWidget(widget.id)}
								>
									<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
								</button>
								<button
									type="button"
									class="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
									title="View statistics"
									onclick={() => viewStats(widget.id)}
								>
									<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16"/></svg>
								</button>
								<button
									type="button"
									class="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-red-600 transition-colors"
									title="Delete"
									onclick={() => deleteWidget(widget.id)}
								>
									<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
								</button>
							</div>
						</td>
					</tr>
				{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<!-- Pagination -->
	{#if totalPages > 1}
		<div class="flex items-center justify-center gap-2 mt-6">
			<button
				type="button"
				class="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:pointer-events-none"
				disabled={currentPage <= 1}
				onclick={() => (currentPage -= 1)}
			>
				‹ Previous
			</button>
			{#each Array(totalPages) as _, i}
				<button
					type="button"
					class="min-w-[2.25rem] px-3 py-2 text-sm font-medium rounded-lg transition-colors {currentPage === i + 1
						? 'bg-amber-600 text-white'
						: 'text-gray-700 hover:bg-gray-100'}"
					onclick={() => (currentPage = i + 1)}
				>
					{i + 1}
				</button>
			{/each}
			<button
				type="button"
				class="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:pointer-events-none"
				disabled={currentPage >= totalPages}
				onclick={() => (currentPage += 1)}
			>
				Next ›
			</button>
		</div>
	{:else if filteredWidgets.length > 0}
		<div class="flex items-center justify-center gap-2 mt-6">
			<button
				type="button"
				class="min-w-[2.25rem] px-3 py-2 text-sm font-medium rounded-lg bg-amber-600 text-white"
			>
				1
			</button>
		</div>
	{/if}
</div>
