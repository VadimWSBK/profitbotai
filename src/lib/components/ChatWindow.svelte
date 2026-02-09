<script lang="ts">
	import type { WidgetConfig } from '$lib/widget-config';
	import { formatMessage } from '$lib/chat-message-format';
	import { onMount, onDestroy } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import { getSessionId } from '$lib/widget-session';
	import { sendToParent, type ShopifyContext } from '$lib/widget-postmessage';

	let { config, widgetId, shopifyContext, onClose } = $props<{ config: WidgetConfig; widgetId?: string; shopifyContext?: ShopifyContext | null; onClose: () => void }>();

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
			id: m.id,
			_localId: nextLocalId(),
			role: (m.role === 'user' ? 'user' : 'bot') as 'user' | 'bot',
			content: m.content,
			avatarUrl: m.avatarUrl,
			checkoutPreview: m.checkoutPreview,
			createdAt: m.createdAt
		};
	}
	function stripCheckoutBlock(content: string, checkoutUrl?: string): string {
		if (!content) return content;
		
		// Remove the checkout URL if provided (to avoid showing it as a raw link)
		let cleaned = content;
		if (checkoutUrl) {
			// Escape special regex characters in the URL
			const escapedUrl = checkoutUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const urlPattern = new RegExp(escapedUrl, 'gi');
			cleaned = cleaned.replace(urlPattern, '').trim();
		}
		
		let start = cleaned.search(/\*\*[^*]*Your [Cc]heckout [Pp]review\*\*/i);
		if (start < 0) start = cleaned.search(/\n\s*Your\s+[Cc]heckout\s+[Pp]review/i);
		if (start < 0) {
			// Also check for raw checkout URLs (Shopify cart URLs or invoice URLs)
			const checkoutUrlPattern = /(https?:\/\/[^\s<>"']*(?:cart|checkout|invoice|myshopify\.com\/cart)[^\s<>"']*)/gi;
			cleaned = cleaned.replace(checkoutUrlPattern, '').trim();
			return cleaned;
		}
		let before = cleaned.slice(0, start).replace(/\n+$/, '').trim();
		before = before.replace(/\n\s*Here is your (?:DIY )?checkout preview:?\s*$/i, '').trim();
		before = before.replace(/\n\s*Your total (?:estimated|calculated) cost for the product would be \$[\d,]+\.?\d*\s*AUD\.?\s*$/i, '').trim();
		const afterStart = cleaned.slice(start);
		// Match markdown links like [GO TO CHECKOUT](url) or [Buy now](url)
		const linkMatch = afterStart.match(/\[GO TO CHECKOUT\]\s*\([^)]+\)/i) ?? afterStart.match(/\[Buy now[^\]]*\]\s*\([^)]+\)/i);
		if (linkMatch) {
			const rest = afterStart.slice(linkMatch.index! + linkMatch[0].length).replace(/^\s*\n?/, '');
			// Also remove any raw URLs that might be in the rest
			const checkoutUrlPattern = /(https?:\/\/[^\s<>"']*(?:cart|checkout|invoice|myshopify\.com\/cart)[^\s<>"']*)/gi;
			const cleanedRest = rest.replace(checkoutUrlPattern, '').trim();
			return (before + (cleanedRest ? '\n\n' + cleanedRest : '')).trim();
		}
		// Remove any raw checkout URLs from the before part too
		const checkoutUrlPattern = /(https?:\/\/[^\s<>"']*(?:cart|checkout|invoice|myshopify\.com\/cart)[^\s<>"']*)/gi;
		return before.replace(checkoutUrlPattern, '').trim() || cleaned;
	}

	/** Parse DIY checkout block from plain text when API did not attach checkoutPreview (embed fallback). */
	function tryParseCheckoutFromText(content: string): CheckoutPreview | null {
		if (!content?.trim()) return null;
		const hasBlock = /Your\s+Checkout\s+Preview/i.test(content) && (/\bItems\s+\d+/i.test(content) || /Subtotal\s+\$/i.test(content) || /TOTAL\s+\$/i.test(content));
		if (!hasBlock) return null;
		const lineItemsUI: CheckoutPreview['lineItemsUI'] = [];
		const lineItemRe = /\*\s*(\d+)\s*x\s*([^:*]+):\s*\$?\s*([\d,]+\.?\d*)\s*each\s*=\s*\$?\s*([\d,]+\.?\d*)/gi;
		let m: RegExpExecArray | null;
		while ((m = lineItemRe.exec(content)) !== null) {
			const qty = parseInt(m[1], 10);
			const title = (m[2] || '').trim() || 'Product';
			const unitPrice = (m[3] || '').replace(/,/g, '');
			const lineTotal = (m[4] || '').replace(/,/g, '');
			if (qty >= 1 && (unitPrice || lineTotal)) lineItemsUI.push({ title, quantity: qty, unitPrice, lineTotal, imageUrl: null, variant: null });
		}
		if (lineItemsUI.length === 0) {
			const defaultPrices: Record<number, string> = { 15: '389.99', 10: '285.99', 5: '149.99' };
			const shortRe = /(\d+)\s*x\s*(\d+)\s*L(?:\s*bucket[s]?)?/gi;
			while ((m = shortRe.exec(content)) !== null) {
				const qty = parseInt(m[1], 10);
				const size = parseInt(m[2], 10);
				if (qty >= 1 && (size === 15 || size === 10 || size === 5)) {
					const unit = defaultPrices[size] ?? '0';
					const unitNum = parseFloat(unit);
					const lineTotal = (qty * unitNum).toFixed(2);
					lineItemsUI.push({ title: `${size}L bucket${qty !== 1 ? 's' : ''}`, quantity: qty, unitPrice: unit, lineTotal, imageUrl: null, variant: null });
				}
			}
		}
		let totalItems = 0;
		const itemsMatch = content.match(/\bItems\s+(\d+)/i);
		if (itemsMatch) totalItems = parseInt(itemsMatch[1], 10);
		else if (lineItemsUI.length) totalItems = lineItemsUI.reduce((s, i) => s + (i.quantity || 0), 0);
		let subtotal = '';
		const subMatch = content.match(/Subtotal\s+\$?\s*([\d,]+\.?\d*)/i);
		if (subMatch) subtotal = subMatch[1].replace(/,/g, '');
		let total = '';
		const totalMatch = content.match(/TOTAL\s+\$?\s*([\d,]+\.?\d*)/i) || content.match(/(?:^|\s)Total\s+\$?\s*([\d,]+\.?\d*)/im);
		if (totalMatch) total = totalMatch[1].replace(/,/g, '');
		if (!subtotal && total) subtotal = total;
		if (!total && subtotal) total = subtotal;
		let discountPercent: number | undefined;
		const discountMatch = content.match(/Discount\s+(\d+)\s*%?\s*OFF/i);
		if (discountMatch) discountPercent = parseInt(discountMatch[1], 10);
		let discountAmount: string | undefined;
		const savingsMatch = content.match(/Savings\s+-\s*\$?\s*([\d,]+\.?\d*)/i);
		if (savingsMatch) discountAmount = savingsMatch[1].replace(/,/g, '');
		const currencyMatch = content.match(/\b(AUD|USD|EUR)\b/i);
		const currency = /AUD|USD|EUR/i.test(content) ? (currencyMatch ? currencyMatch[1] : 'AUD') : 'AUD';
		let checkoutUrl = '';
		const linkMatch = content.match(/\[(?:GO\s+TO\s+CHECKOUT|Buy\s+now[^\]]*)\]\((https:\/\/[^)]+)\)/i);
		if (linkMatch) checkoutUrl = linkMatch[2];
		else {
			const cartMatch = content.match(/(https:\/\/[^\s<>"']*(?:cart|checkout|myshopify\.com)[^\s<>"']*)/i);
			if (cartMatch) checkoutUrl = cartMatch[1];
		}
		return {
			lineItemsUI,
			summary: { totalItems: totalItems || lineItemsUI.reduce((s, i) => s + (i.quantity || 0), 0), subtotal: subtotal || total, total: total || subtotal, currency, discountPercent, discountAmount },
			checkoutUrl
		};
	}

	/** Use API preview or parsed; if preview has no line items, merge in parsed line items from content. */
	function getEffectivePreview(msg: Message): CheckoutPreview | null {
		const preview = msg.checkoutPreview ?? tryParseCheckoutFromText(msg.content);
		if (!preview) return null;
		if ((!preview.lineItemsUI || preview.lineItemsUI.length === 0) && msg.content) {
			const parsed = tryParseCheckoutFromText(msg.content);
			if (parsed?.lineItemsUI?.length) return { ...preview, lineItemsUI: parsed.lineItemsUI };
		}
		return preview;
	}

	let sessionId = $state('');
	let visitorName = $state<string | null>(null);
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
	const visitorFirstName = $derived(
		visitorName?.trim() ? visitorName.trim().split(/\s+/)[0] ?? '' : ''
	);
	const welcomeMessage = $derived(
		(win.welcomeMessage ?? '')
			.replace(/\{first_name\}/gi, visitorFirstName || 'there')
			.replace(/\{name\}/gi, visitorName?.trim() || 'there')
	);
	// Chat uses n8n only; no Vercel streaming or polling.
	// Update scroll-to-bottom FAB visibility when messages or content change
	$effect(() => {
		void messages.length;
		requestAnimationFrame(updateScrollToBottomVisibility);
	});

	// Streaming state
	let isStreaming = $state(false);
	let streamingMessageId = $state<number | null>(null);

	function formatTimestamp(createdAt?: string): string {
		if (!createdAt) return '';
		try {
			const date = new Date(createdAt);
			if (isNaN(date.getTime())) return '';
			
			const now = new Date();
			const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
			const diffDays = Math.floor((today.getTime() - messageDate.getTime()) / (1000 * 60 * 60 * 24));
			
			const timeStr = date.toLocaleTimeString('en-US', { 
				hour: 'numeric', 
				minute: '2-digit',
				hour12: true 
			});
			
			if (diffDays === 0) {
				// Today - just show time
				return timeStr;
			} else if (diffDays === 1) {
				// Yesterday
				return `Yesterday ${timeStr}`;
			} else if (diffDays < 7) {
				// This week - show day name
				return `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${timeStr}`;
			} else {
				// Older - show date and time
				return date.toLocaleDateString('en-US', { 
					month: 'short', 
					day: 'numeric',
					hour: 'numeric',
					minute: '2-digit',
					hour12: true
				});
			}
		} catch {
			return '';
		}
	}

	function addBotMessage(content: string, checkoutPreview?: CheckoutPreview) {
		const id = nextLocalId();
		messages = [...messages, { _localId: id, role: 'bot', content, checkoutPreview, createdAt: new Date().toISOString() }];
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
				messages = list.map(mapMessage);
				if (list.length > 0) {
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
		} catch (err) {
			console.error('Error fetching stored messages:', err);
		} finally {
			messagesLoading = false;
			if (forceRefresh) {
				isRefreshing = false;
			}
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
		
		// Fetch visitor name for welcome message personalization
		if (widgetId && sessionId && sessionId !== 'preview' && browser) {
			fetch(`/api/widgets/${widgetId}/visitor?session_id=${encodeURIComponent(sessionId)}`)
				.then((r) => r.json())
				.then((data: { name?: string | null }) => {
					const n = data?.name;
					visitorName = typeof n === 'string' && n.trim() ? n.trim() : null;
				})
				.catch(() => {});
		}
		
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
		messages = [...messages, { _localId: nextLocalId(), role: 'user', content: trimmed, createdAt: new Date().toISOString() }];
		inputText = '';
		showStarterPrompts = false;
		sendPulse = true;
		setTimeout(() => { sendPulse = false; }, 200);
		requestAnimationFrame(() => scrollToBottom(true));

		// Notify parent page (Shopify) that a message was sent
		if (browser && widgetId && widgetId !== 'preview' && sessionId && sessionId !== 'preview') {
			sendToParent({
				type: 'profitbot-message-sent',
				widgetId,
				sessionId,
				data: {
					message: trimmed,
					context: shopifyContext || undefined
				}
			});
		}

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
				// System prompt: Role + Tone only. Rules/instructions come from RAG server-side.
				const bot = config.bot ?? { role: '', tone: '', instructions: '' };
				const systemParts: string[] = [];
				if (bot.role?.trim()) systemParts.push(bot.role.trim());
				if (bot.tone?.trim()) systemParts.push(`Tone: ${bot.tone.trim()}`);
				if (bot.instructions?.trim()) systemParts.push(bot.instructions.trim());
				const systemPrompt: string | undefined = systemParts.length > 0 ? systemParts.join('\n\n') : undefined;
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
		border-radius: {winRadius} !important;
		font-size: {win.fontSizePx}px;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25) !important;
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
					{welcomeMessage}
				</div>
			</div>
		{:else}
			{#each messages as msg, i (msg._localId)}
				{@const preview = getEffectivePreview(msg)}
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
						<div class="flex flex-col max-w-[85%] min-w-0">
							<div
								class="px-3 py-2 rounded-lg flex items-start gap-2 overflow-hidden"
								style="
									background-color: {botStyle.backgroundColor};
									color: {botStyle.textColor};
									border-radius: {win.messageBorderRadius}px;
								"
							>
								<div class="flex-1 min-w-0 overflow-x-auto overflow-y-visible max-w-full break-words">
									{#if preview}
										{#if stripCheckoutBlock(msg.content, preview.checkoutUrl).trim()}
											<div class="chat-message-intro">{@html formatMessage(stripCheckoutBlock(msg.content, preview.checkoutUrl))}</div>
										{/if}
										<div class="checkout-preview-block">
											<div class="checkout-preview">
												<h3 class="checkout-title">Your Checkout Preview</h3>
												{#each preview.lineItemsUI as item}
													<div class="line-item">
														{#if item.imageUrl}
															<img class="product-image" src={item.imageUrl} alt={item.title} loading="lazy" />
														{:else}
															<div class="product-image image-placeholder" aria-hidden="true"></div>
														{/if}
														<div class="product-details">
															<div class="product-title">{item.title}</div>
															<div class="product-meta">Unit Price: $${item.unitPrice} {preview.summary.currency ?? 'AUD'}</div>
														</div>
														<div class="product-qty">Qty: {item.quantity}</div>
														<div class="product-total">${item.lineTotal} {preview.summary.currency ?? 'AUD'}</div>
													</div>
												{/each}
												<hr class="checkout-hr" />
												<div class="summary-row"><span>Items</span><span>{preview.summary.totalItems}</span></div>
												{#if preview.summary.discountPercent != null}
													<div class="summary-row"><span>Discount</span><span>{preview.summary.discountPercent}% OFF</span></div>
												{/if}
												<div class="summary-row"><span>Shipping</span><span>FREE</span></div>
												<div class="summary-row subtotal"><span>Subtotal</span><span>${preview.summary.subtotal} {preview.summary.currency}</span></div>
												{#if preview.summary.discountAmount != null}
													<div class="summary-row savings"><span>Savings</span><span>- ${preview.summary.discountAmount} {preview.summary.currency}</span></div>
												{/if}
												<div class="summary-row total"><span>Total</span><span>${preview.summary.total} {preview.summary.currency}</span></div>
												<div class="gst-note">GST included</div>
												{#if preview.checkoutUrl}
													<a href={preview.checkoutUrl} target="_blank" rel="noopener noreferrer" class="checkout-button">GO TO CHECKOUT</a>
												{:else}
													<span class="checkout-button checkout-button-disabled" aria-disabled="true">GO TO CHECKOUT</span>
												{/if}
											</div>
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
							{#if msg.createdAt}
								<div class="text-xs opacity-60 mt-1 px-1" style="color: {botStyle.textColor};">
									{formatTimestamp(msg.createdAt)}
								</div>
							{/if}
						</div>
					</div>
				{:else}
					<div class="flex justify-end min-w-0 max-w-full" in:fly={{ x: 12, duration: dur(280), easing: cubicOut }}>
						<div class="flex flex-col items-end max-w-[85%] min-w-0">
							<div
								class="px-3 py-2 rounded-lg break-words"
								style="
									background-color: {bubble.backgroundColor};
									color: {bubble.colorOfInternalIcons};
									border-radius: {win.messageBorderRadius}px;
								"
							>
								{msg.content}
							</div>
							{#if msg.createdAt}
								<div class="text-xs opacity-60 mt-1 px-1" style="color: {bubble.colorOfInternalIcons};">
									{formatTimestamp(msg.createdAt)}
								</div>
							{/if}
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
	/* Ensure rounded corners and shadow are preserved on desktop */
	.chat-window.chat-window--desktop-size {
		border-radius: inherit !important;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25) !important;
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
		background: transparent !important;
		background-color: transparent !important;
	}
	:global(.checkout-preview-block .checkout-title) {
		font-size: 18px;
		font-weight: 700;
		margin: 0 0 12px 0;
		color: inherit;
		line-height: 1.2;
	}
	:global(.checkout-preview-block .line-item) {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
		border-bottom: 1px solid rgba(255, 255, 255, 0.15);
	}
	:global(.checkout-preview-block .line-item:last-of-type) {
		border-bottom: none;
	}
	:global(.checkout-preview-block .product-image) {
		width: 64px;
		height: 64px;
		min-width: 64px;
		border-radius: 8px;
		object-fit: cover;
		background: rgba(255, 255, 255, 0.1);
	}
	:global(.checkout-preview-block .product-image.image-placeholder) {
		display: block;
	}
	:global(.checkout-preview-block .product-details) {
		flex: 1;
		min-width: 0;
	}
	:global(.checkout-preview-block .product-title) {
		font-weight: 700;
		font-size: 15px;
		margin-bottom: 4px;
		line-height: 1.3;
	}
	:global(.checkout-preview-block .product-meta) {
		font-size: 13px;
		opacity: 0.85;
	}
	:global(.checkout-preview-block .product-qty) {
		font-size: 13px;
		white-space: nowrap;
	}
	:global(.checkout-preview-block .product-total) {
		font-weight: 700;
		font-size: 15px;
		white-space: nowrap;
	}
	:global(.checkout-preview-block .checkout-hr) {
		border: none;
		border-top: 1px solid rgba(255, 255, 255, 0.2);
		margin: 12px 0;
	}
	:global(.checkout-preview-block .summary-row) {
		display: flex;
		justify-content: space-between;
		padding: 4px 0;
		font-size: 14px;
	}
	:global(.checkout-preview-block .summary-row.subtotal) {
		margin-top: 4px;
	}
	:global(.checkout-preview-block .summary-row.savings) {
		color: rgba(34, 197, 94, 0.95);
	}
	:global(.checkout-preview-block .summary-row.total) {
		font-weight: 700;
		font-size: 1.05em;
		margin-top: 6px;
		padding-top: 6px;
		border-top: 1px solid rgba(255, 255, 255, 0.2);
	}
	:global(.checkout-preview-block .gst-note) {
		font-size: 13px;
		opacity: 0.8;
		margin-top: 8px;
		font-style: italic;
	}
	:global(.checkout-preview-block .checkout-button) {
		display: inline-block;
		margin-top: 14px;
		padding: 12px 24px;
		border-radius: 8px;
		font-weight: 600;
		text-decoration: none;
		text-align: center;
		background: #ea580c;
		color: #fff;
		border: none;
		transition: background 0.15s;
	}
	:global(.checkout-preview-block .checkout-button:hover) {
		background: #c2410c;
		color: #fff;
	}
	:global(.checkout-preview-block .checkout-button-disabled) {
		cursor: default;
		opacity: 0.85;
		pointer-events: none;
	}
	:global(.chat-message-intro) {
		margin-bottom: 0.5em;
	}
	
	/* Message timestamps */
	.chat-window .text-xs {
		font-size: 0.7rem;
		line-height: 1.2;
		user-select: none;
	}
</style>
