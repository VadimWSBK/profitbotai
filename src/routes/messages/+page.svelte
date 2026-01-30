<script lang="ts">
	import { onDestroy } from 'svelte';

	let { data } = $props();

	type Widget = { id: string; name: string; tags?: string[]; createdAt?: string };
	type Conversation = {
		id: string;
		widgetId: string;
		widgetName: string;
		sessionId: string;
		isAiActive: boolean;
		createdAt: string;
		updatedAt: string;
		unreadCount: number;
	};
	type Message = {
		id: string;
		role: string;
		content: string;
		readAt: string | null;
		createdAt: string;
	};

	const widgets = $derived((data?.widgets ?? []) as Widget[]);

	let selectedWidgetId = $state<string | null>(null);
	let conversations = $state<Conversation[]>([]);
	let selectedConversation = $state<Conversation | null>(null);
	let messages = $state<Message[]>([]);
	let conversationDetail = $state<{ id: string; widgetId: string; widgetName: string; sessionId: string; isAiActive: boolean; createdAt: string; updatedAt: string } | null>(null);
	let humanReply = $state('');
	let loading = $state(false);
	let sending = $state(false);
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let typingTimeout: ReturnType<typeof setTimeout> | null = null;

	const widgetFilterLabel = $derived(
		selectedWidgetId ? widgets.find((w) => w.id === selectedWidgetId)?.name ?? 'All widgets' : 'All widgets'
	);

	async function fetchConversations() {
		loading = true;
		try {
			const url = selectedWidgetId
				? `/api/conversations?widget_id=${encodeURIComponent(selectedWidgetId)}`
				: '/api/conversations';
			const res = await fetch(url);
			const json = await res.json().catch(() => ({}));
			conversations = Array.isArray(json.conversations) ? json.conversations : [];
		} finally {
			loading = false;
		}
	}

	async function selectConversation(conv: Conversation) {
		selectedConversation = conv;
		conversationDetail = null;
		messages = [];
		try {
			const res = await fetch(`/api/conversations/${conv.id}`);
			const json = await res.json().catch(() => ({}));
			conversationDetail = json.conversation ?? null;
			messages = Array.isArray(json.messages) ? json.messages : [];
		} catch {
			// ignore
		}
		startPolling();
	}

	function startPolling() {
		stopPolling();
		pollInterval = setInterval(() => {
			if (selectedConversation) refreshMessages();
		}, 3000);
	}

	function stopPolling() {
		if (pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}
	}

	async function refreshMessages() {
		if (!selectedConversation) return;
		try {
			const res = await fetch(`/api/conversations/${selectedConversation.id}`);
			const json = await res.json().catch(() => ({}));
			if (json.conversation) conversationDetail = json.conversation;
			if (Array.isArray(json.messages)) messages = json.messages;
		} catch {
			// ignore
		}
	}

	async function setAiActive(isActive: boolean) {
		if (!selectedConversation) return;
		sending = true;
		try {
			const res = await fetch(`/api/conversations/${selectedConversation.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ is_ai_active: isActive })
			});
			if (res.ok && conversationDetail) {
				conversationDetail = { ...conversationDetail, isAiActive: isActive };
				conversations = conversations.map((c) =>
					c.id === selectedConversation!.id ? { ...c, isAiActive: isActive } : c
				);
			}
		} finally {
			sending = false;
		}
	}

	async function sendHumanReply() {
		const content = humanReply.trim();
		if (!content || !selectedConversation) return;
		sendAgentTyping(false);
		sending = true;
		try {
			const res = await fetch(`/api/conversations/${selectedConversation.id}/messages`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content })
			});
			if (res.ok) {
				humanReply = '';
				await refreshMessages();
			}
		} finally {
			sending = false;
		}
	}

	async function sendAgentTyping(active: boolean) {
		if (!selectedConversation || conversationDetail?.isAiActive) return;
		if (typingTimeout) {
			clearTimeout(typingTimeout);
			typingTimeout = null;
		}
		try {
			await fetch(`/api/conversations/${selectedConversation.id}/typing`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ active })
			});
		} catch {
			// ignore
		}
	}

	function onAgentInput() {
		if (!selectedConversation || conversationDetail?.isAiActive) return;
		if (typingTimeout) clearTimeout(typingTimeout);
		sendAgentTyping(true);
		typingTimeout = setTimeout(() => {
			typingTimeout = null;
			sendAgentTyping(true);
		}, 2000);
	}

	function onAgentBlur() {
		if (typingTimeout) {
			clearTimeout(typingTimeout);
			typingTimeout = null;
		}
		sendAgentTyping(false);
	}

	$effect(() => {
		const w = selectedWidgetId;
		if (selectedConversation && w !== null && selectedConversation.widgetId !== w) {
			selectedConversation = null;
			conversationDetail = null;
			messages = [];
			stopPolling();
		}
		fetchConversations();
	});

	onDestroy(() => {
		stopPolling();
		if (typingTimeout) {
			clearTimeout(typingTimeout);
			typingTimeout = null;
		}
	});

	function formatTime(iso: string) {
		const d = new Date(iso);
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}

	function formatDate(iso: string) {
		const d = new Date(iso);
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
	}
</script>

<svelte:head>
	<title>Messages</title>
</svelte:head>

<div class="flex flex-col h-full gap-4">
	<div class="flex items-center justify-between gap-4 flex-wrap">
		<h1 class="text-xl font-semibold text-gray-800">Messages</h1>
		<div class="flex items-center gap-2">
			<label for="widget-filter" class="text-sm text-gray-600">Widget</label>
			<select
				id="widget-filter"
				class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
				bind:value={selectedWidgetId}
			>
				<option value={null}>All widgets</option>
				{#each widgets as w}
					<option value={w.id}>{w.name}</option>
				{/each}
			</select>
		</div>
	</div>

	<div class="flex flex-1 min-h-0 gap-4 rounded-xl border border-gray-200 bg-white overflow-hidden">
		<!-- Conversation list -->
		<aside class="w-72 flex flex-col border-r border-gray-200 shrink-0 overflow-hidden">
			<div class="p-3 border-b border-gray-100 text-sm text-gray-500">
				{conversations.length} conversation{conversations.length !== 1 ? 's' : ''}
			</div>
			<div class="flex-1 overflow-y-auto">
				{#if loading}
					<div class="p-4 text-center text-gray-500 text-sm">Loading…</div>
				{:else if conversations.length === 0}
					<div class="p-4 text-center text-gray-500 text-sm">No conversations yet.</div>
				{:else}
					{#each conversations as conv}
						<button
							type="button"
							class="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none {selectedConversation?.id === conv.id ? 'bg-amber-50 border-l-4 border-l-amber-500' : ''}"
							onclick={() => selectConversation(conv)}
						>
							<div class="flex items-center justify-between gap-2">
								<span class="font-medium text-gray-800 truncate">{conv.widgetName}</span>
								{#if conv.unreadCount > 0}
									<span class="shrink-0 rounded-full bg-amber-500 text-white text-xs font-medium min-w-5 h-5 flex items-center justify-center px-1.5">
										{conv.unreadCount}
									</span>
								{/if}
							</div>
							<div class="text-xs text-gray-500 mt-0.5">
								Session: {conv.sessionId.slice(0, 12)}…
							</div>
							<div class="flex items-center gap-2 mt-1">
								<span class="text-xs {conv.isAiActive ? 'text-green-600' : 'text-amber-600'}">
									{conv.isAiActive ? 'AI active' : 'Human takeover'}
								</span>
								<span class="text-xs text-gray-400">{formatDate(conv.updatedAt)}</span>
							</div>
						</button>
					{/each}
				{/if}
			</div>
		</aside>

		<!-- Message thread -->
		<div class="flex-1 flex flex-col min-w-0">
			{#if !selectedConversation}
				<div class="flex-1 flex items-center justify-center text-gray-500 p-6">
					Select a conversation to view messages.
				</div>
			{:else}
				<div class="flex flex-col h-full">
					<!-- Header: widget name, session, Take over / Start AI -->
					<div class="shrink-0 flex items-center justify-between gap-4 p-4 border-b border-gray-200 bg-gray-50">
						<div>
							<h2 class="font-medium text-gray-800">{conversationDetail?.widgetName ?? selectedConversation.widgetName}</h2>
							<p class="text-sm text-gray-500">Session: {selectedConversation.sessionId}</p>
						</div>
						<div class="flex items-center gap-2">
							{#if conversationDetail?.isAiActive}
								<button
									type="button"
									class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
									disabled={sending}
									onclick={() => setAiActive(false)}
								>
									Take over
								</button>
							{:else}
								<button
									type="button"
									class="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
									disabled={sending}
									onclick={() => setAiActive(true)}
								>
									Start AI
								</button>
							{/if}
						</div>
					</div>

					<!-- Messages -->
					<div class="flex-1 overflow-y-auto p-4 space-y-3">
						{#each messages as msg}
							<div
								class="flex {msg.role === 'user' ? 'justify-end' : msg.role === 'human_agent' ? 'justify-end' : 'justify-start'}"
							>
								<div
									class="max-w-[80%] rounded-lg px-4 py-2 text-sm {msg.role === 'user'
										? 'bg-amber-100 text-gray-900'
										: msg.role === 'human_agent'
											? 'bg-blue-100 text-gray-900'
											: 'bg-gray-100 text-gray-900'}"
								>
									{#if msg.role === 'human_agent'}
										<span class="text-xs font-medium text-blue-700 block mb-1">You (agent)</span>
									{:else if msg.role === 'user'}
										<span class="text-xs font-medium text-amber-700 block mb-1">Visitor</span>
									{:else}
										<span class="text-xs font-medium text-gray-600 block mb-1">AI</span>
									{/if}
									<div class="whitespace-pre-wrap">{msg.content}</div>
									<div class="text-xs text-gray-500 mt-1">{formatTime(msg.createdAt)}</div>
								</div>
							</div>
						{/each}
					</div>

					<!-- Human reply (when takeover) -->
					{#if conversationDetail && !conversationDetail.isAiActive}
						<form
							class="shrink-0 flex gap-2 p-4 border-t border-gray-200 bg-gray-50"
							onsubmit={(e) => {
								e.preventDefault();
								sendHumanReply();
							}}
						>
							<input
								type="text"
								class="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-800 placeholder-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
								placeholder="Reply as agent…"
								bind:value={humanReply}
								disabled={sending}
								oninput={onAgentInput}
								onfocus={onAgentInput}
								onblur={onAgentBlur}
							/>
							<button
								type="submit"
								class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
								disabled={sending || !humanReply.trim()}
							>
								Send
							</button>
						</form>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
