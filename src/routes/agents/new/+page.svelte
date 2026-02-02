<script lang="ts">
	import { goto } from '$app/navigation';

	let name = $state('My Agent');
	let description = $state('');
	let systemPrompt = $state('');
	let saving = $state(false);
	let error = $state<string | null>(null);

	async function create() {
		error = null;
		const trimmed = name.trim();
		if (!trimmed) {
			error = 'Name is required';
			return;
		}
		saving = true;
		try {
			const res = await fetch('/api/agents', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: trimmed,
					description: description.trim(),
					system_prompt: systemPrompt.trim()
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Failed to create agent');
			if (data.agent?.id) {
				goto(`/agents/${data.agent.id}`);
				return;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create agent';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>New Agent – ProfitBot</title>
</svelte:head>

<div class="max-w-2xl mx-auto">
	<header class="mb-6">
		<a href="/agents" class="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block">← Back to Agents</a>
		<h1 class="text-2xl font-bold text-gray-900">New Agent</h1>
		<p class="text-gray-500 mt-0.5">
			Create an agent trained on specific topics. You can then use it in workflows or assign it to widgets.
		</p>
	</header>

	<form onsubmit={(e) => { e.preventDefault(); create(); }} class="space-y-6">
		{#if error}
			<div class="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
		{/if}

		<div>
			<label for="name" class="block text-sm font-medium text-gray-700 mb-1">Name</label>
			<input
				id="name"
				type="text"
				class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none"
				placeholder="e.g. Support Agent, Product Expert"
				bind:value={name}
			/>
		</div>

		<div>
			<label for="description" class="block text-sm font-medium text-gray-700 mb-1">Topic / Description</label>
			<textarea
				id="description"
				rows="3"
				class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none resize-none"
				placeholder="What topics or domain is this agent trained on? e.g. Customer support for SaaS, Product FAQs"
				bind:value={description}
			></textarea>
		</div>

		<div>
			<label for="systemPrompt" class="block text-sm font-medium text-gray-700 mb-1">System prompt (optional)</label>
			<textarea
				id="systemPrompt"
				rows="4"
				class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none resize-none font-mono text-sm"
				placeholder="Instructions for how this agent should behave. Leave empty to rely on training data only."
				bind:value={systemPrompt}
			></textarea>
		</div>

		<div class="flex items-center gap-3">
			<button
				type="submit"
				disabled={saving}
				class="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
			>
				{saving ? 'Creating…' : 'Create Agent'}
			</button>
			<a href="/agents" class="text-gray-600 hover:text-gray-800">Cancel</a>
		</div>
	</form>
</div>
