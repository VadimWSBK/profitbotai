<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';

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
		contactId?: string | null;
		contactName?: string | null;
		contactEmail?: string | null;
	};
	type Message = {
		id: string;
		role: string;
		content: string;
		readAt: string | null;
		createdAt: string;
		channel?: 'chat' | 'email';
		status?: string;
		direction?: 'outbound' | 'inbound';
	};
	type ConversationDetail = {
		id: string;
		widgetId: string;
		widgetName: string;
		sessionId: string;
		isAiActive: boolean;
		createdAt: string;
		updatedAt: string;
		contactId?: string | null;
		contactName?: string | null;
		contactEmail?: string | null;
	};

	const CHANNELS: { id: 'all' | 'chat' | 'email'; label: string; disabled?: boolean }[] = [
		{ id: 'all', label: 'All' },
		{ id: 'chat', label: 'Chat' },
		{ id: 'email', label: 'Email' }
	];

	const widgets = $derived((data?.widgets ?? []) as Widget[]);

	let selectedWidgetId = $state<string | null>(null);
	let conversations = $state<Conversation[]>([]);
	let selectedConversation = $state<Conversation | null>(null);
	let messages = $state<Message[]>([]);
	let conversationDetail = $state<ConversationDetail | null>(null);
	let channelFilter = $state<'all' | 'chat' | 'email'>('all');
	let humanReply = $state('');
	let emailSubject = $state('');
	let emailBody = $state('');
	let sendingEmail = $state(false);
	let emailError = $state<string | null>(null);
	let syncInboxLoading = $state(false);
	let loading = $state(false);
	let sending = $state(false);
	let hasMoreMessages = $state(false);
	let loadingMore = $state(false);
	let messagesContainerEl = $state<HTMLDivElement | undefined>(undefined);
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let typingTimeout: ReturnType<typeof setTimeout> | null = null;

	const MESSAGES_PAGE_SIZE = 20;

	const widgetFilterLabel = $derived(
		selectedWidgetId ? widgets.find((w) => w.id === selectedWidgetId)?.name ?? 'All widgets' : 'All widgets'
	);

	function displayContactLabel(conv: Conversation | ConversationDetail | null): string {
		if (!conv) return 'Unknown';
		const name = conv.contactName ?? conv.contactEmail;
		if (name?.trim()) return name.trim();
		return conv.widgetName ?? 'Unknown contact';
	}

	function contactInitial(conv: Conversation | ConversationDetail | null): string {
		return displayContactLabel(conv).charAt(0).toUpperCase() || '?';
	}

	function contactUrl(conv: Conversation | ConversationDetail | null): string {
		if (!conv) return '/contacts';
		const id = conv.contactId;
		return id ? `/contacts?contact=${encodeURIComponent(id)}` : '/contacts';
	}

	const filteredMessages = $derived(
		channelFilter === 'all' ? messages : messages.filter((m) => (m.channel ?? 'chat') === channelFilter)
	);

	const currentConv = $derived(conversationDetail ?? selectedConversation);

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

	async function scrollToBottom() {
		await tick();
		requestAnimationFrame(() => {
			if (messagesContainerEl) messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
		});
	}

	async function selectConversation(conv: Conversation) {
		selectedConversation = conv;
		conversationDetail = null;
		messages = [];
		hasMoreMessages = false;
		channelFilter = 'all';
		emailSubject = '';
		emailBody = '';
		emailError = null;
		try {
			const res = await fetch(`/api/conversations/${conv.id}?limit=${MESSAGES_PAGE_SIZE}`);
			const json = await res.json().catch(() => ({}));
			conversationDetail = json.conversation ?? null;
			messages = Array.isArray(json.messages) ? json.messages : [];
			hasMoreMessages = !!json.hasMore;
			scrollToBottom();
			// Refresh sidebar unread badge (conversation GET marks user messages as read)
			await invalidateAll();
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
		const newestCreatedAt = messages.length > 0 ? messages[messages.length - 1].createdAt : null;
		try {
			const url = newestCreatedAt
				? `/api/conversations/${selectedConversation.id}?since=${encodeURIComponent(newestCreatedAt)}`
				: `/api/conversations/${selectedConversation.id}?limit=${MESSAGES_PAGE_SIZE}`;
			const res = await fetch(url);
			const json = await res.json().catch(() => ({}));
			if (json.conversation) conversationDetail = json.conversation;
			if (Array.isArray(json.messages)) {
				if (newestCreatedAt && json.messages.length > 0) {
					messages = [...messages, ...json.messages];
					scrollToBottom();
				} else if (!newestCreatedAt) {
					messages = json.messages;
					hasMoreMessages = !!json.hasMore;
					scrollToBottom();
				}
			}
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

	async function sendEmail() {
		const subject = emailSubject.trim();
		const body = emailBody.trim();
		if (!subject || !body || !selectedConversation) return;
		emailError = null;
		sendingEmail = true;
		try {
			const res = await fetch(`/api/conversations/${selectedConversation.id}/send-email`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ subject, body })
			});
			const json = await res.json().catch(() => ({}));
			if (res.ok && json.sent) {
				emailSubject = '';
				emailBody = '';
				await refreshMessages();
				scrollToBottom();
			} else {
				emailError = json.error ?? 'Failed to send email';
			}
		} finally {
			sendingEmail = false;
		}
	}

	async function syncInbox() {
		if (syncInboxLoading) return;
		syncInboxLoading = true;
		emailError = null;
		try {
			const res = await fetch('/api/settings/integrations/resend/sync-received', { method: 'POST' });
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				await refreshMessages();
			} else {
				const raw = (data.error as string) ?? 'Failed to sync inbox';
				// Resend returns this when the API key is send-only
				if (/restricted.*send|only send/i.test(raw)) {
					emailError =
						'Your Resend API key can only send emails. To sync inbound replies, create an API key with Inbound permission at resend.com/api-keys and update it in Integrations.';
				} else {
					emailError = raw;
				}
			}
		} catch {
			emailError = 'Failed to sync inbox';
		} finally {
			syncInboxLoading = false;
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
				scrollToBottom();
			}
		} finally {
			sending = false;
		}
	}

	async function loadMoreMessages() {
		if (!selectedConversation || messages.length === 0 || loadingMore || !hasMoreMessages) return;
		const oldestCreatedAt = messages[0].createdAt;
		loadingMore = true;
		try {
			const res = await fetch(
				`/api/conversations/${selectedConversation.id}?limit=${MESSAGES_PAGE_SIZE}&before=${encodeURIComponent(oldestCreatedAt)}`
			);
			const json = await res.json().catch(() => ({}));
			if (Array.isArray(json.messages) && json.messages.length > 0) {
				messages = [...json.messages, ...messages];
				hasMoreMessages = !!json.hasMore;
			} else {
				hasMoreMessages = false;
			}
		} catch {
			// ignore
		} finally {
			loadingMore = false;
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

	// Deep-link: select conversation from URL ?conversation=id (e.g. from Contacts page)
	$effect(() => {
		const convId = $page.url.searchParams.get('conversation');
		if (convId && conversations.length > 0 && (!selectedConversation || selectedConversation.id !== convId)) {
			const conv = conversations.find((c) => c.id === convId);
			if (conv) selectConversation(conv);
		}
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

	/** Format message/email content: bold subject, clickable URLs, styled quoted blocks. */
	function formatMessageContent(content: string): string {
		const escape = (s: string) =>
			String(s)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		let out = escape(content);
		// Bold **subject** (API sends email as **Subject**\n\nbody)
		out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
		// Clickable URLs (don't include trailing punctuation)
		out = out.replace(
			/(https?:\/\/[^\s<\[\]()"']+)/g,
			(url) => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer" class="text-amber-600 hover:text-amber-700 underline break-all">${escape(url)}</a>`
		);
		// Quoted lines (> prefix): style as block, remove the > from display
		const lines = out.split('\n');
		const parts: string[] = [];
		let inQuote = false;
		for (const line of lines) {
			const isQuote = line.startsWith('&gt;') || line.startsWith('>');
			if (isQuote) {
				if (!inQuote) {
					parts.push('<div class="email-quote border-l-2 border-gray-300 pl-3 my-2 text-gray-600 text-xs space-y-0.5">');
					inQuote = true;
				}
				parts.push(line.replace(/^(&gt;|>)\s?/, '') + '<br>');
			} else {
				if (inQuote) {
					parts.push('</div>');
					inQuote = false;
				}
				parts.push(line + '<br>');
			}
		}
		if (inQuote) parts.push('</div>');
		return parts.join('').replace(/<br>$/, '');
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
						<div
							role="button"
							tabindex="0"
							class="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none cursor-pointer {selectedConversation?.id === conv.id ? 'bg-amber-50 border-l-4 border-l-amber-500' : ''}"
							onclick={() => selectConversation(conv)}
							onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectConversation(conv)}
						>
							<div class="flex items-center gap-2">
								<a
									href={contactUrl(conv)}
									onclick={(e) => e.stopPropagation()}
									class="shrink-0 w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-semibold hover:bg-amber-200 transition-colors no-underline"
									title="Open contact"
								>
									{contactInitial(conv)}
								</a>
								<div class="min-w-0 flex-1">
									<div class="flex items-center justify-between gap-2">
										<a
											href={contactUrl(conv)}
											onclick={(e) => e.stopPropagation()}
											class="font-medium text-gray-800 truncate hover:text-amber-600 transition-colors no-underline"
											title="Open contact"
										>
											{displayContactLabel(conv)}
										</a>
										{#if conv.unreadCount > 0}
											<span class="shrink-0 rounded-full bg-amber-500 text-white text-xs font-medium min-w-5 h-5 flex items-center justify-center px-1.5">
												{conv.unreadCount}
											</span>
										{/if}
									</div>
									<div class="text-xs text-gray-500 mt-0.5">
										{conv.widgetName} · Session: {conv.sessionId.slice(0, 12)}…
									</div>
									<div class="flex items-center gap-2 mt-1">
										<span class="text-xs {conv.isAiActive ? 'text-green-600' : 'text-amber-600'}">
											{conv.isAiActive ? 'AI active' : 'Human takeover'}
										</span>
										<span class="text-xs text-gray-400">{formatDate(conv.updatedAt)}</span>
									</div>
								</div>
							</div>
						</div>
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
					<!-- Header: contact name, session, Take over / Start AI -->
					<div class="shrink-0 flex flex-col border-b border-gray-200 bg-gray-50">
						<div class="flex items-center justify-between gap-4 p-4">
							<div class="flex items-center gap-3">
								<a
									href={contactUrl(currentConv)}
									class="shrink-0 w-10 h-10 rounded-full bg-amber-500 text-white flex items-center justify-center text-base font-semibold hover:bg-amber-600 transition-colors no-underline"
									title="Open contact"
								>
									{contactInitial(currentConv)}
								</a>
								<div>
									<a
										href={contactUrl(currentConv)}
										class="font-medium text-gray-800 hover:text-amber-600 transition-colors no-underline"
										title="Open contact"
									>
										{displayContactLabel(currentConv)}
									</a>
									<p class="text-sm text-gray-500">
										{selectedConversation.widgetName} · Session: {selectedConversation.sessionId}
									</p>
								</div>
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
						<!-- Channel filter tabs -->
						<div class="flex gap-0 px-4 border-t border-gray-200">
							{#each CHANNELS as ch}
								<button
									type="button"
									class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors {channelFilter === ch.id
										? 'border-amber-500 text-amber-600'
										: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} {ch.disabled ? 'opacity-50 cursor-not-allowed' : ''}"
									disabled={ch.disabled}
									onclick={() => !ch.disabled && (channelFilter = ch.id)}
									title={ch.disabled ? 'Coming soon' : ''}
								>
									{ch.label}
								</button>
							{/each}
						</div>
					</div>

					<!-- Messages: fixed max height, latest at bottom, scroll up to load more -->
					<div
						bind:this={messagesContainerEl}
						class="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 space-y-3"
					>
						{#if hasMoreMessages}
							<div class="flex justify-center pb-2">
								<button
									type="button"
									class="text-sm text-amber-600 hover:text-amber-700 font-medium disabled:opacity-50"
									disabled={loadingMore}
									onclick={loadMoreMessages}
								>
									{loadingMore ? 'Loading…' : 'Load more'}
								</button>
							</div>
						{/if}
						{#if channelFilter !== 'all' && filteredMessages.length === 0}
							<div class="flex-1 flex items-center justify-center py-8 text-gray-500 text-sm">
								{channelFilter === 'email' ? 'No email messages yet. Send one below.' : `No ${channelFilter} messages.`}
							</div>
						{:else}
							{#each filteredMessages as msg}
							<div
								class="flex {msg.role === 'user' ? 'justify-end' : msg.role === 'human_agent' ? 'justify-end' : 'justify-start'}"
							>
								<div
									class="max-w-[80%] min-w-0 rounded-lg px-4 py-2 text-sm break-words {msg.role === 'user'
										? 'bg-amber-100 text-gray-900'
										: msg.role === 'human_agent'
											? 'bg-blue-100 text-gray-900'
											: 'bg-gray-100 text-gray-900'}"
								>
									<div class="flex items-center gap-2 mb-1 flex-wrap">
										{#if msg.role === 'human_agent'}
											<span class="text-xs font-medium text-blue-700">You (agent)</span>
										{:else if msg.role === 'user'}
											<span class="text-xs font-medium text-amber-700">
												{msg.channel === 'email' && msg.direction === 'inbound' ? 'Contact' : 'Visitor'}
											</span>
										{:else}
											<span class="text-xs font-medium text-gray-600">AI</span>
										{/if}
										{#if channelFilter === 'all' && (msg.channel ?? 'chat') === 'email'}
											<span class="text-xs text-gray-400">via email</span>
										{/if}
									</div>
									<div class="whitespace-pre-wrap break-words [&_.email-quote]:whitespace-normal [&_a]:break-all">{@html formatMessageContent(msg.content)}</div>
									<div class="flex items-center gap-2 mt-1">
										<span class="text-xs text-gray-500">{formatTime(msg.createdAt)}</span>
										{#if msg.channel === 'email'}
											{#if msg.direction === 'inbound'}
												<span class="text-xs text-cyan-600">(received)</span>
											{:else if msg.status}
												<span class="text-xs {msg.status === 'opened' ? 'text-green-600' : msg.status === 'delivered' ? 'text-blue-600' : msg.status === 'bounced' || msg.status === 'failed' ? 'text-red-600' : 'text-gray-400'}">
													({msg.status})
												</span>
											{/if}
										{/if}
									</div>
								</div>
							</div>
							{/each}
						{/if}
					</div>

					<!-- Human reply (when takeover) - Chat/All -->
					{#if conversationDetail && !conversationDetail.isAiActive && channelFilter !== 'email'}
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

					<!-- Send email - Email tab -->
					{#if channelFilter === 'email' && currentConv?.contactEmail}
						<div class="shrink-0 flex justify-end px-4 py-2 border-t border-gray-200 bg-gray-50/80">
							<button
								type="button"
								onclick={syncInbox}
								disabled={syncInboxLoading}
								class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
							>
								{syncInboxLoading ? 'Syncing…' : 'Sync inbox'}
							</button>
						</div>
						<form
							class="shrink-0 flex flex-col gap-3 p-4 border-t border-gray-200 bg-gray-50"
							onsubmit={(e) => {
								e.preventDefault();
								sendEmail();
							}}
						>
							<input
								type="text"
								class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
								placeholder="Subject"
								bind:value={emailSubject}
								disabled={sendingEmail}
							/>
							<textarea
								class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 min-h-[80px] resize-y"
								placeholder="Message…"
								bind:value={emailBody}
								disabled={sendingEmail}
							></textarea>
							{#if emailError}
								<p class="text-sm text-red-600">{emailError}</p>
							{/if}
							<button
								type="submit"
								class="self-end rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
								disabled={sendingEmail || !emailSubject.trim() || !emailBody.trim()}
							>
								{sendingEmail ? 'Sending…' : 'Send email'}
							</button>
						</form>
					{:else if channelFilter === 'email' && !currentConv?.contactEmail}
						<div class="shrink-0 p-4 border-t border-gray-200 bg-gray-50 text-sm text-gray-500">
							Contact has no email address. Add one in the Contacts page.
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
