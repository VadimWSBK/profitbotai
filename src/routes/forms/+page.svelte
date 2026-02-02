<script lang="ts">
	let { data } = $props();
	const forms = $derived((data?.forms ?? []) as { id: string; name: string; title: string; created_at: string }[]);
</script>

<svelte:head>
	<title>Forms – ProfitBot</title>
</svelte:head>

<div class="max-w-4xl mx-auto">
	<h1 class="text-2xl font-bold text-gray-900">Forms</h1>
	<p class="text-gray-500 mt-1 mb-6">
		Create embeddable multi-step quote forms. Collect name, email, phone, and address, then generate a quote PDF for download. Embed on any page via iframe.
	</p>

	<div class="flex items-center justify-between gap-4 mb-6">
		<span class="text-sm text-gray-500">{forms.length} form{forms.length === 1 ? '' : 's'}</span>
		<a
			href="/forms/new"
			class="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors"
		>
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
			New form
		</a>
	</div>

	{#if forms.length === 0}
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
			<p class="text-gray-500 mb-4">No forms yet. Create one to get started.</p>
			<a href="/forms/new" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700">
				Create your first form
			</a>
		</div>
	{:else}
		<ul class="space-y-2">
			{#each forms as form}
				<li>
					<a
						href="/forms/{form.id}"
						class="flex items-center justify-between gap-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm hover:border-amber-300 hover:shadow transition-colors"
					>
						<div>
							<p class="font-medium text-gray-900">{form.name}</p>
							<p class="text-sm text-gray-500">{form.title}</p>
						</div>
						<svg class="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
