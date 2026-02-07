<script lang="ts">
	import type { WidgetConfig } from '$lib/widget-config';
	import { formatMessage } from '$lib/chat-message-format';
	import { onMount, onDestroy } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import { getSessionId } from '$lib/widget-session';

	let { config, widgetId, onClose } = $props<{ config: WidgetConfig; widgetId?: string; onClose: () => void }>();

	// Reduced-motion support
	let prefersReducedMotion = $state(false);
	function dur(ms: number) { return prefersReducedMotion ? 0 : ms; }

	// Stable message identity counter (prevents re-animation on poll sync)
	let localIdCounter = 0;
	function nextLocalId() { return ++localIdCounter; }

	type CheckoutPreview = {
		lineItemsUI: Array<{
			imageUrl: string | null;
			title: string;
			variant: string | null;
			quantity: number;
			unitPrice: string;
			lineTotal: string;
		}>;
		summary: {
			totalItems: number;
			subtotal: string;
			total: string;
			currency: string;
			discountPercent?: number;
			discountAmount?: string;
		};
		checkoutUrl: string;
	};
	type Message = { id?: string; _localId: number; role: 'user' | 'bot'; content: string; avatarUrl?: string; checkoutPreview?: CheckoutPreview; createdAt?: string };
	function mapMessage(m: { id?: string; role: string; content: string; avatarUrl?: string; checkoutPreview?: CheckoutPreview; createdAt?: string }): Message {
		return {
			_localId: nextLocalId(),
			role: (m.role === 'user' ? 'user' : 'bot') as 'user' | 'bot',
			content: m.content,
			avatarUrl: m.avatarUrl,
			checkoutPreview: m.checkoutPreview
		};
	}
	function stripCheckoutBlock(content: string): string {
		const start = content.search(/\*\*[🧾\s]*Your [Cc]heckout [Pp]review\*\*/i);
		if (start < 0) return content;
		const before = content.slice(0, start).replace(/\n+$/, '');
		const afterStart = content.slice(start);
		const linkMatch = afterStart.match(/\[GO TO CHECKOUT\]\s*\([^)]+\)/i) ?? afterStart.match(/\[Buy now[^\]]*\]\s*\([^)]+\)/i);
		if (linkMatch) {
			const rest = afterStart.slice(linkMatch.index! + linkMatch[0].length).replace(/^\s*\n?/, '');
			return (before + (rest ? '\n\n' + rest : '')).trim();
		}
		return before.trim() || content;
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
	let inputEl: HTMLInputElement;
	let showScrollToBottom = $state(false);
	let sendPulse = $state(false);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	const win = $derived(config.window);
	const bubble = $derived(config.bubble);
	const botStyle = $derived(win.botMessageSettings);
	// Chat uses n8n only; no Vercel streaming or polling.
	// Update scroll-to-bottom FAB visibility when messages or content change
	$effect(() => {
		void messages.length;
		requestAnimationFrame(updateScrollToBottomVisibility);
	});

	// Streaming state
	let isStreaming = $state(false);
	let streamingMessageId = $state<number | null>(null);

	function addBotMessage(content: string, checkoutPreview?: CheckoutPreview) {
		const id = nextLocalId();
		messages = [...messages, { _localId: id, role: 'bot', content, checkoutPreview }];
		showStarterPrompts = false;
		requestAnimationFrame(() => scrollToBottom());
		return id;
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
			contentEl.scrollTo({ top: contentEl.scrollHeight, behavior: isStreaming ? 'auto' : 'smooth' });
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

	let lastMessageCount = $state(0);
	let pollingActive = $state(false);
	let isRefreshing = $state(false);

	async function fetchStoredMessages(forceRefresh = false) {
		if (!widgetId || !sessionId || sessionId === 'preview') {
			messagesLoading = false;
			isRefreshing = false;
			return;
		}
		try {
			const res = await fetch(`/api/widgets/${widgetId}/messages?session_id=${encodeURIComponent(sessionId)}`);
			const data = await res.json().catch(() => ({}));
			const list = Array.isArray(data.messages) ? data.messages : [];
			
			// On refresh or initial load, always load all messages from database
			if (forceRefresh || messages.length === 0) {
				if (list.length > 0) {
					messages = list.map(mapMessage);
					showStarterPrompts = false;
					requestAnimationFrame(() => scrollToBottom(true));
				} else {
					showStarterPrompts = true;
				}
			} else if (list.length > messages.length) {
				// New messages found - update and sync (merge to preserve any unsaved local messages)
				const mappedList = list.map(mapMessage);
				const existingIds = new Set(messages.filter((m: Message) => m.id).map((m: Message) => m.id!));
				const newMessages = mappedList.filter((m: Message) => m.id && !existingIds.has(m.id));
				if (newMessages.length > 0) {
					// Append only new messages
					messages = [...messages, ...newMessages];
					requestAnimationFrame(() => scrollToBottom(true));
				} else {
					// Full sync if structure changed (e.g. checkout previews updated)
					messages = mappedList;
					requestAnimationFrame(() => scrollToBottom(true));
				}
			} else if (list.length === messages.length && list.length > 0) {
				// Same count but content might have changed (e.g. checkout previews) - sync
				messages = list.map(mapMessage);
			}
			if (list.length > 0 || data.agentTyping || data.agentAvatarUrl) {
				agentTyping = !!data.agentTyping;
				agentAvatarUrl = data.agentAvatarUrl ?? null;
			}
			
			// Stop polling if no new messages and we've synced (messages count matches)
			if (pollingActive && list.length === lastMessageCount && list.length > 0) {
				// Messages are synced - stop polling until user sends a new message
				stopPolling();
			}
			lastMessageCount = list.length;
		} catch {
			// ignore
		} finally {
			messagesLoading = false;
		}
	}

	function startPolling() {
		// Poll for new messages from widget_conversation_messages (e.g. when n8n saves assistant messages)
		// This ensures messages saved by n8n workflows are displayed in real-time
		stopPolling();
		if (!widgetId || !sessionId || sessionId === 'preview') return;
		pollingActive = true;
		pollTimer = setInterval(() => {
			fetchStoredMessages();
		}, 3000); // Poll every 3 seconds
	}

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		pollingActive = false;
	}

	onMount(() => {
		// Reduced-motion preference
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		prefersReducedMotion = mq.matches;
		const onMotionChange = (e: MediaQueryListEvent) => { prefersReducedMotion = e.matches; };
		mq.addEventListener('change', onMotionChange);

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
			mq.removeEventListener('change', onMotionChange);
			stopPolling();
		});
	});

	async function sendMessage(text: string) {
		const trimmed = text.trim();
		if (!trimmed) return;
		messages = [...messages, { _localId: nextLocalId(), role: 'user', content: trimmed }];
		inputText = '';
		showStarterPrompts = false;
		sendPulse = true;
		setTimeout(() => { sendPulse = false; }, 200);
		requestAnimationFrame(() => scrollToBottom(true));

		// Restart polling when user sends a message (expecting n8n response)
		startPolling();
		lastMessageCount = messages.length;

		loading = true;
		let botReply = config.window.customErrorMessage;
		let n8nCheckoutPreview: CheckoutPreview | undefined;
		const useN8n = !!config.n8nWebhookUrl;
		if (useN8n) {
			let n8nStreamHandled = false;
			try {
				const effectiveSessionId = sessionId && sessionId !== 'preview' ? sessionId : 'preview';
				let conversationId: string | undefined;
				if (widgetId && effectiveSessionId !== 'preview') {
					try {
						const convRes = await fetch(
							`/api/widgets/${widgetId}/conversation?session_id=${encodeURIComponent(effectiveSessionId)}`
						);
						const convData = await convRes.json().catch(() => ({}));
						if (convData.conversationId) conversationId = convData.conversationId;
						
						// Automatically save user message to widget_conversation_messages
						if (widgetId && conversationId) {
							fetch(`/api/widgets/${widgetId}/messages/save`, {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({
									conversationId,
									role: 'user',
									content: trimmed
								})
							}).catch(() => {
								// Silently fail - don't block the chat flow
							});
						}
					} catch {
						// continue without conversationId
					}
				}
				// System prompt: when widget has an agent, use agent's (from Supabase); else build from widget bot config
				let systemPrompt: string | undefined;
				if (config.agentSystemPrompt?.trim()) {
					systemPrompt = config.agentSystemPrompt.trim();
				} else {
					const bot = config.bot ?? { role: '', tone: '', instructions: '' };
					const systemParts: string[] = [];
					if (bot.role?.trim()) systemParts.push(bot.role.trim());
					if (bot.tone?.trim()) systemParts.push(`Tone: ${bot.tone.trim()}`);
					if (bot.instructions?.trim()) systemParts.push(bot.instructions.trim());
					systemPrompt = systemParts.length > 0 ? systemParts.join('\n\n') : undefined;
				}
				const res = await fetch(config.n8nWebhookUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						message: trimmed,
						sessionId: effectiveSessionId,
						...(widgetId && { widgetId }),
						...(conversationId && { conversationId }),
						...(config.agentId && { agentId: config.agentId }),
						...(systemPrompt && { systemPrompt })
					})
				});
				const contentType = res.headers.get('content-type') ?? '';
				// n8n can return streaming (SSE or text) or JSON
				if (res.ok && res.body && !contentType.includes('application/json')) {
					// Consume n8n stream with smooth buffer for ChatGPT-like text appearance
					n8nStreamHandled = true;
					const msgId = addBotMessage('');
					const streamIndex = messages.length - 1;
					isStreaming = true;
					streamingMessageId = msgId;

					const reader = res.body.getReader();
					const decoder = new TextDecoder();
					let netBuffer = '';
					// Stream buffer: decouple network chunks from render for smooth appearance
					const charQueue: string[] = [];
					let streamDone = false;
					let drainRafId: number | null = null;
					let lastScrollTime = 0;

					function drainQueue() {
						if (charQueue.length === 0) {
							if (streamDone) {
								drainRafId = null;
								return;
							}
							drainRafId = requestAnimationFrame(drainQueue);
							return;
						}
						// Release 2-4 chars per frame for smooth appearance (~120-240 chars/sec at 60fps)
						const charsPerFrame = charQueue.length > 30 ? 4 : charQueue.length > 10 ? 3 : 2;
						const batch = charQueue.splice(0, charsPerFrame).join('');
						messages = messages.map((m, i) =>
							i === streamIndex ? { ...m, content: m.content + batch } : m
						);
						// Throttle scroll to every 50ms during streaming
						const now = Date.now();
						if (now - lastScrollTime > 50) {
							lastScrollTime = now;
							scrollToBottom();
						}
						drainRafId = requestAnimationFrame(drainQueue);
					}
					drainRafId = requestAnimationFrame(drainQueue);

					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						netBuffer += decoder.decode(value, { stream: true });
						// SSE: emit on newline and take "data: " lines
						const lines = netBuffer.split('\n');
						netBuffer = lines.pop() ?? '';
						for (const line of lines) {
							if (line.startsWith('data: ')) {
								const payload = line.slice(6).trim();
								if (payload === '[DONE]' || payload === '') continue;
								try {
									const parsed = JSON.parse(payload) as { text?: string; content?: string; delta?: string };
									const chunk = parsed.text ?? parsed.content ?? parsed.delta ?? '';
									if (chunk && typeof chunk === 'string') {
										for (const ch of chunk) charQueue.push(ch);
									}
								} catch {
									if (payload) {
										for (const ch of payload) charQueue.push(ch);
									}
								}
							}
						}
					}
					// Flush remaining net buffer
					if (netBuffer.trim()) {
						for (const ch of netBuffer) charQueue.push(ch);
					}
					// Wait for drain to finish
					streamDone = true;
					await new Promise<void>((resolve) => {
						function waitDrain() {
							if (charQueue.length === 0) { resolve(); return; }
							requestAnimationFrame(waitDrain);
						}
						waitDrain();
					});
					if (drainRafId) cancelAnimationFrame(drainRafId);
					isStreaming = false;
					streamingMessageId = null;
					scrollToBottom();
					// If stream yielded nothing, show error
					if (messages[streamIndex]?.content === '') {
						messages = messages.map((m, i) =>
							i === streamIndex ? { ...m, content: config.window.customErrorMessage } : m
						);
					}
				} else {
					// Handle JSON response from n8n
					const data = await res.json().catch(() => ({}));
					
					// Check for explicit error field first
					if (data.error && !res.ok) {
						botReply = config.window.customErrorMessage;
					} else {
						// Try to extract the actual response content
						// Handle nested message objects (e.g., from save endpoint responses)
						let rawReply: unknown = data.output ?? data.message ?? data.reply ?? data.text ?? data.content ?? '';
						
						// Check if the entire response is a save response object (has success and message fields)
						if (data && typeof data === 'object' && 'success' in data && 'message' in data && typeof (data as { message?: unknown }).message === 'object') {
							// This is a save response - extract content from message.content
							const msg = (data as { message?: { content?: string } }).message;
							if (msg && 'content' in msg && typeof msg.content === 'string') {
								rawReply = msg.content;
							}
						}
						
						// If rawReply is a JSON string, try to parse it
						if (typeof rawReply === 'string' && rawReply.trim().startsWith('{')) {
							try {
								const parsed = JSON.parse(rawReply);
								// If parsed is an object with content field, extract it
								if (parsed && typeof parsed === 'object' && 'content' in parsed && typeof parsed.content === 'string') {
									rawReply = parsed.content;
								} else if (parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'object' && 'content' in parsed.message) {
									// Handle nested message structure: { message: { content: "..." } }
									rawReply = parsed.message.content ?? '';
								} else {
									rawReply = parsed;
								}
							} catch {
								// Not valid JSON, keep as string
							}
						}
						
						// If message is an object with a content field, extract it
						if (rawReply && typeof rawReply === 'object') {
							if ('content' in rawReply && typeof (rawReply as { content?: unknown }).content === 'string') {
								// Direct content field
								rawReply = (rawReply as { content: string }).content;
							} else if ('message' in rawReply && typeof (rawReply as { message?: unknown }).message === 'object') {
								// Nested message object: { message: { content: "..." } }
								const msg = (rawReply as { message?: { content?: string } }).message;
								if (msg && 'content' in msg && typeof msg.content === 'string') {
									rawReply = msg.content;
								}
							}
						}
						
						// Final string conversion - if still an object, stringify it (but this shouldn't happen for valid responses)
						const replyStr = typeof rawReply === 'string' ? rawReply : (rawReply ? JSON.stringify(rawReply) : '');
						
						// Only show error if response is empty or explicitly an error
						if (!replyStr || replyStr.trim() === '') {
							botReply = config.window.customErrorMessage;
						} else if (
							replyStr.toLowerCase().includes('error in workflow') ||
							replyStr.toLowerCase().includes('workflow failed') ||
							(replyStr.toLowerCase().startsWith('error') && replyStr.length < 100) // Short error messages
						) {
							botReply = config.window.customErrorMessage;
						} else {
							// Valid response - show it
							botReply = replyStr;
						}
					}
					
					// If n8n returns checkoutPreview (from DIY checkout tool), show table + images + button
					const preview = data.checkoutPreview;
					if (
						preview &&
						typeof preview === 'object' &&
						Array.isArray(preview.lineItemsUI) &&
						preview.summary &&
						typeof preview.checkoutUrl === 'string'
					) {
						n8nCheckoutPreview = preview as CheckoutPreview;
					}
				}
			} catch (err) {
				// Network error or parsing error - show error message
				console.error('n8n webhook error:', err);
				botReply = config.window.customErrorMessage;
			}
			
			// Only add message if we have content (don't show empty error messages if we have real content)
			if (!n8nStreamHandled) {
				if (botReply && botReply !== config.window.customErrorMessage) {
					// Valid response - show it
					addBotMessage(botReply, n8nCheckoutPreview);
				} else if (botReply === config.window.customErrorMessage) {
					// Only show error if we don't have any content
					addBotMessage(botReply, n8nCheckoutPreview);
				}
			}
			
			// After n8n responds, refresh messages from database to sync with widget_conversation_messages
			// This ensures messages saved by n8n are displayed and checkout previews are synced
			// Wait a bit longer to allow n8n workflow to complete and save the message
			if (widgetId && sessionId && sessionId !== 'preview') {
				setTimeout(() => {
					fetchStoredMessages();
				}, 2000); // 2 second delay to allow n8n workflow to complete and save
			}
		} else {
			botReply = "Add your n8n webhook URL in the Connect tab to enable chat.";
			addBotMessage(botReply);
		}
		loading = false;
	}

	function handleSubmit(e: Event) {
		e.preventDefault();
		sendMessage(inputText);
	}

	function handleStarterPrompt(prompt: string) {
		sendMessage(prompt);
	}

	async function handleRefresh() {
		if (!widgetId || !sessionId || sessionId === 'preview' || messagesLoading) return;
		messagesLoading = true;
		isRefreshing = true;
		// Clear current messages and reload from database
		messages = [];
		showStarterPrompts = false;
		// Fetch fresh messages from widget_conversation_messages (force refresh)
		await fetchStoredMessages(true);
		// Restart polling to catch any new messages
		startPolling();
		isRefreshing = false;
		requestAnimationFrame(() => scrollToBottom(true));
	}

	const winRadius = $derived(win.borderRadiusStyle === 'rounded' ? '12px' : '0');
	const headerRadius = $derived(win.borderRadiusStyle === 'rounded' ? '12px 12px 0 0' : '0');

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
			<button type="button" class="p-1.5 rounded hover:opacity-80 transition-opacity disabled:opacity-50" style="color: {win.headerIconColor};" onclick={handleRefresh} disabled={messagesLoading} title="Refresh">
				{#if messagesLoading}
					<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
					</svg>
				{:else}
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
				{/if}
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
			<div class="flex gap-2 items-start" in:fly={{ x: -12, duration: dur(300), easing: cubicOut }}>
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
			{#each messages as msg, i (msg._localId)}
				{#if msg.role === 'bot'}
					<div class="flex gap-2 items-start" in:fly={{ x: -12, duration: dur(280), easing: cubicOut }}>
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
								{#if msg.checkoutPreview}
									{#if stripCheckoutBlock(msg.content).trim()}
										<div class="chat-message-intro">{@html formatMessage(stripCheckoutBlock(msg.content))}</div>
									{/if}
									<div class="checkout-preview-block">
										{#each msg.checkoutPreview.lineItemsUI as item}
											<div class="line-item">
												<div class="image-wrap">
													{#if item.imageUrl}
														<img src={item.imageUrl} alt={item.title} />
													{/if}
													<span class="qty-badge">{item.quantity}</span>
												</div>
												<div class="details">
													<div class="title">{item.title}</div>
													<div class="price-grid">
														<div class="label">Unit Price</div>
														<div class="label">Total</div>
														<div class="value">${item.unitPrice}</div>
														<div class="value">${item.lineTotal}</div>
													</div>
												</div>
											</div>
										{/each}
										<div class="checkout-summary">
											<div class="summary-row"><span class="summary-label">Items</span><span class="summary-value">{msg.checkoutPreview.summary.totalItems}</span></div>
											{#if msg.checkoutPreview.summary.discountPercent != null}
												<div class="summary-row"><span class="summary-label">Discount</span><span class="summary-value">{msg.checkoutPreview.summary.discountPercent}% OFF</span></div>
											{/if}
											<div class="summary-row"><span class="summary-label">Shipping</span><span class="summary-value">FREE</span></div>
											<div class="summary-divider"></div>
											<div class="summary-row"><span class="summary-label">Subtotal</span><span class="summary-value">${msg.checkoutPreview.summary.subtotal} {msg.checkoutPreview.summary.currency}</span></div>
											{#if msg.checkoutPreview.summary.discountAmount != null}
												<div class="summary-row"><span class="summary-label">Savings</span><span class="summary-value">-${msg.checkoutPreview.summary.discountAmount}</span></div>
											{/if}
											<div class="summary-row summary-total"><span class="summary-label">Total</span><span class="summary-value">${msg.checkoutPreview.summary.total} {msg.checkoutPreview.summary.currency}</span></div>
											<div class="summary-footer">GST included</div>
										</div>
										<a href={msg.checkoutPreview.checkoutUrl} target="_blank" rel="noopener noreferrer" class="chat-cta-button">GO TO CHECKOUT</a>
									</div>
								{:else}
									{@html formatMessage(msg.content)}{#if isStreaming && streamingMessageId === msg._localId}<span class="streaming-cursor">&#9612;</span>{/if}
								{/if}
							</div>
							{#if botStyle.showCopyToClipboardIcon && !(isStreaming && streamingMessageId === msg._localId)}
								<button type="button" class="shrink-0 opacity-70 hover:opacity-100 transition-opacity" onclick={() => navigator.clipboard.writeText(msg.content)} title="Copy">
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
								</button>
							{/if}
						</div>
					</div>
				{:else}
					<div class="flex justify-end min-w-0 max-w-full" in:fly={{ x: 12, duration: dur(280), easing: cubicOut }}>
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
			{#if (loading && !isStreaming) || agentTyping}
				<div class="flex gap-2 items-start" in:fly={{ y: 8, duration: dur(200), easing: cubicOut }} out:fade={{ duration: dur(150) }}>
					{#if (loading ? botStyle.showAvatar : true)}
						{#if botStyle.showAvatar && botStyle.avatarUrl}
							<img src={botStyle.avatarUrl} alt="" class="shrink-0 object-contain" style="width: {win.avatarSize}px; height: {win.avatarSize}px; border-radius: {win.avatarBorderRadius}px;" />
						{:else if agentTyping && agentAvatarUrl}
							<img src={agentAvatarUrl} alt="Agent" class="shrink-0 object-contain rounded-full" style="width: {win.avatarSize}px; height: {win.avatarSize}px; border-radius: {win.avatarBorderRadius}px;" />
						{:else}
							<div class="shrink-0 rounded-full flex items-center justify-center" style="width: {win.avatarSize}px; height: {win.avatarSize}px; border-radius: {win.avatarBorderRadius}px; background-color: {botStyle.backgroundColor};">
								<svg class="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
							</div>
						{/if}
					{/if}
					<div
						class="typing-bubble px-4 py-3 rounded-lg flex gap-1 items-center"
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
				in:fly={{ y: 8, duration: dur(200), easing: cubicOut }}
				out:fade={{ duration: dur(150) }}
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
			{#each win.starterPrompts.filter((p: string) => p.trim()) as prompt, idx}
				<button
					type="button"
					class="px-2 py-1 rounded-md border text-left transition-all hover:opacity-90 hover:scale-[1.02] text-xs"
					style="
						font-size: {Math.max(11, win.starterPromptFontSizePx - 3)}px;
						background-color: {win.starterPromptBackgroundColor};
						color: {win.starterPromptTextColor};
						border-color: {win.starterPromptBorderColor};
					"
					in:fly={{ y: 8, duration: dur(250), delay: dur(idx * 60), easing: cubicOut }}
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
			class="shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all disabled:opacity-50 send-button"
			class:send-pulse={sendPulse}
			style="background-color: {win.sendButtonBackgroundColor}; color: {win.sendButtonIconColor};"
			disabled={loading}
			title="Send"
		>
			<svg class="w-5 h-5 transition-transform" class:rotate-12={loading} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0V11"/></svg>
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

	/* Typing indicator */
	.typing-bubble {
		animation: typing-pulse 2s ease-in-out infinite;
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
	@keyframes typing-pulse {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.02); }
	}

	/* Streaming cursor */
	:global(.streaming-cursor) {
		display: inline;
		animation: cursor-blink 530ms steps(1) infinite;
		font-weight: 100;
		margin-left: 1px;
	}
	@keyframes cursor-blink {
		0%, 100% { opacity: 1; }
		50% { opacity: 0; }
	}

	/* Send button pulse */
	.send-button {
		transition: transform 0.15s ease-out, opacity 0.15s;
	}
	.send-button.send-pulse {
		transform: scale(0.88);
	}
	.send-button:active {
		transform: scale(0.92);
	}
	.rotate-12 {
		transform: rotate(12deg);
	}

	/* Reduced-motion support */
	@media (prefers-reduced-motion: reduce) {
		.typing-dot,
		.typing-bubble,
		:global(.streaming-cursor) {
			animation-duration: 0.01ms !important;
			animation-iteration-count: 1 !important;
		}
		.send-button {
			transition-duration: 0.01ms !important;
		}
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
	:global(.chat-summary-table) {
		border-collapse: collapse;
		width: 100%;
		margin-top: 0.25rem;
		font-size: 0.95em;
	}
	:global(.chat-summary-table .chat-summary-head) {
		display: none;
	}
	:global(.chat-summary-table td) {
		border: none;
		padding: 0.25em 0;
	}
	:global(.chat-summary-table tr + tr td) {
		border-top: 1px solid rgba(255, 255, 255, 0.16);
	}
	:global(.chat-summary-table td:first-child) {
		font-weight: 600;
		padding-right: 1.5em;
		white-space: nowrap;
	}
	:global(.chat-summary-table td:nth-child(2)) {
		color: rgba(255, 255, 255, 0.85);
	}
	:global(.chat-summary-table td:last-child) {
		text-align: right;
		font-weight: 600;
		white-space: nowrap;
	}
	:global(.chat-checkout-table) {
		border: none;
		border-collapse: collapse;
		width: 100%;
	}
	:global(.chat-checkout-table thead th) {
		border: none;
		background: transparent;
		font-weight: 500;
		font-size: 0.9em;
		opacity: 0.8;
		padding-bottom: 0.5em;
	}
	:global(.chat-checkout-table th:first-child),
	:global(.chat-checkout-table td:first-child) {
		width: 1%;
		white-space: nowrap;
		vertical-align: top;
		padding-right: 1em;
	}
	:global(.chat-checkout-table td) {
		border: none;
		border-bottom: 1px solid rgba(255, 255, 255, 0.12);
		background: transparent;
		padding: 0.75em 0;
		vertical-align: top;
	}
	:global(.chat-checkout-table thead th:last-child),
	:global(.chat-checkout-table td:last-child) {
		display: none;
	}
	:global(.checkout-img-wrap) {
		position: relative;
		display: inline-block;
		width: 64px;
		height: 64px;
		flex-shrink: 0;
		overflow: hidden;
		border-radius: 6px;
	}
	:global(.chat-checkout-table .chat-table-cell-image) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center;
		display: block;
		border-radius: 6px;
	}
	:global(.qty-badge) {
		position: absolute;
		top: 2px;
		right: 2px;
		background: rgba(0, 0, 0, 0.75);
		color: #fff;
		padding: 2px 6px;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.2;
	}
	:global(.checkout-product-cell) {
		display: block;
		font-size: 0.95em;
	}
	:global(.checkout-price-grid) {
		display: flex;
		gap: 1.5em;
		margin-top: 0.5em;
	}
	:global(.checkout-price-block) {
		display: flex;
		flex-direction: column;
		font-size: 0.85em;
	}
	:global(.checkout-price-label) {
		opacity: 0.85;
	}
	:global(.checkout-price-value) {
		margin-top: 0.1em;
		font-weight: 600;
	}
	:global(.checkout-variant-line) {
		display: block;
		margin-top: 0.2em;
		font-size: 0.85em;
		opacity: 0.85;
		font-weight: 400;
	}
	:global(.checkout-qty-price-line) {
		display: block;
		margin-top: 0.2em;
		font-size: 0.85em;
		opacity: 0.9;
		font-weight: 400;
	}
	:global(.chat-table-cell-image) {
		display: block;
	}

	/* Data-driven checkout preview (line items + summary + button) */
	:global(.checkout-preview-block) {
		margin-top: 0.75em;
	}
	:global(.checkout-preview-block .line-item) {
		display: flex;
		gap: 16px;
		align-items: flex-start;
		margin-bottom: 1em;
	}
	:global(.checkout-preview-block .line-item:last-of-type) {
		margin-bottom: 0.5em;
	}
	:global(.checkout-preview-block .image-wrap) {
		position: relative;
		width: 72px;
		height: 72px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.1);
		overflow: hidden;
		flex-shrink: 0;
	}
	:global(.checkout-preview-block .image-wrap img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	:global(.checkout-preview-block .line-item .qty-badge) {
		position: absolute;
		top: -6px;
		right: -6px;
		background: #1f2937;
		color: #fff;
		font-size: 12px;
		font-weight: 600;
		padding: 4px 8px;
		border-radius: 999px;
	}
	:global(.checkout-preview-block .details) {
		flex: 1;
		min-width: 0;
	}
	:global(.checkout-preview-block .details .title) {
		font-weight: 600;
		font-size: 16px;
		margin-bottom: 8px;
	}
	:global(.checkout-preview-block .price-grid) {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px 24px;
	}
	:global(.checkout-preview-block .price-grid .label) {
		font-size: 12px;
		opacity: 0.85;
	}
	:global(.checkout-preview-block .price-grid .value) {
		font-size: 16px;
		font-weight: 600;
	}
	:global(.checkout-summary) {
		margin-top: 1em;
		padding-top: 0.75em;
		border-top: 1px solid rgba(255, 255, 255, 0.2);
	}
	:global(.checkout-summary .summary-row) {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.2em 0;
	}
	:global(.checkout-summary .summary-label) {
		font-weight: 600;
	}
	:global(.checkout-summary .summary-value) {
		font-weight: 600;
	}
	:global(.checkout-summary .summary-total) {
		margin-top: 0.25em;
		font-size: 1.05em;
	}
	:global(.checkout-summary .summary-divider) {
		height: 1px;
		background: rgba(255, 255, 255, 0.15);
		margin: 0.5em 0;
	}
	:global(.checkout-summary .summary-footer) {
		font-size: 0.85em;
		opacity: 0.8;
		margin-top: 0.5em;
	}
	:global(.checkout-preview-block .chat-cta-button) {
		display: inline-block;
		margin-top: 1em;
		text-decoration: none;
		padding: 0.6em 1.2em;
		border-radius: 8px;
		font-weight: 600;
		background: rgba(255, 255, 255, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.4);
		transition: background 0.15s, border-color 0.15s;
		color: inherit;
	}
	:global(.checkout-preview-block .chat-cta-button:hover) {
		background: rgba(255, 255, 255, 0.35);
		border-color: rgba(255, 255, 255, 0.6);
	}
	:global(.chat-message-intro) {
		margin-bottom: 0.5em;
	}
</style>
