<script lang="ts">
	import type { WidgetConfig } from '$lib/widget-config';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { readUIMessageStream } from 'ai';

	let { config, widgetId, onClose } = $props<{ config: WidgetConfig; widgetId?: string; onClose: () => void }>();

	type Message = { role: 'user' | 'bot'; content: string; avatarUrl?: string };

	const SESSION_STORAGE_KEY = (id: string) => `profitbot_session_${id}`;

	function getSessionId(): string {
		if (!widgetId) return 'preview';
		if (!browser) return 'preview';
		const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('session_id') : null;
		const fromUrl = typeof params === 'string' ? params.trim() : '';
		if (fromUrl) return fromUrl;
		const key = SESSION_STORAGE_KEY(widgetId);
		let stored = '';
		try {
			stored = localStorage.getItem(key) ?? '';
		} catch {
			// ignore
		}
		if (stored.trim()) return stored.trim();
		const newId = `visitor_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
		try {
			localStorage.setItem(key, newId);
		} catch {
			// ignore
		}
		return newId;
	}

	let sessionId = $state('');
	let inputText = $state('');
	let messages = $state<Message[]>([]);
	let showStarterPrompts = $state(true);
	let loading = $state(false);
	let messagesLoading = $state(false);
	let agentTyping = $state(false);
	let agentAvatarUrl = $state<string | null>(null);
	let contentEl: HTMLDivElement;
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	const win = $derived(config.window);
	const bubble = $derived(config.bubble);
	const botStyle = $derived(win.botMessageSettings);
	const useDirect = $derived(config.chatBackend === 'direct' && !!config.llmProvider && !!widgetId);

	function addBotMessage(content: string) {
		messages = [...messages, { role: 'bot', content }];
		showStarterPrompts = false;
		requestAnimationFrame(() => scrollToBottom());
	}

	function scrollToBottom() {
		if (contentEl) contentEl.scrollTop = contentEl.scrollHeight;
	}

	async function fetchStoredMessages() {
		if (!widgetId || !sessionId || sessionId === 'preview') {
			messagesLoading = false;
			return;
		}
		try {
			const res = await fetch(`/api/widgets/${widgetId}/messages?session_id=${encodeURIComponent(sessionId)}`);
			const data = await res.json().catch(() => ({}));
			const list = Array.isArray(data.messages) ? data.messages : [];
			// Only overwrite messages on initial load so we never wipe the user's last message (e.g. if this request returns late)
			if (messages.length === 0 && list.length > 0) {
				messages = list.map((m: { role: string; content: string; avatarUrl?: string }) => ({
					role: m.role as 'user' | 'bot',
					content: m.content,
					avatarUrl: m.avatarUrl
				}));
				showStarterPrompts = false;
				requestAnimationFrame(() => scrollToBottom());
			}
			if (list.length > 0 || data.agentTyping || data.agentAvatarUrl) {
				agentTyping = !!data.agentTyping;
				agentAvatarUrl = data.agentAvatarUrl ?? null;
			}
		} catch {
			// ignore
		} finally {
			messagesLoading = false;
		}
	}

	function startPolling() {
		if (!useDirect || !widgetId || !sessionId || sessionId === 'preview') return;
		pollTimer = setInterval(async () => {
			// Don't overwrite messages while we're waiting for our own send — keeps the user's message visible
			if (loading) return;
			try {
				const res = await fetch(`/api/widgets/${widgetId}/messages?session_id=${encodeURIComponent(sessionId)}`);
				const data = await res.json().catch(() => ({}));
				const newList = Array.isArray(data.messages) ? data.messages : [];
				const serverMessages = newList.map((m: { role: string; content: string; avatarUrl?: string }) => ({
					role: m.role as 'user' | 'bot',
					content: m.content,
					avatarUrl: m.avatarUrl
				}));
				// Only replace messages when server has at least as many as we have (avoids wiping optimistic or just-added messages)
				if (serverMessages.length >= messages.length) {
					messages = serverMessages;
					showStarterPrompts = false;
					requestAnimationFrame(() => scrollToBottom());
				}
				agentTyping = !!data.agentTyping;
				agentAvatarUrl = data.agentAvatarUrl ?? null;
			} catch {
				// ignore
			}
		}, 3000);
	}

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	onMount(() => {
		sessionId = getSessionId();
		const willFetch = !!(widgetId && sessionId && sessionId !== 'preview');
		if (willFetch) messagesLoading = true;
		fetchStoredMessages();
		startPolling();
		if (!willFetch) messagesLoading = false;
	});
	onDestroy(() => stopPolling());

	async function sendMessage(text: string) {
		const trimmed = text.trim();
		if (!trimmed) return;
		messages = [...messages, { role: 'user', content: trimmed }];
		inputText = '';
		showStarterPrompts = false;
		requestAnimationFrame(() => scrollToBottom());

		loading = true;
		let botReply = config.window.customErrorMessage;
		const useN8n = config.chatBackend !== 'direct' && config.n8nWebhookUrl;
		if (useDirect) {
			try {
				const res = await fetch(`/api/widgets/${widgetId}/chat`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ message: trimmed, sessionId })
				});
				const contentType = res.headers.get('content-type') ?? '';
				if (contentType.includes('application/json')) {
					const data = await res.json().catch(() => ({}));
					if (!res.ok) {
						botReply = (data.error as string) ?? config.window.customErrorMessage;
					} else if (data.liveAgentActive) {
						loading = false;
						return;
					} else {
						botReply = data.output ?? data.message ?? botReply;
					}
					if (typeof botReply !== 'string') botReply = JSON.stringify(botReply);
				} else if (res.ok && res.body) {
					// Vercel AI SDK stream: consume and update UI as tokens arrive
					let streamMessageIndex = -1;
					for await (const uiMessage of readUIMessageStream({
						stream: res.body as unknown as ReadableStream<import('ai').UIMessageChunk>
					})) {
						const text = (uiMessage.parts ?? [])
							.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
							.map((p) => p.text)
							.join('');
						if (streamMessageIndex === -1) {
							addBotMessage(text);
							streamMessageIndex = messages.length - 1;
						} else {
							messages = messages.map((m, i) =>
								i === streamMessageIndex ? { ...m, content: text } : m
							);
						}
						requestAnimationFrame(() => scrollToBottom());
					}
					if (streamMessageIndex === -1) addBotMessage(config.window.customErrorMessage);
					loading = false;
					return;
				} else {
					botReply = config.window.customErrorMessage;
				}
			} catch {
				botReply = config.window.customErrorMessage;
			}
		} else if (useN8n) {
			try {
				const bot = config.bot ?? { role: '', tone: '', instructions: '' };
				const parts: string[] = [];
				if (bot.role?.trim()) parts.push(bot.role.trim());
				if (bot.tone?.trim()) parts.push(`Tone: ${bot.tone.trim()}`);
				if (bot.instructions?.trim()) parts.push(bot.instructions.trim());
				const systemPrompt = parts.length > 0 ? parts.join('\n\n') : undefined;
				const res = await fetch(config.n8nWebhookUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						message: trimmed,
						sessionId: 'preview',
						...(systemPrompt && { systemPrompt }),
						...(systemPrompt && { role: bot.role?.trim() || undefined, tone: bot.tone?.trim() || undefined, instructions: bot.instructions?.trim() || undefined })
					})
				});
				const data = await res.json().catch(() => ({}));
				botReply = data.output ?? data.message ?? data.reply ?? data.text ?? botReply;
				if (typeof botReply !== 'string') botReply = JSON.stringify(botReply);
			} catch {
				botReply = config.window.customErrorMessage;
			}
		} else {
			botReply = config.chatBackend === 'direct'
				? 'Configure Direct LLM in the Connect tab (add API keys in Settings).'
				: "Preview mode — add your n8n webhook URL or select Direct LLM in the Connect tab.";
		}
		addBotMessage(botReply);
		loading = false;
	}

	function handleSubmit(e: Event) {
		e.preventDefault();
		sendMessage(inputText);
	}

	function handleStarterPrompt(prompt: string) {
		sendMessage(prompt);
	}

	const winRadius = $derived(win.borderRadiusStyle === 'rounded' ? '12px' : '0');
	const headerRadius = $derived(win.borderRadiusStyle === 'rounded' ? '12px 12px 0 0' : '0');

	/** Convert markdown links [text](url) and raw URLs to clickable links. Escapes plain text for safety. */
	function formatMessageWithLinks(text: string): string {
		if (!text || typeof text !== 'string') return '';
		const escape = (s: string) =>
			String(s)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;');
		const parts: string[] = [];
		let lastIndex = 0;
		const re = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>"']+)/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			parts.push(escape(text.slice(lastIndex, m.index)));
			if (m[1] !== undefined) {
				parts.push(`<a href="${escape(m[2])}" target="_blank" rel="noopener noreferrer" class="chat-message-link underline">${escape(m[1] || m[2])}</a>`);
			} else {
				parts.push(`<a href="${escape(m[3])}" target="_blank" rel="noopener noreferrer" class="chat-message-link underline">${escape(m[3])}</a>`);
			}
			lastIndex = re.lastIndex;
		}
		parts.push(escape(text.slice(lastIndex)));
		return parts.join('');
	}
</script>

<div
	class="chat-window flex flex-col overflow-hidden shadow-2xl"
	style="
		width: {win.widthPx}px;
		height: {win.heightPx}px;
		background-color: {win.backgroundColor};
		border-radius: {winRadius};
		font-size: {win.fontSizePx}px;
	"
	role="dialog"
	aria-label="Chat"
>
	{#if win.showTitleSection}
		<header
			class="flex items-center gap-2 px-4 py-3 shrink-0"
			style="
				background-color: {win.headerBackgroundColor};
				color: {win.headerTextColor};
				border-radius: {headerRadius};
			"
		>
			{#if win.titleAvatarUrl}
				<img
					src={win.titleAvatarUrl}
					alt=""
					class="w-8 h-8 rounded-full object-contain bg-white/20"
				/>
			{:else}
				<div class="w-8 h-8 rounded-full flex items-center justify-center bg-white/20">
					<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>
				</div>
			{/if}
			<span class="flex-1 font-semibold text-sm truncate">{win.title}</span>
			<button type="button" class="p-1.5 rounded hover:opacity-80 transition-opacity" style="color: {win.headerIconColor};" onclick={() => { messages = []; showStarterPrompts = true; }} title="Refresh">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
			</button>
			<button type="button" class="p-1.5 rounded hover:opacity-80 transition-opacity" style="color: {win.headerIconColor};" onclick={onClose} title="Close">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
			</button>
		</header>
	{/if}

	<div
		bind:this={contentEl}
		class="flex-1 overflow-y-auto p-4 flex flex-col gap-3 {win.showScrollbar ? '' : 'scrollbar-hide'}"
		role="log"
		aria-live="polite"
	>
		{#if messagesLoading}
			<div class="flex-1 flex items-center justify-center min-h-[120px]" aria-busy="true" aria-label="Loading conversation">
				<svg class="animate-spin w-8 h-8 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
				</svg>
			</div>
		{:else if messages.length === 0}
			<!-- Welcome message -->
			<div class="flex gap-2 items-start">
				{#if botStyle.showAvatar && botStyle.avatarUrl}
					<img src={botStyle.avatarUrl} alt="Bot" class="w-10 h-10 rounded-full object-contain shrink-0" style="border-radius: {win.avatarBorderRadius}px;" />
				{:else if botStyle.showAvatar}
					<div class="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center shrink-0" style="width: {win.avatarSize}px; height: {win.avatarSize}px; border-radius: {win.avatarBorderRadius}px;">
						<svg class="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1v1h-3v2h4v2h-6v-4H9v-1a5 5 0 01-5-5H4V4.73C3.4 4.39 3 3.74 3 3a2 2 0 012-2h7z"/></svg>
					</div>
				{/if}
				<div
					class="px-3 py-2 max-w-[85%] rounded-lg"
					style="
						background-color: {botStyle.backgroundColor};
						color: {botStyle.textColor};
						border-radius: {win.messageBorderRadius}px;
					"
				>
					{win.welcomeMessage}
				</div>
			</div>
		{:else}
			{#each messages as msg, i (i)}
				{#if msg.role === 'bot'}
					<div class="flex gap-2 items-start">
						{#if msg.avatarUrl}
							<img src={msg.avatarUrl} alt="Agent" class="shrink-0 object-contain rounded-full" style="width: {win.avatarSize}px; height: {win.avatarSize}px; border-radius: {win.avatarBorderRadius}px;" />
						{:else if botStyle.showAvatar && botStyle.avatarUrl}
							<img src={botStyle.avatarUrl} alt="Bot" class="shrink-0 object-contain" style="width: {win.avatarSize}px; height: {win.avatarSize}px; border-radius: {win.avatarBorderRadius}px;" />
						{:else if botStyle.showAvatar}
							<div class="shrink-0 rounded-full bg-gray-300 flex items-center justify-center" style="width: {win.avatarSize}px; height: {win.avatarSize}px; border-radius: {win.avatarBorderRadius}px;">
								<svg class="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1v1h-3v2h4v2h-6v-4H9v-1a5 5 0 01-5-5H4V4.73C3.4 4.39 3 3.74 3 3a2 2 0 012-2h7z"/></svg>
							</div>
						{/if}
						<div
							class="px-3 py-2 max-w-[85%] rounded-lg flex items-start gap-2"
							style="
								background-color: {botStyle.backgroundColor};
								color: {botStyle.textColor};
								border-radius: {win.messageBorderRadius}px;
							"
						>
							<span class="flex-1 break-words">{@html formatMessageWithLinks(msg.content)}</span>
							{#if botStyle.showCopyToClipboardIcon}
								<button type="button" class="shrink-0 opacity-70 hover:opacity-100" onclick={() => navigator.clipboard.writeText(msg.content)} title="Copy">
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
								</button>
							{/if}
						</div>
					</div>
				{:else}
					<div class="flex justify-end">
				<div
					class="px-3 py-2 max-w-[85%] rounded-lg"
					style="
						background-color: {bubble.backgroundColor};
						color: {bubble.colorOfInternalIcons};
						border-radius: {win.messageBorderRadius}px;
					"
				>
					{msg.content}
				</div>
					</div>
				{/if}
			{/each}
			{#if loading || agentTyping}
				<div class="flex gap-2 items-start">
					{#if (loading ? botStyle.showAvatar : true)}
						{#if !agentTyping && botStyle.showAvatar && botStyle.avatarUrl}
							<img src={botStyle.avatarUrl} alt="" class="shrink-0 object-contain" style="width: {win.avatarSize}px; height: {win.avatarSize}px; border-radius: {win.avatarBorderRadius}px;" />
						{:else if agentTyping && agentAvatarUrl}
							<img src={agentAvatarUrl} alt="Agent" class="shrink-0 object-contain rounded-full" style="width: {win.avatarSize}px; height: {win.avatarSize}px; border-radius: {win.avatarBorderRadius}px;" />
						{:else}
							<div class="shrink-0 rounded-full flex items-center justify-center" style="width: {win.avatarSize}px; height: {win.avatarSize}px; border-radius: {win.avatarBorderRadius}px; background-color: {botStyle.backgroundColor};">
								{#if agentTyping}
									<svg class="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
								{:else}
									<svg class="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1v1h-3v2h4v2h-6v-4H9v-1a5 5 0 01-5-5H4V4.73C3.4 4.39 3 3.74 3 3a2 2 0 012-2h7z"/></svg>
								{/if}
							</div>
						{/if}
					{/if}
					<div
						class="px-4 py-3 rounded-lg flex gap-1 items-center"
						style="background-color: {botStyle.backgroundColor}; color: {botStyle.textColor}; border-radius: {win.messageBorderRadius}px;"
					>
						<span class="typing-dot"></span>
						<span class="typing-dot"></span>
						<span class="typing-dot"></span>
					</div>
				</div>
			{/if}
		{/if}
	</div>

	{#if showStarterPrompts && win.starterPrompts.filter((p: string) => p.trim()).length > 0}
		<div
			class="shrink-0 px-3 pt-2 pb-1 flex flex-wrap gap-1.5 border-t"
			style="background-color: {win.backgroundColor}; border-color: {win.sectionBorderColor};"
		>
			{#each win.starterPrompts.filter((p: string) => p.trim()) as prompt}
				<button
					type="button"
					class="px-2 py-1 rounded-md border text-left transition-colors hover:opacity-90 text-xs"
					style="
						font-size: {Math.max(11, win.starterPromptFontSizePx - 3)}px;
						background-color: {win.starterPromptBackgroundColor};
						color: {win.starterPromptTextColor};
						border-color: {win.starterPromptBorderColor};
					"
					onclick={() => handleStarterPrompt(prompt)}
				>
					{prompt}
				</button>
			{/each}
		</div>
	{/if}

	<form
		class="shrink-0 p-3 border-t flex gap-2"
		style="background-color: {win.backgroundColor}; border-color: {win.sectionBorderColor};"
		onsubmit={handleSubmit}
	>
		<input
			type="text"
			class="chat-window-input flex-1 px-3 py-2 border rounded-lg outline-none focus:ring-2"
			style="
				background-color: {win.inputBackgroundColor};
				border-color: {win.inputBorderColor};
				color: {win.inputTextColor};
				--ph: {win.inputPlaceholderColor};
			"
			placeholder={win.inputPlaceholder}
			bind:value={inputText}
			disabled={loading}
		/>
		<button
			type="submit"
			class="shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-opacity disabled:opacity-50"
			style="background-color: {win.sendButtonBackgroundColor}; color: {win.sendButtonIconColor};"
			disabled={loading}
			title="Send"
		>
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0V11"/></svg>
		</button>
	</form>

	{#if win.footerText}
		<footer
			class="shrink-0 px-3 py-2 text-center text-xs border-t"
			style="background-color: {win.footerBackgroundColor}; color: {win.footerTextColor}; border-color: {win.sectionBorderColor};"
		>
			{win.footerText}
		</footer>
	{/if}
</div>

<style>
	.typing-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background-color: currentColor;
		opacity: 0.4;
		animation: typing-bounce 1.4s ease-in-out infinite both;
	}
	.typing-dot:nth-child(1) { animation-delay: 0s; }
	.typing-dot:nth-child(2) { animation-delay: 0.2s; }
	.typing-dot:nth-child(3) { animation-delay: 0.4s; }
	@keyframes typing-bounce {
		0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
		40% { transform: scale(1); opacity: 1; }
	}
	.chat-window .overflow-y-auto::-webkit-scrollbar {
		width: 6px;
	}
	.chat-window .overflow-y-auto::-webkit-scrollbar-thumb {
		background: #d1d5db;
		border-radius: 3px;
	}
	.chat-window .scrollbar-hide {
		scrollbar-width: none;
		-ms-overflow-style: none;
	}
	.chat-window .scrollbar-hide::-webkit-scrollbar {
		display: none;
	}
	.chat-window-input::placeholder {
		color: var(--ph, #9ca3af);
	}
	:global(.chat-message-link) {
		color: inherit;
		text-decoration: underline;
	}
	:global(.chat-message-link:hover) {
		opacity: 0.9;
	}
</style>
