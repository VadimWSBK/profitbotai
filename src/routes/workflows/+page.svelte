<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	type WorkflowMeta = { id: string; name: string; updatedAt: string };

	const WORKFLOWS_INDEX_KEY = 'profitbot_workflows';
	const STORAGE_KEY = 'profitbot_workflow_';

	let workflows = $state<WorkflowMeta[]>([]);
	let loading = $state(true);
	let editingId = $state<string | null>(null);
	let editingName = $state('');
	let workflowToDelete = $state<WorkflowMeta | null>(null);
	let deleteLoading = $state(false);
	let notificationMessage = $state<string | null>(null);

	function showNotification(message: string) {
		notificationMessage = message;
	}

	function dismissNotification() {
		notificationMessage = null;
	}

	function loadWorkflows() {
		try {
			const raw = localStorage.getItem(WORKFLOWS_INDEX_KEY);
			workflows = raw ? (JSON.parse(raw) as WorkflowMeta[]) : [];
		} catch {
			workflows = [];
		}
		loading = false;
	}

	function createNew() {
		const id = crypto.randomUUID();
		const name = 'Untitled workflow';
		const now = new Date().toISOString();
		localStorage.setItem(STORAGE_KEY + id, JSON.stringify({ name, nodes: [], edges: [] }));
		try {
			const raw = localStorage.getItem(WORKFLOWS_INDEX_KEY);
			const list = raw ? (JSON.parse(raw) as WorkflowMeta[]) : [];
			list.push({ id, name, updatedAt: now });
			localStorage.setItem(WORKFLOWS_INDEX_KEY, JSON.stringify(list));
		} catch {
			// ignore
		}
		goto(`/workflows/${id}`);
	}

	function startRename(wf: WorkflowMeta) {
		editingId = wf.id;
		editingName = wf.name;
	}

	function commitRename() {
		if (editingId == null || !editingName.trim()) {
			editingId = null;
			return;
		}
		const name = editingName.trim();
		try {
			const raw = localStorage.getItem(STORAGE_KEY + editingId);
			if (raw) {
				const payload = JSON.parse(raw) as { name: string; nodes: unknown[]; edges: unknown[] };
				payload.name = name;
				localStorage.setItem(STORAGE_KEY + editingId, JSON.stringify(payload));
			}
			const listRaw = localStorage.getItem(WORKFLOWS_INDEX_KEY);
			const list = listRaw ? (JSON.parse(listRaw) as WorkflowMeta[]) : [];
			const idx = list.findIndex((e) => e.id === editingId);
			if (idx >= 0) {
				list[idx] = { ...list[idx], name, updatedAt: new Date().toISOString() };
				localStorage.setItem(WORKFLOWS_INDEX_KEY, JSON.stringify(list));
				workflows = list;
			}
		} catch {
			// ignore
		}
		editingId = null;
	}

	function cancelRename() {
		editingId = null;
	}

	function startDelete(wf: WorkflowMeta, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		workflowToDelete = wf;
	}

	function cancelDelete() {
		if (!deleteLoading) workflowToDelete = null;
	}

	async function confirmDelete() {
		const wf = workflowToDelete;
		if (!wf) return;
		deleteLoading = true;
		try {
			const res = await fetch(`/api/workflows/${wf.id}`, { method: 'DELETE' });
			if (!res.ok && res.status !== 404) {
				const data = await res.json().catch(() => ({}));
				showNotification((data.error as string) ?? 'Failed to delete workflow');
				return;
			}
			workflows = workflows.filter((w) => w.id !== wf.id);
			try {
				localStorage.removeItem(STORAGE_KEY + wf.id);
				const raw = localStorage.getItem(WORKFLOWS_INDEX_KEY);
				const list = raw ? (JSON.parse(raw) as WorkflowMeta[]) : [];
				const next = list.filter((e) => e.id !== wf.id);
				localStorage.setItem(WORKFLOWS_INDEX_KEY, JSON.stringify(next));
			} catch {
				// ignore
			}
			workflowToDelete = null;
		} finally {
			deleteLoading = false;
		}
	}

	onMount(loadWorkflows);
</script>

<svelte:head>
	<title>Workflows – ProfitBot</title>
</svelte:head>

<div class="max-w-4xl mx-auto">
	<h1 class="text-2xl font-bold text-gray-900">Workflows</h1>
	<p class="text-gray-500 mt-1 mb-6">
		Build automations like in GoHighLevel: triggers, actions, and conditions. Drag nodes onto the canvas and connect them to define your workflow.
	</p>

	<div class="flex items-center justify-between gap-4 mb-6">
		<span class="text-sm text-gray-500">{loading ? 'Loading…' : `${workflows.length} workflow${workflows.length === 1 ? '' : 's'}`}</span>
		<button
			type="button"
			onclick={createNew}
			class="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors"
		>
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
			New workflow
		</button>
	</div>

	{#if loading}
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center text-gray-500">Loading workflows…</div>
	{:else if workflows.length === 0}
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
			<p class="text-gray-500 mb-4">No workflows yet. Create one to build your first automation.</p>
			<button
				type="button"
				onclick={createNew}
				class="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700"
			>
				Create your first workflow
			</button>
		</div>
	{:else}
		<ul class="space-y-2">
			{#each workflows as wf}
				<li>
					<div class="flex items-center justify-between gap-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm hover:border-amber-300 hover:shadow transition-colors group">
						<div class="min-w-0 flex-1">
							{#if editingId === wf.id}
								<input
									type="text"
									bind:value={editingName}
									onkeydown={(e) => {
										if (e.key === 'Enter') commitRename();
										if (e.key === 'Escape') cancelRename();
									}}
									onblur={commitRename}
									class="w-full rounded-lg border border-amber-500 px-3 py-1.5 text-sm font-medium text-gray-900 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
									placeholder="Workflow name"
								/>
							{:else}
								<button
									type="button"
									onclick={(e) => { e.preventDefault(); startRename(wf); }}
									class="text-left font-medium text-gray-900 hover:text-amber-600 block w-full rounded px-1 -mx-1 py-0.5"
								>
									{wf.name}
								</button>
							{/if}
							<p class="text-sm text-gray-500 mt-0.5">Updated {new Date(wf.updatedAt).toLocaleDateString()}</p>
						</div>
						<div class="shrink-0 flex items-center gap-1">
							<button
								type="button"
								onclick={(e) => startDelete(wf, e)}
								class="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
								aria-label="Delete workflow"
								title="Delete workflow"
							>
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
							</button>
							<a
								href="/workflows/{wf.id}"
								class="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
								aria-label="Open workflow"
							>
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
							</a>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if workflowToDelete}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-confirm-title"
		>
			<div class="bg-white rounded-xl shadow-xl p-6 max-w-sm mx-4 border border-gray-200">
				<h3 id="delete-confirm-title" class="font-semibold text-gray-900 text-lg">Delete workflow?</h3>
				<p class="text-sm text-gray-600 mt-2">
					"{workflowToDelete.name}" will be permanently deleted. This cannot be undone.
				</p>
				<div class="flex gap-2 justify-end mt-6">
					<button
						type="button"
						onclick={cancelDelete}
						disabled={deleteLoading}
						class="px-4 py-2 rounded-lg font-medium bg-gray-100 text-gray-900 hover:bg-gray-200 disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						onclick={confirmDelete}
						disabled={deleteLoading}
						class="px-4 py-2 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
					>
						{deleteLoading ? 'Deleting…' : 'Delete'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if notificationMessage}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="notification-title"
			aria-describedby="notification-message"
		>
			<div class="bg-white rounded-xl shadow-xl p-6 max-w-md mx-4 border border-gray-200">
				<h3 id="notification-title" class="font-semibold text-gray-900 text-lg">Notice</h3>
				<p id="notification-message" class="text-sm text-gray-600 mt-2">{notificationMessage}</p>
				<div class="flex justify-end mt-6">
					<button
						type="button"
						onclick={dismissNotification}
						class="px-4 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
					>
						OK
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
