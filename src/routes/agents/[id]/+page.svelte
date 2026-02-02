<script lang="ts">
	import { AGENT_TOOL_IDS, AGENT_TOOL_LABELS, DEFAULT_AGENT_TOOLS } from '$lib/agent-tools';
	import type { AgentToolId } from '$lib/agent-tools';

	type AgentData = {
		id: string;
		name: string;
		description: string;
		systemPrompt: string;
		allowedTools?: string[];
		createdAt: string;
		updatedAt: string;
	};

	let { data } = $props();
	const agentId = $derived((data.agentId as string) ?? '');
	const initial = $derived((data.initial as AgentData) ?? null);

	let name = $state('');
	let description = $state('');
	let systemPrompt = $state('');
	let allowedTools = $state<Set<string>>(new Set(DEFAULT_AGENT_TOOLS));
	let saving = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		const init = initial;
		if (init) {
			name = init.name;
			description = init.description;
			systemPrompt = init.systemPrompt;
			allowedTools = new Set(Array.isArray(init.allowedTools) ? init.allowedTools : DEFAULT_AGENT_TOOLS);
		}
	});

	function toggleTool(id: AgentToolId) {
		const next = new Set(allowedTools);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		allowedTools = next;
	}

	async function save() {
		error = null;
		const trimmed = name.trim();
		if (!trimmed) {
			error = 'Name is required';
			return;
		}
		saving = true;
		try {
			const res = await fetch(`/api/agents/${agentId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: trimmed,
					description: description.trim(),
					system_prompt: systemPrompt.trim(),
					allowed_tools: Array.from(allowedTools)
				})
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Failed to save');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>{initial?.name ?? 'Agent'} – ProfitBot</title>
</svelte:head>

<div class="max-w-2xl mx-auto">
	<header class="mb-6">
		<a href="/agents" class="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block">← Back to Agents</a>
		<h1 class="text-2xl font-bold text-gray-900">Edit Agent</h1>
		<p class="text-gray-500 mt-0.5">
			Use this agent in workflow actions or assign it to widgets so they share the same training.
		</p>
	</header>

	<form onsubmit={(e) => { e.preventDefault(); save(); }} class="space-y-6">
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
				placeholder="What topics or domain is this agent trained on?"
				bind:value={description}
			></textarea>
		</div>

		<div>
			<label for="systemPrompt" class="block text-sm font-medium text-gray-700 mb-1">System prompt (optional)</label>
			<textarea
				id="systemPrompt"
				rows="4"
				class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none resize-none font-mono text-sm"
				placeholder="Instructions for how this agent should behave."
				bind:value={systemPrompt}
			></textarea>
		</div>

		<!-- Tools: which tools this agent can use when autonomy is enabled -->
		<div class="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
			<h3 class="text-sm font-semibold text-gray-900 mb-2">Tools</h3>
			<p class="text-xs text-gray-500 mb-3">
				When this agent is used with autonomy enabled, it can call these tools. Enable only the tools you want this agent to use.
			</p>
			<div class="flex flex-wrap gap-3">
				{#each AGENT_TOOL_IDS as id}
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							checked={allowedTools.has(id)}
							onchange={() => toggleTool(id)}
							class="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
						/>
						<span class="text-sm font-medium text-gray-700">{AGENT_TOOL_LABELS[id]}</span>
					</label>
				{/each}
			</div>
		</div>

		<div class="flex items-center gap-3">
			<button
				type="submit"
				disabled={saving}
				class="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
			>
				{saving ? 'Saving…' : 'Save'}
			</button>
		</div>
	</form>

	<!-- Training section: placeholder for uploading docs / training on topics -->
	<div class="mt-10 pt-8 border-t border-gray-200">
		<h2 class="text-lg font-semibold text-gray-900 mb-1">Training</h2>
		<p class="text-sm text-gray-500 mb-4">
			Train this agent on specific topics by uploading documents or adding content. Training data will be used when this agent is selected in workflows or widgets.
		</p>
		<div class="rounded-lg border border-dashed border-gray-300 bg-gray-50/50 p-8 text-center text-gray-500 text-sm">
			<p>Training UI (upload PDFs, URLs, or paste text) will be available in a follow-up. For now, use the system prompt above to define behavior.</p>
		</div>
	</div>
</div>
