<script lang="ts">
	let { data } = $props();
	const templates = $derived(
		(data?.templates ?? []) as { id: string; name: string; subject: string; body: string; created_at: string }[]
	);
</script>

<svelte:head>
	<title>Templates – ProfitBot</title>
</svelte:head>

<div class="max-w-4xl mx-auto">
	<h1 class="text-2xl font-bold text-gray-900">Templates</h1>
	<p class="text-gray-500 mt-1 mb-6">
		Create email templates for your workflows. Use placeholders like <code class="bg-gray-100 px-1 rounded text-sm">{'{{contact.name}}'}</code>, <code class="bg-gray-100 px-1 rounded text-sm">{'{{contact.email}}'}</code>, or <code class="bg-gray-100 px-1 rounded text-sm">{'{{quote.total}}'}</code>. Select a template in the workflow builder when configuring the "Send email" action.
	</p>

	<div class="flex items-center justify-between gap-4 mb-6">
		<span class="text-sm text-gray-500">{templates.length} template{templates.length === 1 ? '' : 's'}</span>
		<a
			href="/templates/new"
			class="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors"
		>
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
			New template
		</a>
	</div>

	{#if templates.length === 0}
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
			<p class="text-gray-500 mb-4">No templates yet. Create one to use in your workflow "Send email" actions.</p>
			<a href="/templates/new" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700">
				Create your first template
			</a>
		</div>
	{:else}
		<ul class="space-y-2">
			{#each templates as template}
				<li>
					<a
						href="/templates/{template.id}"
						class="flex items-center justify-between gap-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm hover:border-amber-300 hover:shadow transition-colors"
					>
						<div class="min-w-0 flex-1">
							<p class="font-medium text-gray-900 truncate">{template.name}</p>
							<p class="text-sm text-gray-500 truncate">{template.subject || 'No subject'}</p>
						</div>
						<svg class="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
