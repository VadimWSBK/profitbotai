<script lang="ts">
	import { browser } from '$app/environment';

	type Agent = {
		id: string;
		name: string;
		description: string;
		createdAt: string;
	};

	let { data } = $props();
	let searchQuery = $state('');
	let currentPage = $state(1);
	let agents = $state<Agent[]>([]);
	let loading = $state(true);
	const perPage = 10;

	$effect(() => {
		if (!browser) return;
		let cancelled = false;
		fetch('/api/agents')
			.then((r) => r.json())
			.then((res: { agents?: Agent[] }) => {
				if (!cancelled && Array.isArray(res?.agents)) agents = res.agents;
			})
			.catch(() => {})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	const filteredAgents = $derived(
		agents.filter((a) => {
			const q = searchQuery.toLowerCase();
			return !q || a.name.toLowerCase().includes(q) || (a.description && a.description.toLowerCase().includes(q));
		})
	);
	const totalPages = $derived(Math.max(1, Math.ceil(filteredAgents.length / perPage)));
	const paginatedAgents = $derived(
		filteredAgents.slice((currentPage - 1) * perPage, currentPage * perPage)
	);

	function editAgent(id: string) {
		window.location.href = `/agents/${id}`;
	}
	async function deleteAgent(id: string) {
		if (!confirm('Delete this agent? This cannot be undone.')) return;
		try {
			const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error('Failed to delete');
			agents = agents.filter((a) => a.id !== id);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete');
		}
	}
</script>

<svelte:head>
	<title>Agents – ProfitBot</title>
</svelte:head>

<div class="max-w-4xl mx-auto">
	<div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Agents</h1>
			<p class="text-gray-500 mt-0.5">
				Topic-specific agents trained on your content. Use them in workflows or assign to widgets instead of training each widget.
			</p>
		</div>
		{#if data?.role === 'admin'}
			<a
				href="/agents/new"
				class="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors shrink-0"
			>
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
				Add Agent
			</a>
		{/if}
	</div>

	<div class="flex flex-col sm:flex-row gap-3 mb-6">
		<div class="relative flex-1">
			<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
			<input
				type="text"
				placeholder="Search agents by name or topic..."
				class="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none transition-colors"
				bind:value={searchQuery}
			/>
		</div>
	</div>

	<div class="bg-gray-100 rounded-xl p-4 mb-4">
		<div class="flex items-center gap-2 mb-1">
			<svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/></svg>
			<h2 class="font-semibold text-gray-800">Your Agents</h2>
		</div>
		<p class="text-sm text-gray-500">Showing {paginatedAgents.length} of {filteredAgents.length} agents</p>
	</div>

	<div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
		<table class="w-full">
			<thead>
				<tr class="border-b border-gray-200 bg-gray-50/80">
					<th class="text-left py-3 px-4 text-sm font-medium text-gray-600">Agent</th>
					<th class="text-right py-3 px-4 text-sm font-medium text-gray-600">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr>
						<td colspan="2" class="py-8 px-4 text-center text-gray-500">Loading agents…</td>
					</tr>
				{:else if paginatedAgents.length === 0}
					<tr>
						<td colspan="2" class="py-12 px-4 text-center text-gray-500">
							{#if filteredAgents.length === 0 && agents.length === 0}
								No agents yet. Create one to use in workflows or assign to widgets.
							{:else}
								No agents match your search.
							{/if}
						</td>
					</tr>
				{:else}
					{#each paginatedAgents as agent (agent.id)}
						<tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition-colors">
							<td class="py-4 px-4">
								<div class="flex items-start gap-3">
									<div class="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
										<svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/></svg>
									</div>
									<div>
										<p class="font-semibold text-gray-900">{agent.name}</p>
										{#if agent.description}
											<p class="text-sm text-gray-500 mt-0.5 line-clamp-2">{agent.description}</p>
										{/if}
										<p class="text-sm text-gray-400 mt-1">Created {agent.createdAt}</p>
									</div>
								</div>
							</td>
							<td class="py-4 px-4 text-right">
								<div class="flex items-center justify-end gap-2">
									<button
										type="button"
										class="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
										title="Edit"
										onclick={() => editAgent(agent.id)}
									>
										<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
									</button>
									<button
										type="button"
										class="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-red-600 transition-colors"
										title="Delete"
										onclick={() => deleteAgent(agent.id)}
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
					class="min-w-9 px-3 py-2 text-sm font-medium rounded-lg transition-colors {currentPage === i + 1
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
	{/if}
</div>
