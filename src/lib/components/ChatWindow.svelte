<script lang="ts">
	import type { WidgetConfig } from '$lib/widget-config';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { getSessionId } from '$lib/widget-session';
	import { readUIMessageStream } from 'ai';

	let { config, widgetId, onClose } = $props<{ config: WidgetConfig; widgetId?: string; onClose: () => void }>();

	type Message = { role: 'user' | 'bot'; content: string; avatarUrl?: string };

	let sessionId = $state('');
	let inputText = $state('');
	let messages = $state<Message[]>([]);
	let showStarterPrompts = $state(true);
	let loading = $state(false);
	let messagesLoading = $state(false);
	let agentTyping = $state(false);
	let agentAvatarUrl = $state<string | null>(null);
	let contentEl: HTMLDivElement;
	let inputEl: HTMLInputElement;
	let showScrollToBottom = $state(false);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	const win = $derived(config.window);
	const bubble = $derived(config.bubble);
	const botStyle = $derived(win.botMessageSettings);
	const useDirect = $derived(config.chatBackend === 'direct' && !!config.llmProvider && !!widgetId);

	// Update scroll-to-bottom FAB visibility when messages or content change
	$effect(() => {
		void messages.length;
		requestAnimationFrame(updateScrollToBottomVisibility);
	});

	function addBotMessage(content: string) {
		messages = [...messages, { role: 'bot', content }];
		showStarterPrompts = false;
		requestAnimationFrame(() => scrollToBottom());
	}

	const SCROLL_NEAR_BOTTOM_PX = 120;

	function isNearBottom(): boolean {
		if (!contentEl) return false;
		const { scrollTop, clientHeight, scrollHeight } = contentEl;
		return scrollTop + clientHeight >= scrollHeight - SCROLL_NEAR_BOTTOM_PX;
	}

	/** Scroll to bottom. Pass true to force (e.g. after user sends); otherwise only scroll if user was already near bottom. */
	function scrollToBottom(force = false) {
		if (!contentEl) return;
		if (force || isNearBottom()) {
			contentEl.scrollTop = contentEl.scrollHeight;
			showScrollToBottom = false;
		}
	}

	function updateScrollToBottomVisibility() {
		if (!contentEl) return;
		const { scrollTop, clientHeight, scrollHeight } = contentEl;
		const nearBottom = scrollTop + clientHeight >= scrollHeight - SCROLL_NEAR_BOTTOM_PX;
		const canScroll = scrollHeight > clientHeight;
		showScrollToBottom = canScroll && !nearBottom;
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
				requestAnimationFrame(() => scrollToBottom(true));
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
					// Do not auto-scroll on poll sync — respect user scroll position (e.g. reading history)
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
		sessionId = getSessionId(widgetId, browser);
		const willFetch = !!(widgetId && sessionId && sessionId !== 'preview');
		if (willFetch) messagesLoading = true;
		fetchStoredMessages();
		startPolling();
		if (!willFetch) messagesLoading = false;
		// Focus input when chat opens (industry standard: ready to type)
		requestAnimationFrame(() => inputEl?.focus());
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
				e.preventDefault();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		onDestroy(() => {
			window.removeEventListener('keydown', onKeyDown);
			stopPolling();
		});
	});

	async function sendMessage(text: string) {
		const trimmed = text.trim();
		if (!trimmed) return;
		messages = [...messages, { role: 'user', content: trimmed }];
		inputText = '';
		showStarterPrompts = false;
		requestAnimationFrame(() => scrollToBottom(true));

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
						// Server returned error (e.g. 504 Gateway Timeout). Poll first—quote generation can take
						// 10–15s; a proxy may time out while the server completes successfully in the background.
						const refetchMessages = async (): Promise<Message[]> => {
							const refetch = await fetch(`/api/widgets/${widgetId}/messages?session_id=${encodeURIComponent(sessionId)}`);
							const refetchData = await refetch.json().catch(() => ({}));
							const list = Array.isArray(refetchData.messages) ? refetchData.messages : [];
							return list.map((m: { role: string; content: string; avatarUrl?: string }) => ({
								role: m.role as 'user' | 'bot',
								content: m.content,
								avatarUrl: m.avatarUrl
							}));
						};
						const pollIntervalMs = 1500;
						const totalWaitMs = 20000;
						const maxAttempts = Math.ceil(totalWaitMs / pollIntervalMs);
						for (let attempt = 0; attempt < maxAttempts; attempt++) {
							await new Promise((r) => setTimeout(r, pollIntervalMs));
							try {
								const serverMessages = await refetchMessages();
								if (serverMessages.length > messages.length || (serverMessages.length > 0 && serverMessages[serverMessages.length - 1].role === 'bot')) {
									messages = serverMessages;
									requestAnimationFrame(() => scrollToBottom());
									loading = false;
									return;
								}
							} catch {
								// ignore refetch errors
							}
						}
						botReply = (data.error as string) ?? config.window.customErrorMessage;
					} else if (data.liveAgentActive) {
						loading = false;
						return;
					} else {
						const outputOrMessage = data.output ?? data.message;
						if (typeof outputOrMessage === 'string' && outputOrMessage.trim()) {
							botReply = outputOrMessage;
						}
						// If res.ok but no output/message, server may have returned stream as JSON or response not ready.
						// Poll for the persisted message instead of showing error—avoids flashing error then real reply.
						if (typeof botReply !== 'string' || botReply === config.window.customErrorMessage) {
							const refetchMessages = async (): Promise<Message[]> => {
								const refetch = await fetch(`/api/widgets/${widgetId}/messages?session_id=${encodeURIComponent(sessionId)}`);
								const refetchData = await refetch.json().catch(() => ({}));
								const list = Array.isArray(refetchData.messages) ? refetchData.messages : [];
								return list.map((m: { role: string; content: string; avatarUrl?: string }) => ({
									role: m.role as 'user' | 'bot',
									content: m.content,
									avatarUrl: m.avatarUrl
								}));
							};
							const pollIntervalMs = 1500;
							const totalWaitMs = 20000;
							const maxAttempts = Math.ceil(totalWaitMs / pollIntervalMs);
							for (let attempt = 0; attempt < maxAttempts; attempt++) {
								await new Promise((r) => setTimeout(r, pollIntervalMs));
								try {
									const serverMessages = await refetchMessages();
									if (serverMessages.length > messages.length || (serverMessages.length > 0 && serverMessages[serverMessages.length - 1].role === 'bot')) {
										messages = serverMessages;
										requestAnimationFrame(() => scrollToBottom());
										loading = false;
										return;
									}
								} catch {
									// ignore refetch errors
								}
							}
							botReply = config.window.customErrorMessage;
						}
					}
					if (typeof botReply !== 'string') botReply = JSON.stringify(botReply);
				} else if (res.ok && res.body) {
					// AI SDK stream: consume and update UI as tokens arrive. If stream parsing fails (e.g. format change),
					// poll for the persisted message instead of showing error—server may have completed successfully.
					let streamMessageIndex = -1;
					let streamParseFailed = false;
					try {
						for await (const uiMessage of readUIMessageStream({
							stream: res.body as unknown as ReadableStream<import('ai').UIMessageChunk>
						})) {
							const fromParts = (uiMessage.parts ?? [])
								.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
								.map((p) => p.text)
								.join('');
							const msgContent = (uiMessage as unknown as { content?: string }).content;
							const content = typeof msgContent === 'string' ? msgContent : fromParts ?? '';
							if (streamMessageIndex === -1) {
								addBotMessage(content);
								streamMessageIndex = messages.length - 1;
							} else {
								messages = messages.map((m, i) =>
									i === streamMessageIndex ? { ...m, content } : m
								);
							}
							requestAnimationFrame(() => scrollToBottom());
						}
					} catch {
						streamParseFailed = true;
					} finally {
						loading = false;
					}
					// If stream yielded nothing or parsing failed, poll for the persisted reply.
					// Server sets agentTyping while AI is generating; poll until we have the message or server says not typing.
					if (streamMessageIndex === -1 || streamParseFailed) {
						const refetch = async (): Promise<{ messages: Message[]; agentTyping: boolean }> => {
							const res = await fetch(`/api/widgets/${widgetId}/messages?session_id=${encodeURIComponent(sessionId)}`);
							const data = await res.json().catch(() => ({}));
							const list = Array.isArray(data.messages) ? data.messages : [];
							const serverMessages = list.map((m: { role: string; content: string; avatarUrl?: string }) => ({
								role: m.role as 'user' | 'bot',
								content: m.content,
								avatarUrl: m.avatarUrl
							}));
							return { messages: serverMessages, agentTyping: !!data.agentTyping };
						};
						const pollIntervalMs = 800;
						const maxTotalMs = 5 * 60 * 1000;
						const pollsAfterTypingStopped = 3;
						let typingStoppedCount = 0;
						const deadline = Date.now() + maxTotalMs;
						while (Date.now() < deadline) {
							await new Promise((r) => setTimeout(r, pollIntervalMs));
							try {
								const { messages: serverMessages, agentTyping: serverTyping } = await refetch();
								agentTyping = serverTyping;
								if (serverMessages.length > messages.length || (serverMessages.length > 0 && serverMessages[serverMessages.length - 1].role === 'bot')) {
									messages = serverMessages;
									requestAnimationFrame(() => scrollToBottom());
									return;
								}
								if (!serverTyping) {
									typingStoppedCount++;
									if (typingStoppedCount >= pollsAfterTypingStopped) break;
						} else {
							typingStoppedCount = 0;
						}
					} catch {
						// ignore
					}
				}
				agentTyping = false;
				loading = false;
				addBotMessage(config.window.customErrorMessage);
			}
			return;
				} else {
					botReply = config.window.customErrorMessage;
				}
				} catch {
				// Fetch failed: poll for message in case server succeeded (e.g. timeout after response sent)
				loading = false;
				const refetch = async (): Promise<{ messages: Message[]; agentTyping: boolean }> => {
					const res = await fetch(`/api/widgets/${widgetId}/messages?session_id=${encodeURIComponent(sessionId)}`);
					const data = await res.json().catch(() => ({}));
					const list = Array.isArray(data.messages) ? data.messages : [];
					const serverMessages = list.map((m: { role: string; content: string; avatarUrl?: string }) => ({
						role: m.role as 'user' | 'bot',
						content: m.content,
						avatarUrl: m.avatarUrl
					}));
					return { messages: serverMessages, agentTyping: !!data.agentTyping };
				};
				const pollIntervalMs = 800;
				const maxTotalMs = 5 * 60 * 1000;
				const pollsAfterTypingStopped = 3;
				let typingStoppedCount = 0;
				const deadline = Date.now() + maxTotalMs;
				while (Date.now() < deadline) {
					await new Promise((r) => setTimeout(r, pollIntervalMs));
					try {
						const { messages: serverMessages, agentTyping: serverTyping } = await refetch();
						agentTyping = serverTyping;
						if (serverMessages.length > messages.length || (serverMessages.length > 0 && serverMessages[serverMessages.length - 1].role === 'bot')) {
							messages = serverMessages;
							requestAnimationFrame(() => scrollToBottom());
							return;
						}
						if (!serverTyping) {
							typingStoppedCount++;
							if (typingStoppedCount >= pollsAfterTypingStopped) break;
						} else {
							typingStoppedCount = 0;
						}
					} catch {
						// ignore
					}
				}
				agentTyping = false;
				loading = false;
				addBotMessage(config.window.customErrorMessage);
				return;
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

	/** Split message into table blocks and text blocks. Tables are consecutive lines that look like markdown table rows (| ... |). */
	function splitTablesAndText(message: string): Array<{ type: 'table' | 'text'; content: string }> {
		if (!message || typeof message !== 'string') return [];
		const lines = message.split('\n');
		const parts: Array<{ type: 'table' | 'text'; content: string }> = [];
		let i = 0;
		const isTableRow = (line: string) => /^\|.+\|[\s]*$/.test(line.trim());
		const isSeparatorRow = (line: string) => /^\|[\s\-:]+\|[\s]*$/.test(line.trim());
		while (i < lines.length) {
			if (isTableRow(lines[i])) {
				const tableLines: string[] = [];
				while (i < lines.length && isTableRow(lines[i])) {
					tableLines.push(lines[i]);
					i++;
				}
				if (tableLines.length >= 2) {
					parts.push({ type: 'table', content: tableLines.join('\n') });
					continue;
				}
				parts.push({ type: 'text', content: tableLines.join('\n') });
				continue;
			}
			const textLines: string[] = [];
			while (i < lines.length && !isTableRow(lines[i])) {
				textLines.push(lines[i]);
				i++;
			}
			if (textLines.length) parts.push({ type: 'text', content: textLines.join('\n') });
		}
		return parts;
	}

	/** Convert a markdown table string to HTML. Escapes cell content. */
	function markdownTableToHtml(tableContent: string): string {
		const escape = (s: string) =>
			String(s)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;');
		const lines = tableContent.split('\n').filter((l) => l.trim());
		if (lines.length < 2) return escape(tableContent);
		const parseRow = (line: string) =>
			line
				.split('|')
				.map((c) => c.trim())
				.filter((_, i, arr) => i > 0 && i < arr.length - 1);
		const headerCells = parseRow(lines[0]);
		const isSep = (line: string) => {
			const cells = parseRow(line);
			return cells.length > 0 && cells.every((c) => /^[\s\-:]+$/.test(c));
		};
		const bodyStart = lines.length > 1 && isSep(lines[1]) ? 2 : 1;
		let html = '<table class="chat-message-table"><thead><tr>';
		for (const c of headerCells) html += `<th>${escape(c)}</th>`;
		html += '</tr></thead><tbody>';
		for (let r = bodyStart; r < lines.length; r++) {
			const cells = parseRow(lines[r]);
			if (cells.length === 0) continue;
			html += '<tr>';
			for (const c of cells) html += `<td>${escape(c)}</td>`;
			html += '</tr>';
		}
		html += '</tbody></table>';
		return html;
	}

	/** Convert markdown links [text](url), image syntax ![alt](url) and raw URLs to clickable links/media. Escapes plain text for safety. */
	/** Supports [text](url) even when the LLM puts a newline between ] and (, so only the link text is shown. */
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
		// Images: ![alt](url) with optional whitespace between ] and (; optional closing ) so truncated links still embed
		const imageRe = /!\[([^\]]*)\]\s*\((https?:\/\/[^)\s]+)\)?/g;
		// Markdown link: [text](url) with optional whitespace between ] and (; optional closing ) so truncated links still embed
		const markdownLinkRe = /\[([^\]]*)\]\s*\((https?:\/\/[^)\s]+)\)?/g;
		const rawUrlRe = /(https?:\/\/[^\s<>"']+)/g;
		// Collect all matches (markdown first, then raw URLs) and sort by index to output in order
		type LinkMatch =
			| { index: number; end: number; type: 'markdown'; text: string; url: string }
			| { index: number; end: number; type: 'image'; alt: string; url: string }
			| { index: number; end: number; type: 'raw'; url: string };
		const matches: LinkMatch[] = [];
		let m: RegExpExecArray | null;
		imageRe.lastIndex = 0;
		while ((m = imageRe.exec(text)) !== null) {
			matches.push({
				index: m.index,
				end: imageRe.lastIndex,
				type: 'image',
				alt: m[1] || '',
				url: m[2]
			});
		}
		markdownLinkRe.lastIndex = 0;
		while ((m = markdownLinkRe.exec(text)) !== null) {
			matches.push({
				index: m.index,
				end: markdownLinkRe.lastIndex,
				type: 'markdown',
				text: m[1] || m[2],
				url: m[2]
			});
		}
		rawUrlRe.lastIndex = 0;
		while ((m = rawUrlRe.exec(text)) !== null) {
			// Skip if this URL is inside an image or markdown link we already captured
			const insideMarkdown = matches.some(
				(match) =>
					(match.type === 'markdown' || match.type === 'image') &&
					m!.index >= match.index &&
					m!.index < match.end
			);
			if (!insideMarkdown) {
				matches.push({ index: m.index, end: rawUrlRe.lastIndex, type: 'raw', url: m[1] });
			}
		}
		matches.sort((a, b) => a.index - b.index);
		for (const match of matches) {
			parts.push(escape(text.slice(lastIndex, match.index)));
			const url = match.url;
			if (match.type === 'image') {
				const alt = match.alt;
				parts.push(
					`<img src="${escape(url)}" alt="${escape(alt)}" class="chat-message-image max-w-full h-auto rounded-md" />`
				);
			} else {
				const displayText = match.type === 'markdown' ? match.text : url;
				const isCtaButton = /buy\s*now|complete\s*your\s*purchase/i.test(displayText);
				const linkClass = isCtaButton ? 'chat-message-link chat-cta-button' : 'chat-message-link underline';
				parts.push(
					`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer" class="${linkClass}">${escape(displayText)}</a>`
				);
			}
			lastIndex = match.end;
		}
		parts.push(escape(text.slice(lastIndex)));
		// Preserve line breaks so lists and paragraphs render nicely
		const joined = parts.join('');
		return joined.replace(/\n/g, '<br />');
	}

	/** Format full message: tables as HTML tables (wrapped in scrollable div), rest as links/images/line breaks. */
	function formatMessage(content: string): string {
		const parts = splitTablesAndText(content);
		return parts
			.map((p) =>
				p.type === 'table'
					? `<div class="chat-table-wrapper">${markdownTableToHtml(p.content)}</div>`
					: formatMessageWithLinks(p.content)
			)
			.join('');
	}
</script>

<div
	class="chat-window flex flex-col overflow-hidden shadow-2xl chat-window--desktop-size"
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
		class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3 {win.showScrollbar ? '' : 'scrollbar-hide'} chat-messages-scroll relative"
		role="log"
		aria-live="polite"
		onscroll={updateScrollToBottomVisibility}
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
							class="px-3 py-2 max-w-[85%] min-w-0 rounded-lg flex items-start gap-2 overflow-hidden"
							style="
								background-color: {botStyle.backgroundColor};
								color: {botStyle.textColor};
								border-radius: {win.messageBorderRadius}px;
							"
						>
							<div class="flex-1 min-w-0 overflow-x-auto overflow-y-visible max-w-full break-words">
								{@html formatMessage(msg.content)}
							</div>
							{#if botStyle.showCopyToClipboardIcon}
								<button type="button" class="shrink-0 opacity-70 hover:opacity-100" onclick={() => navigator.clipboard.writeText(msg.content)} title="Copy">
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
								</button>
							{/if}
						</div>
					</div>
				{:else}
					<div class="flex justify-end min-w-0 max-w-full">
				<div
					class="px-3 py-2 max-w-[85%] min-w-0 rounded-lg break-words"
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
		{#if showScrollToBottom}
			<button
				type="button"
				class="chat-scroll-to-bottom"
				onclick={() => scrollToBottom(true)}
				title="Scroll to bottom"
				aria-label="Scroll to latest messages"
			>
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>
			</button>
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
			bind:this={inputEl}
			type="text"
			autocomplete="off"
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
			aria-label="Message input"
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
	/* Mobile: full viewport, safe areas (industry standard for chat widgets) */
	@media (max-width: 768px) {
		.chat-window.chat-window--desktop-size {
			width: 100% !important;
			min-width: 0;
			max-width: 100vw;
			height: 100% !important;
			min-height: 100dvh;
			border-radius: 0;
			box-shadow: none;
			padding-left: env(safe-area-inset-left);
			padding-right: env(safe-area-inset-right);
			padding-top: env(safe-area-inset-top);
			padding-bottom: env(safe-area-inset-bottom);
			box-sizing: border-box;
		}
		.chat-window.chat-window--desktop-size header {
			border-radius: 0;
		}
		.chat-window.chat-window--desktop-size form {
			padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));
		}
	}

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
	/* Prevent browser from auto-scrolling when content updates (e.g. poll sync) */
	.chat-window .chat-messages-scroll {
		overflow-anchor: none;
	}
	.chat-window-input::placeholder {
		color: var(--ph, #9ca3af);
	}
	.chat-scroll-to-bottom {
		position: absolute;
		bottom: 0.75rem;
		right: 0.75rem;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.15);
		color: inherit;
		border: none;
		cursor: pointer;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
		transition: opacity 0.2s, background 0.2s;
	}
	.chat-scroll-to-bottom:hover {
		background: rgba(0, 0, 0, 0.25);
		opacity: 1;
	}
	:global(.chat-message-link) {
		color: inherit;
		text-decoration: underline;
		word-break: normal;
		overflow-wrap: break-word;
	}
	:global(.chat-message-link:hover) {
		opacity: 0.9;
	}
	:global(.chat-cta-button) {
		display: inline-block;
		text-decoration: none;
		padding: 0.5em 1em;
		margin-top: 0.5em;
		border-radius: 8px;
		font-weight: 600;
		background-color: rgba(255, 255, 255, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.4);
		transition: background-color 0.15s, border-color 0.15s;
	}
	:global(.chat-cta-button:hover) {
		background-color: rgba(255, 255, 255, 0.35);
		border-color: rgba(255, 255, 255, 0.6);
	}
	:global(.chat-table-wrapper) {
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		margin: 0.5em 0;
		max-width: 100%;
	}
	:global(.chat-table-wrapper .chat-message-table) {
		width: max-content;
		min-width: 100%;
	}
	:global(.chat-message-table) {
		border-collapse: collapse;
		font-size: 0.95em;
	}
	:global(.chat-message-table th),
	:global(.chat-message-table td) {
		border: 1px solid currentColor;
		opacity: 0.9;
		padding: 0.4em 0.6em;
		text-align: left;
	}
	:global(.chat-message-table th) {
		font-weight: 600;
		opacity: 1;
	}
</style>
