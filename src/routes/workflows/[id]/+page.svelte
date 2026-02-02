<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { SvelteFlow, Background, BackgroundVariant, Controls, Panel } from '@xyflow/svelte';
	import { addEdge } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { ClipboardList, Webhook, MessageCircle, Zap, CircleCheck, GitBranch, FileText, Mail, Sparkles } from '@lucide/svelte';
	import TriggerNode from '$lib/components/workflow/TriggerNode.svelte';
	import ActionNode from '$lib/components/workflow/ActionNode.svelte';
	import ConditionNode from '$lib/components/workflow/ConditionNode.svelte';
import FlowDropZone from '$lib/components/workflow/FlowDropZone.svelte';
import { LLM_PROVIDERS, getModels } from '$lib/llm-providers';
import type { Node, Edge, Connection } from '@xyflow/svelte';
	import { onMount } from 'svelte';

	const TRIGGER_OPTIONS = [
		{ value: 'Form submit', label: 'Form submit', description: 'Runs when a form is submitted on your site.', Icon: ClipboardList },
		{ value: 'Inbound webhook', label: 'On webhook call', description: 'Runs the flow on receiving an HTTP request.', Icon: Webhook },
		{ value: 'Message in the chat', label: 'On chat message', description: 'Runs when a user sends a chat message (e.g. when customer requests quote).', Icon: MessageCircle }
	] as const;

	const ACTION_OPTIONS = [
		{ value: 'Generate quote', label: 'Generate quote', description: 'Create a PDF quote from the conversation and attach it.', Icon: FileText },
		{ value: 'Send email', label: 'Send email', description: 'Send an email (e.g. with the quote) to the contact.', Icon: Mail },
		{ value: 'Outbound webhook', label: 'Outbound webhook', description: 'Call an external URL with a custom HTTP request.', Icon: Webhook },
		{ value: 'AI', label: 'AI', description: 'Run an AI model with a custom prompt using your API key or integrated connection.', Icon: Sparkles }
	] as const;

	const EMAIL_TO_PLACEHOLDER = 'e.g. {{contact.email}} or specific@example.com';
	const EMAIL_SUBJECT_PLACEHOLDER = 'e.g. Your quote from {{company}}';
	const EMAIL_BODY_PLACEHOLDER = 'Hi {{contact.name}},\n\nPlease find your quote attached.\n\nBest regards';
	const EMAIL_PLACEHOLDER_HINT = 'Use placeholders like {{contact.name}}, {{contact.email}}, or quote details.';
	const AI_PROMPT_PLACEHOLDER = 'e.g. Summarize the conversation in one sentence. Or: Extract the customer\'s request and suggest a reply. Use {{contact.name}}, {{contact.email}} for context.';
	const AI_PROMPT_HINT = 'Use placeholders: {{contact.name}}, {{contact.email}}, {{contact.phone}}, {{quote.total}}, etc.';

	const EMAIL_VARIABLE_GROUPS: { group: string; fields: { key: string; label: string }[] }[] = [
		{ group: 'Contact', fields: [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }] },
		{ group: 'Company', fields: [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }] },
		{ group: 'Quote', fields: [{ key: 'total', label: 'Total' }, { key: 'items', label: 'Items' }] }
	];

	type EmailVarField = 'emailTo' | 'emailSubject' | 'emailBody' | 'emailCopyTo';
	let activeEmailVarField = $state<EmailVarField | null>(null);

	function insertEmailVariable(field: EmailVarField, groupKey: string, fieldKey: string) {
		const tag = `{{${groupKey.toLowerCase()}.${fieldKey}}}`;
		const current = (selectedNode?.data ?? {})[field];
		const value = typeof current === 'string' ? current : '';
		updateNodeData(selectedNode!.id, { [field]: value + tag });
		activeEmailVarField = null;
	}

	const workflowId = $derived($page.params.id);
	const origin = $derived(typeof window !== 'undefined' ? window.location.origin : '');

	const nodeTypes = {
		trigger: TriggerNode,
		action: ActionNode,
		condition: ConditionNode
	};

	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let workflowName = $state('Untitled workflow');
	let addCount = $state(0);
	let isServerWorkflow = $state(false);
	let widgetId = $state<string | null>(null);
	let widgets = $state<{ id: string; name: string }[]>([]);
	let forms = $state<{ id: string; name: string; title?: string }[]>([]);
	let llmProvidersWithKeys = $state<string[]>([]);
	let saveToServerLoading = $state(false);
	let workflowStatus = $state<'draft' | 'live'>('draft');
	let outboundWebhookTab = $state<'parameters' | 'settings'>('parameters');
	let isDraggingFromSidebar = $state(false);
	let lastSavedSnapshot = $state<string | null>(null);
	let showExitConfirm = $state(false);
	let notificationMessage = $state<string | null>(null);

	function showNotification(message: string) {
		notificationMessage = message;
	}

	function dismissNotification() {
		notificationMessage = null;
	}

	function getSnapshot() {
		return JSON.stringify({ name: workflowName, nodes, edges, status: workflowStatus });
	}
	function captureSavedSnapshot() {
		lastSavedSnapshot = getSnapshot();
	}
	const hasUnsavedChanges = $derived(lastSavedSnapshot !== null && getSnapshot() !== lastSavedSnapshot);

	// First selected node (for config panel)
	const selectedNode = $derived(nodes.find((n) => n.selected));

	function handleBackClick(e: MouseEvent) {
		if (hasUnsavedChanges) {
			e.preventDefault();
			showExitConfirm = true;
		}
	}
	function confirmLeave() {
		showExitConfirm = false;
		goto('/workflows');
	}
	function cancelLeave() {
		showExitConfirm = false;
	}

	function updateNodeData(nodeId: string, patch: Record<string, unknown>) {
		nodes = nodes.map((n) =>
			n.id === nodeId ? { ...n, data: { ...(n.data ?? {}), ...patch } } : n
		);
		saveWorkflow();
	}

	function copyWebhookUrl(url: string) {
		navigator.clipboard.writeText(url);
	}

	function closeConfigPanel() {
		nodes = nodes.map((n) => ({ ...n, selected: n.id === selectedNode?.id ? false : n.selected }));
	}

	function removeNode(nodeId: string) {
		nodes = nodes.filter((n) => n.id !== nodeId);
		edges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
		closeConfigPanel();
		saveWorkflow();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!selectedNode || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
		const target = e.target as EventTarget | null;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
		e.preventDefault();
		removeNode(selectedNode.id);
	}

	function addNodeAtPosition(type: 'trigger' | 'action' | 'condition', position: { x: number; y: number }) {
		const id = `${type}-${crypto.randomUUID().slice(0, 8)}`;
		addCount += 1;
		const base = { id, position };
		if (type === 'trigger') {
			nodes = [...nodes, { ...base, type: 'trigger', data: { label: 'Trigger' } }];
		} else if (type === 'action') {
			nodes = [...nodes, { ...base, type: 'action', data: { label: 'Action' } }];
		} else {
			nodes = [...nodes, { ...base, type: 'condition', data: { label: 'Condition', conditionType: 'If/Else' } }];
		}
		saveWorkflow();
		isDraggingFromSidebar = false;
	}

	function onConnect(connection: Connection) {
		edges = addEdge(connection, edges);
		saveWorkflow();
	}

	const STORAGE_KEY = 'profitbot_workflow_';
	const WORKFLOWS_INDEX_KEY = 'profitbot_workflows';

	function syncWorkflowsIndex() {
		const id = workflowId;
		if (id == null) return;
		try {
			const raw = localStorage.getItem(WORKFLOWS_INDEX_KEY);
			const list = raw ? (JSON.parse(raw) as { id: string; name: string; updatedAt: string }[]) : [];
			const now = new Date().toISOString();
			const idx = list.findIndex((e) => e.id === id);
			const entry = { id, name: workflowName, updatedAt: now };
			if (idx >= 0) {
				list[idx] = entry;
			} else {
				list.push(entry);
			}
			localStorage.setItem(WORKFLOWS_INDEX_KEY, JSON.stringify(list));
		} catch {
			// ignore
		}
	}

	async function loadWorkflow() {
		// Try server first
		try {
			const res = await fetch(`/api/workflows/${workflowId}`);
			if (res.ok) {
				const data = await res.json();
				const w = data.workflow;
				if (w) {
					workflowName = w.name ?? 'Untitled workflow';
					nodes = Array.isArray(w.nodes) ? w.nodes : [];
					edges = Array.isArray(w.edges) ? w.edges : [];
					isServerWorkflow = true;
					widgetId = w.widget_id ?? null;
					workflowStatus = (w.status === 'live' ? 'live' : 'draft') as 'draft' | 'live';
					return;
				}
			}
		} catch {
			// fallback to localStorage
		}
		isServerWorkflow = false;
		widgetId = null;
		try {
			const raw = localStorage.getItem(STORAGE_KEY + workflowId);
			if (raw) {
				const { name, nodes: n, edges: e } = JSON.parse(raw) as {
					name: string;
					nodes: Node[];
					edges: Edge[];
				};
				workflowName = name ?? 'Untitled workflow';
				nodes = Array.isArray(n) ? n : [];
				edges = Array.isArray(e) ? e : [];
			} else {
				nodes = [];
				edges = [];
			}
		} catch {
			nodes = [];
			edges = [];
		}
	}

	async function saveWorkflow() {
		const payload = { name: workflowName, nodes: [...nodes], edges: [...edges] };
		localStorage.setItem(STORAGE_KEY + workflowId, JSON.stringify(payload));
		syncWorkflowsIndex();
		if (isServerWorkflow && workflowId) {
			try {
				await fetch(`/api/workflows/${workflowId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: workflowName, nodes: payload.nodes, edges: payload.edges, status: workflowStatus })
				});
			} catch (e) {
				console.error('Failed to save workflow to server:', e);
			}
		}
		captureSavedSnapshot();
	}

	function getTriggerData(): { triggerType: string; widgetId?: string; formId?: string } {
		const trigger = nodes.find((n) => n.type === 'trigger');
		if (!trigger?.data) return { triggerType: '' };
		const data = trigger.data as Record<string, unknown>;
		return {
			triggerType: (data.triggerType as string) ?? '',
			widgetId: (data.widgetId as string | undefined)?.trim() || undefined,
			formId: (data.formId as string | undefined)?.trim() || undefined
		};
	}

	/** Resolve widget ID to save a new workflow: from chat trigger, or first widget for form/webhook. */
	function getWidgetIdForNewWorkflow(): { widgetId: string | null; error: string | null } {
		const { triggerType, widgetId, formId } = getTriggerData();
		if (!triggerType) {
			return { widgetId: null, error: 'Add a trigger and complete its configuration to save this workflow.' };
		}
		if (triggerType === 'Message in the chat') {
			if (!widgetId) {
				return { widgetId: null, error: 'Select a chat widget to save this workflow.' };
			}
			return { widgetId, error: null };
		}
		if (triggerType === 'Form submit') {
			if (!formId) {
				return { widgetId: null, error: 'Select a form to save this workflow.' };
			}
			const firstWidgetId = widgets[0]?.id ?? null;
			if (!firstWidgetId) {
				return { widgetId: null, error: 'Create at least one widget in your account to save this workflow.' };
			}
			return { widgetId: firstWidgetId, error: null };
		}
		if (triggerType === 'Inbound webhook') {
			const firstWidgetId = widgets[0]?.id ?? null;
			if (!firstWidgetId) {
				return { widgetId: null, error: 'Create at least one widget in your account to save this workflow.' };
			}
			return { widgetId: firstWidgetId, error: null };
		}
		return { widgetId: null, error: 'Complete the trigger configuration to save this workflow.' };
	}

	async function saveToServer() {
		if (isServerWorkflow && workflowId) {
			saveToServerLoading = true;
			try {
				const res = await fetch(`/api/workflows/${workflowId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: workflowName, nodes: [...nodes], edges: [...edges], status: workflowStatus })
				});
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					showNotification((data.error as string) ?? 'Failed to save workflow');
					return;
				}
				await saveWorkflow();
				captureSavedSnapshot();
			} finally {
				saveToServerLoading = false;
			}
			return;
		}
		const { widgetId: wId, error: validationError } = getWidgetIdForNewWorkflow();
		if (validationError) {
			showNotification(validationError);
			return;
		}
		if (!wId) return;
		saveToServerLoading = true;
		try {
			const res = await fetch(`/api/widgets/${wId}/workflows`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: workflowName, nodes: [...nodes], edges: [...edges], status: workflowStatus })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				showNotification((data.error as string) ?? 'Failed to save workflow');
				return;
			}
			const data = await res.json();
			const newId = data.workflow?.id;
			if (newId) {
				captureSavedSnapshot();
				goto(`/workflows/${newId}`);
			}
		} finally {
			saveToServerLoading = false;
		}
	}

	onMount(() => {
		loadWorkflow().then(() => captureSavedSnapshot());
		// Load widgets for trigger "Chat widget" dropdown
		fetch('/api/widgets')
			.then((r) => r.json())
			.then((d) => {
				widgets = (d.widgets ?? d ?? []) as { id: string; name: string }[];
			})
			.catch(() => {});
		// Load forms for trigger "Form submit" dropdown
		fetch('/api/forms')
			.then((r) => r.json())
			.then((d) => {
				forms = (d.forms ?? d ?? []) as { id: string; name: string; title?: string }[];
			})
			.catch(() => {});
		// Load which LLM providers have API keys (for AI node "integrated" option)
		fetch('/api/settings/llm-keys')
			.then((r) => r.json())
			.then((d) => {
				llmProvidersWithKeys = (d.providers ?? []) as string[];
			})
			.catch(() => {});
		const onBeforeUnload = (e: BeforeUnloadEvent) => {
			if (lastSavedSnapshot !== null && getSnapshot() !== lastSavedSnapshot) {
				e.preventDefault();
				e.returnValue = '';
			}
		};
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => window.removeEventListener('beforeunload', onBeforeUnload);
	});
</script>

<svelte:head>
	<title>{workflowName ?? 'Untitled'} – Workflows – ProfitBot</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="flex flex-col h-[calc(100vh-7rem)] -m-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
	<!-- Top bar: back, name, save, draft/live -->
	<header class="flex items-center gap-4 px-4 py-3 border-b border-gray-200 bg-white shrink-0 rounded-t-xl">
	<a
		href="/workflows"
		class="text-gray-500 hover:text-gray-700 p-1 rounded shrink-0"
		aria-label="Back to workflows"
		onclick={(e) => handleBackClick(e)}
	>
		<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
	</a>
	{#if hasUnsavedChanges}
		<span class="text-amber-600 text-xs font-medium shrink-0" title="You have unsaved changes">Unsaved</span>
	{/if}
	<input
		type="text"
		bind:value={workflowName}
		onblur={saveWorkflow}
		class="min-w-0 max-w-[200px] rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-900 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
		placeholder="Untitled workflow"
	/>
	<span class="text-gray-300" aria-hidden="true">|</span>
	<button
		type="button"
		disabled={saveToServerLoading}
		onclick={saveToServer}
		class="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:pointer-events-none shrink-0"
	>
		{#if saveToServerLoading}
			<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
			Saving…
		{:else}
			Save
		{/if}
	</button>
	<span class="text-gray-300" aria-hidden="true">|</span>
	<div class="flex rounded-lg border border-gray-200 p-0.5 bg-gray-100 shrink-0" role="group" aria-label="Workflow status">
		<button
			type="button"
			class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors {workflowStatus === 'draft' ? 'bg-gray-200 text-gray-900' : 'text-gray-600 hover:text-gray-900'}"
			onclick={() => { workflowStatus = 'draft'; saveWorkflow(); }}
		>
			Draft
		</button>
		<button
			type="button"
			class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors {workflowStatus === 'live' ? 'bg-green-200 text-green-900' : 'text-gray-600 hover:text-gray-900'}"
			onclick={() => { workflowStatus = 'live'; saveWorkflow(); }}
		>
			Live
		</button>
	</div>
	</header>

	<div class="flex flex-1 min-h-0 rounded-b-xl overflow-hidden border border-gray-200 border-t-0 bg-white">
	<!-- Sidebar: node palette -->
	<aside class="w-56 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col">
		<div class="p-3">
			<p class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Add node</p>
			<p class="text-xs text-gray-500 mb-2">Drag a node onto the canvas.</p>
			<div class="space-y-2">
				<button
					type="button"
					draggable="true"
					class="w-full flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-emerald-200 bg-emerald-50 text-emerald-800 text-left hover:border-emerald-400 transition-colors cursor-grab active:cursor-grabbing"
					ondragstart={(e) => {
						e.dataTransfer?.setData('application/x-profitbot-node-type', 'trigger');
						e.dataTransfer!.effectAllowed = 'move';
						isDraggingFromSidebar = true;
					}}
					ondragend={() => { isDraggingFromSidebar = false; }}
				>
					<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white pointer-events-none">
						<Zap class="w-4 h-4" />
					</span>
					<span class="font-medium text-sm pointer-events-none">Trigger</span>
				</button>
				<button
					type="button"
					draggable="true"
					class="w-full flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-amber-200 bg-amber-50 text-amber-800 text-left hover:border-amber-400 transition-colors cursor-grab active:cursor-grabbing"
					ondragstart={(e) => {
						e.dataTransfer?.setData('application/x-profitbot-node-type', 'action');
						e.dataTransfer!.effectAllowed = 'move';
						isDraggingFromSidebar = true;
					}}
					ondragend={() => { isDraggingFromSidebar = false; }}
				>
					<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white pointer-events-none">
						<CircleCheck class="w-4 h-4" />
					</span>
					<span class="font-medium text-sm pointer-events-none">Action</span>
				</button>
				<button
					type="button"
					draggable="true"
					class="w-full flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-blue-200 bg-blue-50 text-blue-800 text-left hover:border-blue-400 transition-colors cursor-grab active:cursor-grabbing"
					ondragstart={(e) => {
						e.dataTransfer?.setData('application/x-profitbot-node-type', 'condition');
						e.dataTransfer!.effectAllowed = 'move';
						isDraggingFromSidebar = true;
					}}
					ondragend={() => { isDraggingFromSidebar = false; }}
				>
					<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white pointer-events-none">
						<GitBranch class="w-4 h-4" />
					</span>
					<span class="font-medium text-sm pointer-events-none">Condition</span>
				</button>
			</div>
		</div>
	</aside>

	<!-- Flow canvas -->
	<div class="flex-1 min-w-0 min-h-0">
		<SvelteFlow
			bind:nodes
			bind:edges
			{nodeTypes}
			onconnect={onConnect}
			onnodedragstop={saveWorkflow}
			fitView
			class="bg-gray-100"
		>
			<FlowDropZone
				isDraggingFromSidebar={isDraggingFromSidebar}
				onDrop={addNodeAtPosition}
			/>
			<Background variant={BackgroundVariant.Dots} gap={16} size={1} class="bg-gray-100!" />
			<Controls class="bg-white! border-gray-200! shadow!" />
			<Panel position="top-right" class="m-2! text-xs text-gray-400">
				Connect nodes by dragging from one handle to another.
			</Panel>
		</SvelteFlow>
	</div>

	<!-- Config panel: modify selected trigger or action -->
	{#if selectedNode}
		<aside class="w-80 shrink-0 border-l border-gray-200 bg-white flex flex-col overflow-hidden">
			<div class="p-3 border-b border-gray-200 flex items-center justify-between">
				<h3 class="font-medium text-gray-900 text-sm">Configure node</h3>
				<div class="flex items-center gap-1">
					<button
						type="button"
						onclick={() => removeNode(selectedNode.id)}
						class="text-red-600 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-colors"
						aria-label="Remove node"
						title="Remove node"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
					</button>
					<button
						type="button"
						onclick={closeConfigPanel}
						class="text-gray-400 hover:text-gray-600 p-1 rounded"
						aria-label="Close"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
					</button>
				</div>
			</div>
			<div class="flex-1 overflow-y-auto p-3 space-y-4">
				{#if selectedNode.type === 'trigger'}
					{@const data = selectedNode.data ?? {}}
					{@const triggerType = data.triggerType as string | undefined}
					{@const showTriggerPicker = !triggerType || triggerType === ''}
					{#if showTriggerPicker}
						<div class="space-y-3">
							<h4 class="font-medium text-gray-900 text-sm">What triggers this workflow?</h4>
							<p class="text-xs text-gray-500">A trigger starts your workflow. Choose one below.</p>
							<div class="space-y-2">
								{#each TRIGGER_OPTIONS as { value, label, description, Icon }}
									<button
										type="button"
										onclick={() => updateNodeData(selectedNode.id, {
											triggerType: value,
											...(value === 'Message in the chat' ? { messageIntent: 'When customer requests quote' } : {})
										})}
										class="w-full flex items-center gap-3 px-3 py-3 rounded-lg border-2 border-gray-200 bg-white text-left hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors"
									>
										<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
											<Icon class="w-5 h-5" />
										</span>
										<div class="min-w-0 flex-1">
											<p class="font-medium text-gray-900 text-sm">{label}</p>
											<p class="text-xs text-gray-500 mt-0.5">{description}</p>
										</div>
										<svg class="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
									</button>
								{/each}
							</div>
						</div>
					{:else}
						<div class="space-y-3">
							<div class="flex items-center justify-end">
								<button
									type="button"
									onclick={() => updateNodeData(selectedNode.id, { triggerType: '' })}
									class="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
								>
									Change trigger
								</button>
							</div>
							{#if triggerType === 'Form submit'}
								<label for="form-trigger-form" class="block text-xs font-medium text-gray-500">Form</label>
								<select
									id="form-trigger-form"
									class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white"
									value={data.formId ?? (forms[0]?.id ?? '')}
									onchange={(e) => updateNodeData(selectedNode.id, { formId: (e.currentTarget as HTMLSelectElement).value })}
								>
									{#each forms as f}
										<option value={f.id}>{f.name ?? f.title ?? f.id}</option>
									{/each}
								</select>
								<p class="text-xs text-gray-500">Runs when this form is submitted on your site.</p>
							{:else if triggerType === 'Message in the chat'}
							<label for="chat-trigger-when" class="block text-xs font-medium text-gray-500">When</label>
							<select
								id="chat-trigger-when"
								class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white"
								value={data.messageIntent ?? 'When customer requests quote'}
								onchange={(e) => updateNodeData(selectedNode.id, { messageIntent: (e.currentTarget as HTMLSelectElement).value })}
							>
								<option value="When customer requests quote">When customer requests quote</option>
							</select>
							<label for="chat-trigger-widget" class="block text-xs font-medium text-gray-500">Chat widget</label>
							<select
								id="chat-trigger-widget"
								class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white"
								value={data.widgetId ?? (widgets[0]?.id ?? '')}
								onchange={(e) => updateNodeData(selectedNode.id, { widgetId: (e.currentTarget as HTMLSelectElement).value })}
							>
								{#each widgets as w}
									<option value={w.id}>{w.name}</option>
								{/each}
							</select>
							<p class="text-xs text-gray-500">Assign to a widget so this workflow runs when a customer sends a message in that widget’s chat.</p>
						{:else if triggerType === 'Inbound webhook'}
							{@const webhookUrl = `${origin}/api/workflows/trigger/${workflowId}/${selectedNode.id}`}
							<div class="space-y-2">
								<label class="block text-xs font-medium text-gray-500">Webhook URL</label>
								<div class="flex gap-2">
									<input type="text" readonly value={webhookUrl} class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-600 bg-gray-50 font-mono" />
									<button type="button" onclick={() => copyWebhookUrl(webhookUrl)} class="shrink-0 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">Copy</button>
								</div>
								<p class="text-xs text-gray-500">POST to this URL to start the workflow. Optional: send <code class="bg-gray-100 px-1 rounded">X-Webhook-Secret</code> header or <code class="bg-gray-100 px-1 rounded">secret</code> in JSON body to validate.</p>
								<label class="block text-xs font-medium text-gray-500">Secret (optional)</label>
								<input
									type="password"
									placeholder="Leave empty to skip validation"
									value={data.webhookSecret ?? ''}
									oninput={(e) => updateNodeData(selectedNode.id, { webhookSecret: (e.currentTarget as HTMLInputElement).value })}
									class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white placeholder:text-gray-400"
								/>
							</div>
						{/if}
						</div>
					{/if}
				{:else if selectedNode.type === 'action'}
					{@const data = selectedNode.data ?? {}}
					{@const actionType = data.actionType as string | undefined}
					{@const showActionPicker = !actionType || actionType === ''}
					{#if showActionPicker}
						<div class="space-y-3">
							<h4 class="font-medium text-gray-900 text-sm">What should this action do?</h4>
							<p class="text-xs text-gray-500">Choose an action below.</p>
							<div class="space-y-2">
								{#each ACTION_OPTIONS as { value, label, description, Icon }}
									<button
										type="button"
										onclick={() => updateNodeData(selectedNode.id, { actionType: value })}
										class="w-full flex items-center gap-3 px-3 py-3 rounded-lg border-2 border-gray-200 bg-white text-left hover:border-amber-300 hover:bg-amber-50/50 transition-colors"
									>
										<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
											<Icon class="w-5 h-5" />
										</span>
										<div class="min-w-0 flex-1">
											<p class="font-medium text-gray-900 text-sm">{label}</p>
											<p class="text-xs text-gray-500 mt-0.5">{description}</p>
										</div>
										<svg class="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
									</button>
								{/each}
							</div>
						</div>
					{:else}
						<div class="space-y-3">
							<div class="flex items-center justify-between gap-2">
								<label class="flex items-center gap-2 cursor-pointer">
									<input
										type="checkbox"
										checked={data.enabled !== false}
										onchange={(e) => updateNodeData(selectedNode.id, { enabled: (e.currentTarget as HTMLInputElement).checked })}
										class="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
									/>
									<span class="text-sm font-medium text-gray-900">Run this action</span>
								</label>
								<button
									type="button"
									onclick={() => updateNodeData(selectedNode.id, { actionType: '' })}
									class="text-xs text-amber-600 hover:text-amber-700 font-medium"
								>
									Change action
								</button>
							</div>
							{#if actionType === 'Generate quote'}
								<p class="text-xs text-gray-500">Creates a PDF quote from the conversation. No extra settings.</p>
							{:else if actionType === 'Send email'}
								<div class="space-y-3">
									<div>
										<div class="flex items-center justify-between gap-2 mb-1">
											<label for="email-to" class="text-xs font-medium text-gray-500">To (recipient)</label>
											<div class="relative">
												<button
													type="button"
													onclick={() => activeEmailVarField = activeEmailVarField === 'emailTo' ? null : 'emailTo'}
													class="text-xs font-medium text-amber-600 hover:text-amber-700"
												>
													Add variable
												</button>
												{#if activeEmailVarField === 'emailTo'}
													<div class="absolute right-0 top-full mt-1 z-10 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
														{#each EMAIL_VARIABLE_GROUPS as { group, fields }}
															<p class="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">{group}</p>
															{#each fields as { key, label }}
																<button type="button" class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-amber-50" onclick={() => insertEmailVariable('emailTo', group, key)}>{label}</button>
															{/each}
														{/each}
													</div>
												{/if}
											</div>
										</div>
										<input
											id="email-to"
											type="text"
											placeholder={EMAIL_TO_PLACEHOLDER}
											value={typeof data.emailTo === 'string' ? data.emailTo : ''}
											oninput={(e) => updateNodeData(selectedNode.id, { emailTo: (e.currentTarget as HTMLInputElement).value })}
											class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white placeholder:text-gray-400"
										/>
									</div>
									<div class="flex items-center justify-between">
										<label for="email-send-copy" class="text-xs font-medium text-gray-500">Send a copy</label>
										<button
											type="button"
											role="switch"
											aria-checked={!!(data.emailSendCopy ?? false)}
											onclick={() => updateNodeData(selectedNode.id, { emailSendCopy: !(data.emailSendCopy ?? false) })}
											class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-gray-300 bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 {(data.emailSendCopy ?? false) ? 'border-amber-500 bg-amber-500' : ''}"
										>
											<span class="sr-only">Send a copy</span>
											<span class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform absolute left-0.5 top-0.5 {(data.emailSendCopy ?? false) ? 'translate-x-4' : 'translate-x-0'}"></span>
										</button>
									</div>
									{#if data.emailSendCopy}
										<div>
											<div class="flex items-center justify-between gap-2 mb-1">
												<label for="email-copy-to" class="text-xs font-medium text-gray-500">Copy to (CC/BCC)</label>
												<div class="relative">
													<button type="button" onclick={() => activeEmailVarField = activeEmailVarField === 'emailCopyTo' ? null : 'emailCopyTo'} class="text-xs font-medium text-amber-600 hover:text-amber-700">Add variable</button>
													{#if activeEmailVarField === 'emailCopyTo'}
														<div class="absolute right-0 top-full mt-1 z-10 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
															{#each EMAIL_VARIABLE_GROUPS as { group, fields }}
																<p class="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">{group}</p>
																{#each fields as { key, label }}
																	<button type="button" class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-amber-50" onclick={() => insertEmailVariable('emailCopyTo', group, key)}>{label}</button>
																{/each}
															{/each}
														</div>
													{/if}
												</div>
											</div>
											<input
												id="email-copy-to"
												type="text"
												placeholder="e.g. team@example.com"
												value={typeof data.emailCopyTo === 'string' ? data.emailCopyTo : ''}
												oninput={(e) => updateNodeData(selectedNode.id, { emailCopyTo: (e.currentTarget as HTMLInputElement).value })}
												class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white placeholder:text-gray-400"
											/>
										</div>
									{/if}
									<div>
										<div class="flex items-center justify-between gap-2 mb-1">
											<label for="email-subject" class="text-xs font-medium text-gray-500">Subject</label>
											<div class="relative">
												<button type="button" onclick={() => activeEmailVarField = activeEmailVarField === 'emailSubject' ? null : 'emailSubject'} class="text-xs font-medium text-amber-600 hover:text-amber-700">Add variable</button>
												{#if activeEmailVarField === 'emailSubject'}
													<div class="absolute right-0 top-full mt-1 z-10 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
														{#each EMAIL_VARIABLE_GROUPS as { group, fields }}
															<p class="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">{group}</p>
															{#each fields as { key, label }}
																<button type="button" class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-amber-50" onclick={() => insertEmailVariable('emailSubject', group, key)}>{label}</button>
															{/each}
														{/each}
													</div>
												{/if}
											</div>
										</div>
										<input
											id="email-subject"
											type="text"
											placeholder={EMAIL_SUBJECT_PLACEHOLDER}
											value={typeof data.emailSubject === 'string' ? data.emailSubject : ''}
											oninput={(e) => updateNodeData(selectedNode.id, { emailSubject: (e.currentTarget as HTMLInputElement).value })}
											class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white placeholder:text-gray-400"
										/>
									</div>
									<div>
										<div class="flex items-center justify-between gap-2 mb-1">
											<label for="email-body" class="text-xs font-medium text-gray-500">Body</label>
											<div class="relative">
												<button type="button" onclick={() => activeEmailVarField = activeEmailVarField === 'emailBody' ? null : 'emailBody'} class="text-xs font-medium text-amber-600 hover:text-amber-700">Add variable</button>
												{#if activeEmailVarField === 'emailBody'}
													<div class="absolute right-0 top-full mt-1 z-10 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
														{#each EMAIL_VARIABLE_GROUPS as { group, fields }}
															<p class="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">{group}</p>
															{#each fields as { key, label }}
																<button type="button" class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-amber-50" onclick={() => insertEmailVariable('emailBody', group, key)}>{label}</button>
															{/each}
														{/each}
													</div>
												{/if}
											</div>
										</div>
										<textarea
											id="email-body"
											placeholder={EMAIL_BODY_PLACEHOLDER}
											value={typeof data.emailBody === 'string' ? data.emailBody : ''}
											oninput={(e) => updateNodeData(selectedNode.id, { emailBody: (e.currentTarget as HTMLTextAreaElement).value })}
											class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white placeholder:text-gray-400 min-h-[100px]"
											rows={5}
										></textarea>
										<p class="text-xs text-gray-400 mt-1">{EMAIL_PLACEHOLDER_HINT}</p>
									</div>
								</div>
							{:else if actionType === 'Outbound webhook'}
							<!-- n8n-style HTTP Request: Parameters + Settings tabs -->
							<div class="flex border-b border-gray-200 mb-3">
								<button
									type="button"
									class="px-3 py-2 text-sm font-medium border-b-2 -mb-px {outboundWebhookTab === 'parameters' ? 'border-amber-500 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
									onclick={() => (outboundWebhookTab = 'parameters')}
								>
									Parameters
								</button>
								<button
									type="button"
									class="px-3 py-2 text-sm font-medium border-b-2 -mb-px {outboundWebhookTab === 'settings' ? 'border-amber-500 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
									onclick={() => (outboundWebhookTab = 'settings')}
								>
									Settings
								</button>
							</div>
							{#if outboundWebhookTab === 'parameters'}
								<div class="space-y-3">
									<div>
										<label for="webhook-method" class="block text-xs font-medium text-gray-500 mb-1">Method</label>
										<select
											id="webhook-method"
											class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white"
											value={data.webhookMethod ?? 'POST'}
											onchange={(e) => updateNodeData(selectedNode.id, { webhookMethod: (e.currentTarget as HTMLSelectElement).value })}
										>
											<option value="GET">GET</option>
											<option value="POST">POST</option>
											<option value="PUT">PUT</option>
											<option value="PATCH">PATCH</option>
											<option value="DELETE">DELETE</option>
										</select>
									</div>
									<div>
										<label for="webhook-url" class="block text-xs font-medium text-gray-500 mb-1">URL</label>
										<input
											id="webhook-url"
											type="url"
											placeholder="https://example.com/endpoint"
											value={data.webhookUrl ?? ''}
											oninput={(e) => updateNodeData(selectedNode.id, { webhookUrl: (e.currentTarget as HTMLInputElement).value })}
											class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white font-mono placeholder:text-gray-400"
										/>
									</div>
									<div>
										<label for="webhook-auth" class="block text-xs font-medium text-gray-500 mb-1">Authentication</label>
										<select
											id="webhook-auth"
											class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white"
											value={data.webhookAuth ?? 'none'}
											onchange={(e) => updateNodeData(selectedNode.id, { webhookAuth: (e.currentTarget as HTMLSelectElement).value })}
										>
											<option value="none">None</option>
											<option value="basic">Basic Auth</option>
											<option value="bearer">Bearer Token</option>
											<option value="apiKey">API Key in Header</option>
										</select>
									</div>
									{#if (data.webhookAuth ?? 'none') === 'basic'}
										<div class="grid grid-cols-2 gap-2">
											<div>
												<label for="webhook-basic-user" class="block text-xs font-medium text-gray-500 mb-1">User</label>
												<input id="webhook-basic-user" type="text" placeholder="Username" value={data.webhookAuthUser ?? ''} oninput={(e) => updateNodeData(selectedNode.id, { webhookAuthUser: (e.currentTarget as HTMLInputElement).value })} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
											</div>
											<div>
												<label for="webhook-basic-pass" class="block text-xs font-medium text-gray-500 mb-1">Password</label>
												<input id="webhook-basic-pass" type="password" placeholder="Password" value={data.webhookAuthPassword ?? ''} oninput={(e) => updateNodeData(selectedNode.id, { webhookAuthPassword: (e.currentTarget as HTMLInputElement).value })} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
											</div>
										</div>
									{:else if (data.webhookAuth ?? 'none') === 'bearer'}
										<div>
											<label for="webhook-bearer" class="block text-xs font-medium text-gray-500 mb-1">Bearer Token</label>
											<input id="webhook-bearer" type="password" placeholder="Token" value={data.webhookAuthBearer ?? ''} oninput={(e) => updateNodeData(selectedNode.id, { webhookAuthBearer: (e.currentTarget as HTMLInputElement).value })} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white font-mono" />
										</div>
									{:else if (data.webhookAuth ?? 'none') === 'apiKey'}
										<div class="grid grid-cols-2 gap-2">
											<div>
												<label for="webhook-apikey-name" class="block text-xs font-medium text-gray-500 mb-1">Header name</label>
												<input id="webhook-apikey-name" type="text" placeholder="X-API-Key" value={data.webhookAuthApiKeyName ?? ''} oninput={(e) => updateNodeData(selectedNode.id, { webhookAuthApiKeyName: (e.currentTarget as HTMLInputElement).value })} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white font-mono" />
											</div>
											<div>
												<label for="webhook-apikey-value" class="block text-xs font-medium text-gray-500 mb-1">Value</label>
												<input id="webhook-apikey-value" type="password" placeholder="Key" value={data.webhookAuthApiKeyValue ?? ''} oninput={(e) => updateNodeData(selectedNode.id, { webhookAuthApiKeyValue: (e.currentTarget as HTMLInputElement).value })} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
											</div>
										</div>
									{/if}
									<div class="flex items-center justify-between">
										<label for="webhook-send-query" class="text-xs font-medium text-gray-500">Send Query Parameters</label>
										<button type="button" role="switch" aria-checked={!!(data.webhookSendQuery ?? false)} onclick={() => updateNodeData(selectedNode.id, { webhookSendQuery: !(data.webhookSendQuery ?? false) })} class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-gray-300 bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 {(data.webhookSendQuery ?? false) ? 'border-amber-500 bg-amber-500' : ''}"><span class="sr-only">Toggle</span><span class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform absolute left-0.5 top-0.5 {(data.webhookSendQuery ?? false) ? 'translate-x-4' : 'translate-x-0'}"></span></button>
									</div>
									{#if data.webhookSendQuery}
										<div>
											<label for="webhook-query" class="block text-xs font-medium text-gray-500 mb-1">Query (JSON object)</label>
											<textarea id="webhook-query" placeholder={'{"param": "value"}'} value={typeof data.webhookQueryParams === 'string' ? data.webhookQueryParams : (data.webhookQueryParams ? JSON.stringify(data.webhookQueryParams) : '')} oninput={(e) => updateNodeData(selectedNode.id, { webhookQueryParams: (e.currentTarget as HTMLTextAreaElement).value })} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white font-mono min-h-[60px]" rows={2}></textarea>
										</div>
									{/if}
									<div class="flex items-center justify-between">
										<label for="webhook-send-headers" class="text-xs font-medium text-gray-500">Send Headers</label>
										<button type="button" role="switch" aria-checked={!!(data.webhookSendHeaders ?? false)} onclick={() => updateNodeData(selectedNode.id, { webhookSendHeaders: !(data.webhookSendHeaders ?? false) })} class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-gray-300 bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 {(data.webhookSendHeaders ?? false) ? 'border-amber-500 bg-amber-500' : ''}"><span class="sr-only">Toggle</span><span class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform absolute left-0.5 top-0.5 {(data.webhookSendHeaders ?? false) ? 'translate-x-4' : 'translate-x-0'}"></span></button>
									</div>
									{#if data.webhookSendHeaders}
										<div>
											<label for="webhook-headers" class="block text-xs font-medium text-gray-500 mb-1">Headers (JSON object)</label>
											<textarea id="webhook-headers" placeholder={'{"Authorization": "Bearer ...", "Content-Type": "application/json"}'} value={typeof data.webhookHeaders === 'string' ? data.webhookHeaders : (data.webhookHeaders ? JSON.stringify(data.webhookHeaders, null, 2) : '')} oninput={(e) => updateNodeData(selectedNode.id, { webhookHeaders: (e.currentTarget as HTMLTextAreaElement).value })} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white font-mono min-h-[70px]" rows={3}></textarea>
										</div>
									{/if}
									<div class="flex items-center justify-between">
										<label for="webhook-send-body" class="text-xs font-medium text-gray-500">Send Body</label>
										<button type="button" role="switch" aria-checked={!!(data.webhookSendBody ?? true)} onclick={() => updateNodeData(selectedNode.id, { webhookSendBody: !(data.webhookSendBody ?? true) })} class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-gray-300 bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 {(data.webhookSendBody ?? true) ? 'border-amber-500 bg-amber-500' : ''}"><span class="sr-only">Toggle</span><span class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform absolute left-0.5 top-0.5 {(data.webhookSendBody ?? true) ? 'translate-x-4' : 'translate-x-0'}"></span></button>
									</div>
									{#if data.webhookSendBody !== false}
										<div>
											<label for="webhook-body-type" class="block text-xs font-medium text-gray-500 mb-1">Body content type</label>
											<select id="webhook-body-type" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white mb-2" value={data.webhookBodyContentType ?? 'json'} onchange={(e) => updateNodeData(selectedNode.id, { webhookBodyContentType: (e.currentTarget as HTMLSelectElement).value })}>
												<option value="json">JSON</option>
												<option value="raw">Raw text</option>
											</select>
											<label for="webhook-body" class="block text-xs font-medium text-gray-500 mb-1">Body</label>
											<textarea id="webhook-body" placeholder={(data.webhookBodyContentType ?? 'json') === 'json' ? '{"key": "value"}' : 'Plain text or XML'} value={typeof data.webhookBody === 'string' ? data.webhookBody : ''} oninput={(e) => updateNodeData(selectedNode.id, { webhookBody: (e.currentTarget as HTMLTextAreaElement).value })} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white font-mono min-h-[80px]" rows={4}></textarea>
										</div>
									{/if}
								</div>
							{:else}
								<div class="space-y-3">
									<div class="flex items-center justify-between">
										<label for="webhook-retry" class="text-xs font-medium text-gray-500">Retry on fail</label>
										<button type="button" role="switch" aria-checked={!!(data.webhookRetryOnFail ?? false)} onclick={() => updateNodeData(selectedNode.id, { webhookRetryOnFail: !(data.webhookRetryOnFail ?? false) })} class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-gray-300 bg-gray-200 transition-colors focus:outline-none {(data.webhookRetryOnFail ?? false) ? 'border-amber-500 bg-amber-500' : ''}"><span class="sr-only">Toggle</span><span class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform absolute left-0.5 top-0.5 {(data.webhookRetryOnFail ?? false) ? 'translate-x-4' : 'translate-x-0'}"></span></button>
									</div>
									<div>
										<label for="webhook-on-error" class="block text-xs font-medium text-gray-500 mb-1">On Error</label>
										<select id="webhook-on-error" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white" value={data.webhookOnError ?? 'stop'} onchange={(e) => updateNodeData(selectedNode.id, { webhookOnError: (e.currentTarget as HTMLSelectElement).value })}>
											<option value="stop">Stop workflow</option>
											<option value="continue">Continue</option>
										</select>
									</div>
									<div>
										<label for="webhook-timeout" class="block text-xs font-medium text-gray-500 mb-1">Timeout (seconds, optional)</label>
										<input id="webhook-timeout" type="number" min="1" max="300" placeholder="e.g. 30" value={typeof data.webhookTimeout === 'string' || typeof data.webhookTimeout === 'number' ? data.webhookTimeout : ''} oninput={(e) => updateNodeData(selectedNode.id, { webhookTimeout: (e.currentTarget as HTMLInputElement).value })} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
									</div>
									<div>
										<label for="webhook-notes" class="block text-xs font-medium text-gray-500 mb-1">Notes</label>
										<textarea id="webhook-notes" placeholder="Add a note for this node..." value={typeof data.webhookNotes === 'string' ? data.webhookNotes : ''} oninput={(e) => updateNodeData(selectedNode.id, { webhookNotes: (e.currentTarget as HTMLTextAreaElement).value })} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white min-h-[60px]" rows={2}></textarea>
									</div>
								</div>
							{/if}
							{:else if actionType === 'AI'}
								<div class="space-y-3">
									<label for="ai-connection" class="block text-xs font-medium text-gray-500">Connection</label>
									<select
										id="ai-connection"
										class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white"
										value={data.aiConnection ?? (llmProvidersWithKeys.length > 0 ? 'integrated' : 'custom')}
										onchange={(e) => updateNodeData(selectedNode.id, { aiConnection: (e.currentTarget as HTMLSelectElement).value })}
									>
										<option value="integrated" disabled={llmProvidersWithKeys.length === 0}>Use my integrated API keys (Settings)</option>
										<option value="custom">Custom API key</option>
									</select>
									{#if llmProvidersWithKeys.length === 0 && (data.aiConnection ?? '') === 'integrated'}
										<p class="text-xs text-amber-600">Add API keys in Settings → LLM API keys, then use “integrated” here.</p>
									{/if}
									{#if (data.aiConnection ?? (llmProvidersWithKeys.length > 0 ? 'integrated' : 'custom')) === 'integrated'}
										{#if llmProvidersWithKeys.length > 0}
										<div>
											<label for="ai-provider" class="block text-xs font-medium text-gray-500 mb-1">Provider</label>
											<select
												id="ai-provider"
												class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white"
												value={data.aiProvider ?? (llmProvidersWithKeys[0] ?? '')}
												onchange={(e) => updateNodeData(selectedNode.id, { aiProvider: (e.currentTarget as HTMLSelectElement).value, aiModel: '' })}
											>
												{#each llmProvidersWithKeys as pid}
													{@const p = LLM_PROVIDERS.find((x) => x.id === pid)}
													{#if p}
														<option value={p.id}>{p.name}</option>
													{/if}
												{/each}
											</select>
										</div>
										{/if}
									{:else}
										<div>
											<label for="ai-provider-custom" class="block text-xs font-medium text-gray-500 mb-1">Provider</label>
											<select
												id="ai-provider-custom"
												class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white"
												value={data.aiProvider ?? 'openai'}
												onchange={(e) => updateNodeData(selectedNode.id, { aiProvider: (e.currentTarget as HTMLSelectElement).value, aiModel: '' })}
											>
												{#each LLM_PROVIDERS as p}
													<option value={p.id}>{p.name}</option>
												{/each}
											</select>
										</div>
										<div>
											<label for="ai-apikey" class="block text-xs font-medium text-gray-500 mb-1">API key</label>
											<input
												id="ai-apikey"
												type="password"
												placeholder="e.g. sk-... or your provider key"
												value={typeof data.aiApiKey === 'string' ? data.aiApiKey : ''}
												oninput={(e) => updateNodeData(selectedNode.id, { aiApiKey: (e.currentTarget as HTMLInputElement).value })}
												class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white font-mono placeholder:text-gray-400"
											/>
											<p class="text-xs text-gray-400 mt-1">Stored with the workflow. Add keys in Settings for shared use.</p>
										</div>
									{/if}
									<div>
										<label for="ai-model" class="block text-xs font-medium text-gray-500 mb-1">Model</label>
										<select
											id="ai-model"
											class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white"
											value={data.aiModel ?? ''}
											onchange={(e) => updateNodeData(selectedNode.id, { aiModel: (e.currentTarget as HTMLSelectElement).value })}
										>
											{#each getModels(typeof data.aiProvider === 'string' ? data.aiProvider : (llmProvidersWithKeys[0] ?? 'openai')) as modelId}
												<option value={modelId}>{modelId}</option>
											{/each}
										</select>
									</div>
									<div>
										<label for="ai-prompt" class="block text-xs font-medium text-gray-500 mb-1">Prompt</label>
										<textarea
											id="ai-prompt"
											placeholder={AI_PROMPT_PLACEHOLDER}
											value={typeof data.aiPrompt === 'string' ? data.aiPrompt : ''}
											oninput={(e) => updateNodeData(selectedNode.id, { aiPrompt: (e.currentTarget as HTMLTextAreaElement).value })}
											class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white placeholder:text-gray-400 min-h-[120px]"
											rows={5}
										></textarea>
										<p class="text-xs text-gray-400 mt-1">{AI_PROMPT_HINT}</p>
									</div>
								</div>
						{/if}
						</div>
					{/if}
				{:else if selectedNode.type === 'condition'}
					<p class="text-sm text-gray-500">Condition node configuration coming soon.</p>
				{/if}
			</div>
		</aside>
		{/if}
	</div>

	{#if showExitConfirm}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 rounded-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="exit-confirm-title"
		>
			<div class="bg-white rounded-xl shadow-xl p-6 max-w-sm mx-4 border border-gray-200">
				<h3 id="exit-confirm-title" class="font-semibold text-gray-900 text-lg">Changes not saved</h3>
				<p class="text-sm text-gray-600 mt-2">You have unsaved changes. Leave without saving?</p>
				<div class="flex gap-2 justify-end mt-6">
					<button
						type="button"
						onclick={cancelLeave}
						class="px-4 py-2 rounded-lg font-medium bg-gray-100 text-gray-900 hover:bg-gray-200"
					>
						Stay
					</button>
					<button
						type="button"
						onclick={confirmLeave}
						class="px-4 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700"
					>
						Continue
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
