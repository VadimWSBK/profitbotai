<script lang="ts">
	let { data } = $props();

	type Widget = { id: string; name: string };
	type Stage = { id: string; name: string; sortOrder: number; createdAt: string };
	type Contact = {
		id: string;
		conversationId: string | null;
		widgetId: string | null;
		widgetName: string | null;
		name: string | null;
		email: string | null;
		phone: string | null;
		createdAt: string;
		updatedAt: string;
		lastConversationAt?: string | null;
	};
	type Lead = {
		id: string;
		contactId: string;
		stageId: string;
		contact: Contact | null;
		updatedAt: string;
	};

	const widgets = $derived((data?.widgets ?? []) as Widget[]);

	let stages = $state<Stage[]>([]);
	let leads = $state<Lead[]>([]);
	let contacts = $state<Contact[]>([]);
	let selectedWidgetId = $state<string | null>(null);
	let loading = $state(true);
	let manageStagesOpen = $state(false);
	let newStageName = $state('');
	let editingStageId = $state<string | null>(null);
	let editingStageName = $state('');
	let movingLeadId = $state<string | null>(null);

	const widgetFilterLabel = $derived(
		selectedWidgetId ? widgets.find((w) => w.id === selectedWidgetId)?.name ?? 'All widgets' : 'All widgets'
	);

	// Unassigned = contacts that have no lead
	const unassignedContacts = $derived(
		contacts.filter((c) => !leads.some((l) => l.contactId === c.id))
	);

	// Leads per stage (filtered by widget if set)
	const leadsByStage = $derived.by(() => {
		const map: Record<string, Lead[]> = {};
		for (const s of stages) map[s.id] = [];
		for (const lead of leads) {
			if (selectedWidgetId && lead.contact?.widgetId !== selectedWidgetId) continue;
			if (map[lead.stageId]) map[lead.stageId].push(lead);
		}
		for (const id of Object.keys(map)) map[id].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
		return map;
	});

	// Unassigned filtered by widget
	const unassignedFiltered = $derived(
		selectedWidgetId ? unassignedContacts.filter((c) => c.widgetId === selectedWidgetId) : unassignedContacts
	);

	function displayLabel(c: Contact): string {
		if (c.name?.trim()) return c.name.trim();
		if (c.email?.trim()) return c.email.trim();
		return 'Unknown';
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}

	/** First 3 days in hours, then days, weeks, months, years. */
	function timeSinceLastConversation(iso: string | null | undefined): string {
		if (!iso) return 'No contact yet';
		const then = new Date(iso).getTime();
		const now = Date.now();
		const ms = now - then;
		if (ms < 0) return 'Just now';
		const minutes = Math.floor(ms / 60_000);
		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
		const hours = Math.floor(ms / 3_600_000);
		const threeDaysHours = 72;
		if (hours < threeDaysHours) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
		const days = Math.floor(ms / 86_400_000);
		if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
		const weeks = Math.floor(days / 7);
		if (weeks < 8) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
		const months = Math.floor(days / 30);
		if (months < 24) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
		const years = Math.floor(days / 365);
		return `${years} ${years === 1 ? 'year' : 'years'} ago`;
	}

	async function fetchStages() {
		const res = await fetch('/api/leadflow/stages');
		const json = await res.json().catch(() => ({}));
		stages = Array.isArray(json.stages) ? json.stages : [];
	}

	async function fetchLeads() {
		const url = selectedWidgetId ? `/api/leadflow/leads?widget_id=${encodeURIComponent(selectedWidgetId)}` : '/api/leadflow/leads';
		const res = await fetch(url);
		const json = await res.json().catch(() => ({}));
		leads = Array.isArray(json.leads) ? json.leads : [];
	}

	async function fetchContacts() {
		const url = selectedWidgetId ? `/api/contacts?widget_id=${encodeURIComponent(selectedWidgetId)}` : '/api/contacts';
		const res = await fetch(url);
		const json = await res.json().catch(() => ({}));
		contacts = Array.isArray(json.contacts) ? json.contacts : [];
	}

	async function loadAll() {
		loading = true;
		try {
			await Promise.all([fetchStages(), fetchLeads(), fetchContacts()]);
		} finally {
			loading = false;
		}
	}

	async function moveLead(leadId: string, stageId: string) {
		movingLeadId = leadId;
		try {
			const res = await fetch(`/api/leadflow/leads/${leadId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ stage_id: stageId })
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error || 'Failed to move');
			await fetchLeads();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to move lead');
		} finally {
			movingLeadId = null;
		}
	}

	async function addContactToStage(contactId: string, stageId: string) {
		movingLeadId = contactId;
		try {
			const res = await fetch('/api/leadflow/leads', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ contact_id: contactId, stage_id: stageId })
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error || 'Failed to add');
			await fetchLeads();
			await fetchContacts();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to add lead');
		} finally {
			movingLeadId = null;
		}
	}

	async function createStage() {
		const name = newStageName.trim();
		if (!name) return;
		try {
			const res = await fetch('/api/leadflow/stages', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, sort_order: stages.length })
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error || 'Failed to create');
			newStageName = '';
			await fetchStages();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to create stage');
		}
	}

	async function updateStage(id: string, name: string) {
		const trimmed = name.trim();
		if (!trimmed) return;
		try {
			const res = await fetch(`/api/leadflow/stages/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: trimmed })
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error || 'Failed to update');
			editingStageId = null;
			editingStageName = '';
			await fetchStages();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to update stage');
		}
	}

	async function deleteStage(id: string) {
		if (!confirm('Delete this stage? Leads in it will be moved to the first other stage.')) return;
		try {
			const res = await fetch(`/api/leadflow/stages/${id}`, { method: 'DELETE' });
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error || 'Failed to delete');
			await fetchStages();
			await fetchLeads();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete stage');
		}
	}

	function startEditStage(s: Stage) {
		editingStageId = s.id;
		editingStageName = s.name;
	}

	function cancelEditStage() {
		editingStageId = null;
		editingStageName = '';
	}

	function contactUrl(contactId: string): string {
		return `/contacts?contact=${encodeURIComponent(contactId)}`;
	}

	const DRAG_TYPE = 'application/x-profitbot-leadflow';

	type DragPayload = { kind: 'lead'; leadId: string; contactId: string; sourceStageId: string } | { kind: 'unassigned'; contactId: string };

	let draggedPayload = $state<DragPayload | null>(null);
	let dropTargetStageId = $state<string | null>(null);

	function onDragStart(e: DragEvent, payload: DragPayload) {
		const target = e.target as HTMLElement;
		if (target.closest('a[href^="/contacts"]')) {
			e.preventDefault();
			return;
		}
		draggedPayload = payload;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
			e.dataTransfer.setData('text/plain', ''); // some browsers need this
		}
	}

	function onDragEnd() {
		draggedPayload = null;
		dropTargetStageId = null;
	}

	function onDragOver(e: DragEvent, stageId: string) {
		if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		dropTargetStageId = stageId;
	}

	function onDragLeave() {
		dropTargetStageId = null;
	}

	function onDrop(e: DragEvent, stageId: string) {
		e.preventDefault();
		dropTargetStageId = null;
		const raw = e.dataTransfer?.getData(DRAG_TYPE);
		if (!raw) return;
		let payload: DragPayload;
		try {
			payload = JSON.parse(raw) as DragPayload;
		} catch {
			return;
		}
		if (payload.kind === 'lead') {
			if (stageId && payload.sourceStageId !== stageId) moveLead(payload.leadId, stageId);
		} else {
			if (stageId) addContactToStage(payload.contactId, stageId);
		}
	}

	$effect(() => {
		loadAll();
	});
</script>

<svelte:head>
	<title>Leadflow</title>
</svelte:head>

<div class="flex flex-col min-h-0 gap-4">
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
		<h1 class="text-xl font-semibold text-gray-800">Leadflow</h1>
		<div class="flex items-center gap-3">
			<div class="flex items-center gap-2">
				<label for="leadflow-widget" class="text-sm text-gray-600 shrink-0">Widget</label>
				<select
					id="leadflow-widget"
					class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
					bind:value={selectedWidgetId}
				>
					<option value={null}>All widgets</option>
					{#each widgets as w}
						<option value={w.id}>{w.name}</option>
					{/each}
				</select>
			</div>
			<button
				type="button"
				onclick={() => (manageStagesOpen = true)}
				class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
			>
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
				</svg>
				Manage stages
			</button>
		</div>
	</div>

	{#if loading}
		<div class="flex-1 flex items-center justify-center py-12">
			<div class="animate-pulse text-gray-500 text-sm">Loading pipeline…</div>
		</div>
	{:else}
		<!-- Kanban: horizontal scroll -->
		<div class="flex-1 min-h-0 overflow-x-auto overflow-y-auto pb-4">
			<div class="flex gap-4 min-w-max h-full items-start">
				<!-- Unassigned column -->
				<div class="w-72 shrink-0 flex flex-col rounded-xl border border-gray-200 bg-gray-50/80 overflow-hidden shadow-sm">
					<div class="p-3 border-b border-gray-200 bg-gray-100 shrink-0 flex items-center justify-between">
						<span class="font-medium text-gray-700">Unassigned</span>
						<span class="text-sm text-gray-500">{unassignedFiltered.length}</span>
					</div>
					<div class="flex-1 min-h-[200px] overflow-y-auto p-2 space-y-2">
						{#each unassignedFiltered as contact}
							<div
								role="group"
								aria-label="Contact card"
								class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm hover:shadow transition-shadow cursor-grab active:cursor-grabbing {draggedPayload?.kind === 'unassigned' && draggedPayload.contactId === contact.id ? 'opacity-50' : ''}"
								draggable="true"
								ondragstart={(e) => onDragStart(e, { kind: 'unassigned', contactId: contact.id })}
								ondragend={onDragEnd}
							>
								<div class="flex items-start gap-2">
									<a
										href={contactUrl(contact.id)}
										class="shrink-0 w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-semibold hover:bg-amber-200 transition-colors no-underline"
										title="Open contact"
										draggable="false"
										onclick={(e) => e.stopPropagation()}
									>
										{displayLabel(contact).charAt(0).toUpperCase()}
									</a>
									<div class="min-w-0 flex-1">
										<div class="font-medium text-gray-800 truncate">{displayLabel(contact)}</div>
										{#if contact.email}
											<div class="text-xs text-gray-500 truncate">{contact.email}</div>
										{/if}
										{#if contact.widgetName}
											<div class="text-xs text-gray-400 mt-0.5">{contact.widgetName}</div>
										{/if}
										<div class="text-xs text-gray-500 mt-0.5" title={contact.lastConversationAt ? formatDate(contact.lastConversationAt) : ''}>
											Last contact: {timeSinceLastConversation(contact.lastConversationAt)}
										</div>
									</div>
								</div>
								{#if stages.length > 0}
									<div class="mt-2 pt-2 border-t border-gray-100">
										<select
											class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-amber-500 focus:outline-none"
											onchange={(e) => {
												const sid = (e.currentTarget as HTMLSelectElement).value;
												if (sid) addContactToStage(contact.id, sid);
											}}
											disabled={movingLeadId === contact.id}
										>
											<option value="">Move to…</option>
											{#each stages as s}
												<option value={s.id}>{s.name}</option>
											{/each}
										</select>
									</div>
								{/if}
							</div>
						{:else}
							<div class="text-sm text-gray-500 py-4 text-center">No unassigned contacts</div>
						{/each}
					</div>
				</div>

				<!-- Stage columns -->
				{#each stages as stage}
					<div class="w-72 shrink-0 flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
						<div class="p-3 border-b border-gray-200 bg-amber-50 shrink-0 flex items-center justify-between">
							<span class="font-medium text-gray-800">{stage.name}</span>
							<span class="text-sm text-gray-500">{(leadsByStage[stage.id] ?? []).length}</span>
						</div>
						<div
							role="region"
							aria-label="Drop zone for {stage.name}"
							class="flex-1 min-h-[200px] overflow-y-auto p-2 space-y-2 transition-colors {dropTargetStageId === stage.id ? 'bg-amber-50/80 ring-2 ring-amber-300 ring-inset rounded-lg' : ''}"
							ondragover={(e) => onDragOver(e, stage.id)}
							ondragleave={onDragLeave}
							ondrop={(e) => onDrop(e, stage.id)}
						>
							{#each (leadsByStage[stage.id] ?? []) as lead}
								{@const contact = lead.contact}
								{#if contact}
									<div
										role="group"
										aria-label="Lead card"
										class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm hover:shadow transition-shadow cursor-grab active:cursor-grabbing {draggedPayload?.kind === 'lead' && draggedPayload.leadId === lead.id ? 'opacity-50' : ''}"
										draggable="true"
										ondragstart={(e) => onDragStart(e, { kind: 'lead', leadId: lead.id, contactId: contact.id, sourceStageId: stage.id })}
										ondragend={onDragEnd}
									>
										<div class="flex items-start gap-2">
											<a
												href={contactUrl(contact.id)}
												class="shrink-0 w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-semibold hover:bg-amber-200 transition-colors no-underline"
												title="Open contact"
												draggable="false"
												onclick={(e) => e.stopPropagation()}
											>
												{displayLabel(contact).charAt(0).toUpperCase()}
											</a>
											<div class="min-w-0 flex-1">
												<div class="font-medium text-gray-800 truncate">{displayLabel(contact)}</div>
												{#if contact.email}
													<div class="text-xs text-gray-500 truncate">{contact.email}</div>
												{/if}
												{#if contact.widgetName}
													<div class="text-xs text-gray-400 mt-0.5">{contact.widgetName}</div>
												{/if}
												<div class="text-xs text-gray-500 mt-0.5" title={contact.lastConversationAt ? formatDate(contact.lastConversationAt) : ''}>
													Last contact: {timeSinceLastConversation(contact.lastConversationAt)}
												</div>
											</div>
										</div>
										{#if stages.length > 1}
											<div class="mt-2 pt-2 border-t border-gray-100">
												<select
													class="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-amber-500 focus:outline-none"
													onchange={(e) => {
														const sid = (e.currentTarget as HTMLSelectElement).value;
														if (sid && sid !== stage.id) moveLead(lead.id, sid);
													}}
													disabled={movingLeadId === lead.id}
												>
													<option value={stage.id}>—</option>
													{#each stages as s}
														{#if s.id !== stage.id}
															<option value={s.id}>{s.name}</option>
														{/if}
													{/each}
												</select>
											</div>
										{/if}
									</div>
								{/if}
							{/each}
							{#if (leadsByStage[stage.id] ?? []).length === 0}
								<div class="text-sm text-gray-500 py-4 text-center">No leads</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<!-- Manage stages modal -->
{#if manageStagesOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
		onclick={() => (manageStagesOpen = false)}
		onkeydown={(e) => e.key === 'Escape' && (manageStagesOpen = false)}
		role="presentation"
	>
		<div
			class="rounded-xl border border-gray-200 bg-white shadow-xl max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			aria-labelledby="manage-stages-title"
			tabindex="-1"
		>
			<div class="p-4 border-b border-gray-200 flex items-center justify-between shrink-0">
				<h2 id="manage-stages-title" class="text-lg font-semibold text-gray-800">Manage stages</h2>
				<button
					type="button"
					onclick={() => (manageStagesOpen = false)}
					class="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
					aria-label="Close"
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			<div class="p-4 overflow-y-auto flex-1 space-y-4">
				<div class="flex gap-2">
					<input
						type="text"
						class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
						placeholder="New stage name"
						bind:value={newStageName}
						onkeydown={(e) => e.key === 'Enter' && createStage()}
					/>
					<button
						type="button"
						onclick={createStage}
						class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors shrink-0"
					>
						Add stage
					</button>
				</div>
				<ul class="space-y-2">
					{#each stages as s}
						<li class="flex items-center gap-2 rounded-lg border border-gray-200 p-2">
							{#if editingStageId === s.id}
								<input
									type="text"
									class="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
									bind:value={editingStageName}
									onkeydown={(e) => {
										if (e.key === 'Enter') updateStage(s.id, editingStageName);
										if (e.key === 'Escape') cancelEditStage();
									}}
								/>
								<button
									type="button"
									onclick={() => updateStage(s.id, editingStageName)}
									class="text-sm font-medium text-amber-600 hover:text-amber-700"
								>
									Save
								</button>
								<button type="button" onclick={cancelEditStage} class="text-sm text-gray-500 hover:text-gray-700">
									Cancel
								</button>
							{:else}
								<span class="flex-1 font-medium text-gray-800">{s.name}</span>
								<button
									type="button"
									onclick={() => startEditStage(s)}
									class="text-sm text-gray-500 hover:text-amber-600"
								>
									Edit
								</button>
								<button
									type="button"
									onclick={() => deleteStage(s.id)}
									class="text-sm text-red-600 hover:text-red-700"
								>
									Delete
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		</div>
	</div>
{/if}
