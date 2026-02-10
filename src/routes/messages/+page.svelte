<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { formatMessage } from '$lib/chat-message-format';
	import { getSupabaseBrowserClient } from '$lib/supabase.client';
	import type { RealtimeChannel } from '@supabase/supabase-js';

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
	type ContactGroup = {
		key: string;
		contactId: string | null;
		contactName: string | null;
		contactEmail: string | null;
		widgetName: string;
		conversations: Conversation[];
		totalUnread: number;
		latestUpdatedAt: string;
	};

	type CheckoutPreview = {
		lineItemsUI: Array<{ imageUrl: string | null; title: string; variant: string | null; quantity: number; unitPrice: string; lineTotal: string }>;
		summary: { totalItems: number; subtotal: string; total: string; currency: string; discountPercent?: number; discountAmount?: string };
		checkoutUrl: string;
		styleOverrides?: { checkoutButtonColor?: string; qtyBadgeBackgroundColor?: string };
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
		checkoutPreview?: CheckoutPreview;
	};
	function stripCheckoutBlock(content: string | null | undefined): string {
		if (!content || typeof content !== 'string') return '';
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

	/** Parse short DIY quote from content when API did not attach checkoutPreview (same as widget). */
	function tryParseShortDiyQuote(content: string): CheckoutPreview | null {
		if (!content?.trim()) return null;
		const diyIntro = /(?:Here is your DIY quote|DIY quote)\s*(?:for\s*[\d.]+\s*m[²2]?)?\s*[:.]\s*/i.test(content);
		const hasLinePattern = /\d+\s*x\s*.+?\s*(?:15|10|5)\s*L/i.test(content);
		if (!diyIntro && !hasLinePattern) return null;
		const defaultPrices: Record<number, string> = { 15: '389.99', 10: '285.99', 5: '149.99' };
		const lineItemsUI: CheckoutPreview['lineItemsUI'] = [];
		const re = /(\d+)\s*x\s*([^0-9]*?)\s*(15|10|5)\s*L/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(content)) !== null) {
			const qty = parseInt(m[1], 10);
			const productName = (m[2] || '').trim().replace(/\s+/g, ' ') || 'Roof Coating';
			const size = parseInt(m[3], 10);
			if (qty < 1 || (size !== 15 && size !== 10 && size !== 5)) continue;
			const unitPrice = defaultPrices[size] ?? '0';
			const lineTotal = (qty * parseFloat(unitPrice)).toFixed(2);
			lineItemsUI.push({
				title: `${productName} ${size}L`,
				quantity: qty,
				unitPrice,
				lineTotal,
				imageUrl: null,
				variant: null
			});
		}
		if (lineItemsUI.length === 0) return null;
		const totalItems = lineItemsUI.reduce((s, i) => s + i.quantity, 0);
		const subtotalNum = lineItemsUI.reduce((s, i) => s + parseFloat(i.lineTotal), 0);
		const subtotal = subtotalNum.toFixed(2);
		let checkoutUrl = '';
		const linkMatch = content.match(/\[(?:GO\s+TO\s+CHECKOUT|Buy\s+now[^\]]*)\]\((https:\/\/[^)]+)\)/i);
		if (linkMatch) checkoutUrl = linkMatch[2];
		else {
			const cartMatch = content.match(/(https:\/\/[^\s<>"']*(?:cart|checkout|myshopify\.com)[^\s<>"']*)/i);
			if (cartMatch) checkoutUrl = cartMatch[1];
		}
		return { lineItemsUI, summary: { totalItems, subtotal, total: subtotal, currency: 'AUD' }, checkoutUrl };
	}

	/** Parse full checkout block from plain text (table-style). */
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
					const lineTotal = (qty * parseFloat(unit)).toFixed(2);
					lineItemsUI.push({ title: `${size}L NetZero UltraTherm`, quantity: qty, unitPrice: unit, lineTotal, imageUrl: null, variant: null });
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

	/** When a later fetch returns messages without checkoutPreview, keep the preview we already had (avoids flash of good then broken after invalidateAll/realtime). */
	function mergePreservingCheckoutPreview(
		incoming: Message[],
		previous: Message[]
	): Message[] {
		if (previous.length === 0) return incoming;
		const byId = new Map(previous.map((m) => [m.id, m]));
		return incoming.map((msg) => {
			const prev = byId.get(msg.id);
			if (!prev?.checkoutPreview) return msg;
			if (msg.checkoutPreview && (msg.checkoutPreview.lineItemsUI?.length ?? 0) > 0) return msg;
			return { ...msg, checkoutPreview: prev.checkoutPreview };
		});
	}

	/** Same as widget: use API preview or parse from content so Messages shows same rich view. */
	function getEffectivePreview(msg: Message): CheckoutPreview | null {
		const preview =
			msg.checkoutPreview ??
			tryParseCheckoutFromText(msg.content) ??
			tryParseShortDiyQuote(msg.content);
		if (!preview) return null;
		if ((!preview.lineItemsUI || preview.lineItemsUI.length === 0) && msg.content) {
			const parsed = tryParseCheckoutFromText(msg.content) ?? tryParseShortDiyQuote(msg.content);
			if (parsed?.lineItemsUI?.length) return { ...preview, lineItemsUI: parsed.lineItemsUI };
		}
		return preview;
	}

	type ConversationDetail = {
		id: string;
		widgetId: string;
		widgetName: string;
		sessionId: string;
		isAiActive: boolean;
		isAiEmailActive?: boolean;
		createdAt: string;
		updatedAt: string;
		contactId?: string | null;
		contactName?: string | null;
		contactEmail?: string | null;
	};

	type SuggestionContact = {
		id: string;
		name: string | null;
		emails: string[];
		phones: string[];
		tags: string[];
		widgetName: string | null;
		createdAt: string;
	};
	type MergeGroup = {
		reason: string;
		confidence: 'high' | 'medium';
		contacts: SuggestionContact[];
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
	let sendingEmailAi = $state(false);
	let hasMoreMessages = $state(false);
	let loadingMore = $state(false);
	let messagesContainerEl = $state<HTMLDivElement | undefined>(undefined);
	let typingTimeout: ReturnType<typeof setTimeout> | null = null;
	let realtimeChannel: RealtimeChannel | null = null;

	const MESSAGES_PAGE_SIZE = 20;

	let expandedGroups = $state<Set<string>>(new Set());

	// Merge suggestions
	const hasLlmKeys = $derived(Boolean((data as any)?.hasLlmKeys));
	let showMergeSuggestions = $state(false);
	let mergeSuggestionsLoading = $state(false);
	let mergeSuggestionsError = $state<string | null>(null);
	let mergeGroups = $state<MergeGroup[]>([]);
	let mergeSuggestionsLlmUsed = $state(false);
	let mergingGroupIndex = $state<number | null>(null);

	// Group conversations by contact
	const contactGroups = $derived.by(() => {
		const groupMap = new Map<string, ContactGroup>();
		for (const conv of conversations) {
			// Build a grouping key: prefer contactId, fall back to contactName+widgetId
			let key: string;
			if (conv.contactId) {
				key = `contact:${conv.contactId}`;
			} else if (conv.contactName?.trim()) {
				key = `name:${conv.contactName.trim().toLowerCase()}:${conv.widgetId}`;
			} else {
				// No contact info — each conversation is its own group
				key = `conv:${conv.id}`;
			}

			if (!groupMap.has(key)) {
				groupMap.set(key, {
					key,
					contactId: conv.contactId ?? null,
					contactName: conv.contactName ?? null,
					contactEmail: conv.contactEmail ?? null,
					widgetName: conv.widgetName,
					conversations: [],
					totalUnread: 0,
					latestUpdatedAt: conv.updatedAt
				});
			}
			const group = groupMap.get(key)!;
			group.conversations.push(conv);
			group.totalUnread += conv.unreadCount;
			// Keep the latest contact info (name/email) from the most recent conversation
			if (conv.updatedAt > group.latestUpdatedAt) {
				group.latestUpdatedAt = conv.updatedAt;
				if (conv.contactName) group.contactName = conv.contactName;
				if (conv.contactEmail) group.contactEmail = conv.contactEmail;
				if (conv.contactId) group.contactId = conv.contactId;
			}
		}

		// Sort groups by latest updated, sort conversations within each group
		const groups = Array.from(groupMap.values());
		groups.sort((a, b) => new Date(b.latestUpdatedAt).getTime() - new Date(a.latestUpdatedAt).getTime());
		for (const g of groups) {
			g.conversations.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
		}
		return groups;
	});

	function toggleGroup(key: string) {
		if (expandedGroups.has(key)) {
			expandedGroups.delete(key);
		} else {
			expandedGroups.add(key);
		}
		expandedGroups = new Set(expandedGroups);
	}

	function displayGroupLabel(group: ContactGroup): string {
		if (group.contactName?.trim()) return group.contactName.trim();
		if (group.contactEmail?.trim()) return group.contactEmail.trim();
		if (group.conversations.length === 1) {
			return group.conversations[0].widgetName ?? 'Unknown contact';
		}
		return group.widgetName ?? 'Unknown contact';
	}

	function groupInitial(group: ContactGroup): string {
		return displayGroupLabel(group).charAt(0).toUpperCase() || '?';
	}

	function groupContactUrl(group: ContactGroup): string {
		if (group.contactId) return `/contacts?contact=${encodeURIComponent(group.contactId)}`;
		return '/contacts';
	}

	const widgetFilterLabel = $derived(
		selectedWidgetId ? widgets.find((w) => w.id === selectedWidgetId)?.name ?? 'All widgets' : 'All widgets'
	);

	function displayContactLabel(conv: Conversation | ConversationDetail | null): string {
		if (!conv) return 'Unknown';
		const name = conv.contactName ?? conv.contactEmail;
		if (name && typeof name === 'string' && name.trim()) return name.trim();
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
			const incoming = Array.isArray(json.messages) ? json.messages : [];
			messages = mergePreservingCheckoutPreview(incoming, messages);
			hasMoreMessages = !!json.hasMore;
			scrollToBottom();
			// Refresh sidebar unread badge (conversation GET marks user messages as read)
			await invalidateAll();
		} catch {
			// ignore
		}
		startRealtimeSubscription(conv.id);
	}

	function startRealtimeSubscription(conversationId: string) {
		stopRealtimeSubscription();
		
		const supabaseUrl = (data as any).supabaseUrl;
		const supabaseAnonKey = (data as any).supabaseAnonKey;
		
		if (!supabaseUrl || !supabaseAnonKey) {
			console.warn('Supabase config not available. Realtime subscriptions disabled.');
			return;
		}

		const supabase = getSupabaseBrowserClient(supabaseUrl, supabaseAnonKey);
		if (!supabase) return;

		// Subscribe to new messages for this conversation
		const channel = supabase
			.channel(`messages:${conversationId}`)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'widget_conversation_messages',
					filter: `conversation_id=eq.${conversationId}`
				},
				() => {
					// New message inserted - refresh messages
					refreshMessages();
				}
			)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'contact_emails',
					filter: `conversation_id=eq.${conversationId}`
				},
				() => {
					// New email received (via webhook) - refresh messages
					refreshMessages();
				}
			)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'contact_emails',
					filter: `conversation_id=eq.${conversationId}`
				},
				() => {
					// Email status updated (e.g., opened, delivered) - refresh messages
					refreshMessages();
				}
			)
			.subscribe();
		
		realtimeChannel = channel;
	}

	function stopRealtimeSubscription() {
		if (realtimeChannel) {
			realtimeChannel.unsubscribe();
			realtimeChannel = null;
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
					messages = mergePreservingCheckoutPreview(json.messages, messages);
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

	async function setAiEmailActive(active: boolean) {
		if (!selectedConversation) return;
		sendingEmailAi = true;
		try {
			const res = await fetch(`/api/conversations/${selectedConversation.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ is_ai_email_active: active })
			});
			const json = await res.json().catch(() => ({}));
			if (res.ok && conversationDetail && json.conversation) {
				conversationDetail = { ...conversationDetail, isAiEmailActive: json.conversation.isAiEmailActive };
			}
		} finally {
			sendingEmailAi = false;
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

	// ── Merge duplicates ─────────────────────────────────────────────
	async function findDuplicates() {
		mergeSuggestionsLoading = true;
		mergeSuggestionsError = null;
		mergeGroups = [];
		mergeSuggestionsLlmUsed = false;
		showMergeSuggestions = true;
		try {
			const res = await fetch('/api/contacts/merge-suggestions');
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				mergeSuggestionsError = (json.error as string) ?? 'Failed to find duplicates';
				return;
			}
			mergeGroups = Array.isArray(json.groups) ? json.groups : [];
			mergeSuggestionsLlmUsed = Boolean(json.llmUsed);
		} catch {
			mergeSuggestionsError = 'Failed to analyze contacts';
		} finally {
			mergeSuggestionsLoading = false;
		}
	}

	async function mergeGroup(index: number) {
		const group = mergeGroups[index];
		if (!group || group.contacts.length < 2) return;
		mergingGroupIndex = index;
		try {
			const res = await fetch('/api/contacts/merge', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ contactIds: group.contacts.map((c) => c.id) })
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				mergeSuggestionsError = (json.error as string) ?? 'Merge failed';
				return;
			}
			mergeGroups = mergeGroups.filter((_, i) => i !== index);
			fetchConversations();
		} finally {
			mergingGroupIndex = null;
		}
	}

	function dismissGroup(index: number) {
		mergeGroups = mergeGroups.filter((_, i) => i !== index);
	}

	function closeMergeSuggestions() {
		showMergeSuggestions = false;
		mergeGroups = [];
		mergeSuggestionsError = null;
	}

	$effect(() => {
		const w = selectedWidgetId;
		if (selectedConversation && w !== null && selectedConversation.widgetId !== w) {
			selectedConversation = null;
			conversationDetail = null;
			messages = [];
			stopRealtimeSubscription();
		}
		fetchConversations();
	});

	// Deep-link: select conversation from URL ?conversation=id (e.g. from Contacts page)
	$effect(() => {
		const convId = $page.url.searchParams.get('conversation');
		const contactIdParam = $page.url.searchParams.get('contact');
		if (convId && conversations.length > 0 && (!selectedConversation || selectedConversation.id !== convId)) {
			const conv = conversations.find((c) => c.id === convId);
			if (conv) {
				// Auto-expand the group containing this conversation
				const group = contactGroups.find((g) => g.conversations.some((c) => c.id === convId));
				if (group && group.conversations.length > 1) {
					expandedGroups.add(group.key);
					expandedGroups = new Set(expandedGroups);
				}
				selectConversation(conv);
			}
		}
		// Deep-link by contact: expand that contact's group and select latest conversation
		if (contactIdParam && conversations.length > 0 && !convId) {
			const group = contactGroups.find((g) => g.contactId === contactIdParam);
			if (group) {
				if (group.conversations.length > 1) {
					expandedGroups.add(group.key);
					expandedGroups = new Set(expandedGroups);
				}
				if (!selectedConversation || !group.conversations.some((c) => c.id === selectedConversation!.id)) {
					selectConversation(group.conversations[0]);
				}
			}
		}
	});

	onDestroy(() => {
		stopRealtimeSubscription();
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

	/** Check if content contains HTML tags */
	function containsHtml(content: string): boolean {
		// Check for HTML tags (opening or closing)
		return /<[a-z][a-z0-9]*(\s[^>]*)?>|<\/[a-z][a-z0-9]*>/i.test(content);
	}

	/** Sanitize HTML: allow safe tags and attributes, escape the rest */
	function sanitizeHtml(html: string): string {
		// First, convert markdown to HTML, but avoid converting inside HTML tags
		// We'll do this by temporarily replacing HTML tags, converting markdown, then restoring tags
		const tagPlaceholders: string[] = [];
		let tagIndex = 0;
		
		// Temporarily replace HTML tags with placeholders
		let processed = html.replace(/<[^>]+>/g, (match) => {
			tagPlaceholders[tagIndex] = match;
			return `__HTML_TAG_${tagIndex++}__`;
		});
		
		// Convert markdown to HTML (now safe since tags are replaced)
		processed = processed
			// Convert **text** to <strong>text</strong>
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			// Convert *text* to <em>text</em> (but not if it's part of **)
			.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
		
		// Restore HTML tags
		processed = processed.replace(/__HTML_TAG_(\d+)__/g, (_, index) => tagPlaceholders[parseInt(index)] || '');

		// Allowed tags (whitelist approach)
		const allowedTags = ['a', 'p', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'blockquote', 'hr', 'html', 'body'];
		
		// Remove dangerous content
		processed = processed
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
			.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
			.replace(/on\w+\s*=\s*[^\s>]*/gi, '')
			.replace(/javascript:/gi, '')
			.replace(/data:text\/html/gi, '');

		// Process tags - allow safe tags, escape others
		const tagRegex = /<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi;
		
		return processed.replace(tagRegex, (match, tagName, attrs) => {
			const lowerTag = tagName.toLowerCase();
			const isClosing = match.startsWith('</');
			
			// Only allow whitelisted tags
			if (!allowedTags.includes(lowerTag)) {
				// Escape disallowed tags
				return match
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;')
					.replace(/"/g, '&quot;');
			}
			
			if (isClosing) {
				return `</${lowerTag}>`;
			}
			
			// Process attributes for opening tags
			const allowedAttrs: Record<string, string[]> = {
				a: ['href', 'target', 'rel'],
				img: ['src', 'alt', 'class'],
				p: ['class'],
				div: ['class'],
				span: ['class'],
				ul: ['class'],
				ol: ['class'],
				blockquote: ['class']
			};
			
			const attrList = allowedAttrs[lowerTag] || [];
			const attrRegex = /(\w+)\s*=\s*["']([^"']*)["']/g;
			const validAttrs: string[] = [];
			let attrMatch: RegExpExecArray | null;
			
			while ((attrMatch = attrRegex.exec(attrs)) !== null) {
				const attrName = attrMatch[1].toLowerCase();
				if (attrList.includes(attrName)) {
					const attrValue = attrMatch[2]
						.replace(/&/g, '&amp;')
						.replace(/</g, '&lt;')
						.replace(/>/g, '&gt;')
						.replace(/"/g, '&quot;')
						.replace(/'/g, '&#39;');
					validAttrs.push(`${attrName}="${attrValue}"`);
				}
			}
			
			// Add target and rel for links
			if (lowerTag === 'a') {
				if (!validAttrs.some(a => a.startsWith('target'))) {
					validAttrs.push('target="_blank"');
				}
				if (!validAttrs.some(a => a.startsWith('rel'))) {
					validAttrs.push('rel="noopener noreferrer"');
				}
			}
			
			const attrsStr = validAttrs.length > 0 ? ' ' + validAttrs.join(' ') : '';
			return `<${lowerTag}${attrsStr}>`;
		});
	}

	/** Format assistant message: handle HTML for email messages, otherwise use formatMessage */
	function formatAssistantMessage(content: string | null | undefined, isEmail: boolean = false): string {
		if (!content || typeof content !== 'string') return '';
		
		// For email messages, always process HTML and markdown
		if (isEmail) {
			// If HTML is detected, use HTML sanitization (which also handles markdown)
			if (containsHtml(content)) {
				return sanitizeHtml(content);
			}
			// Otherwise, still process markdown and URLs for email messages
			// This handles cases where content has markdown but no HTML tags
			let processed = content
				.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
				.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
				.replace(/(https?:\/\/[^\s<\[\]()"']+)/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-amber-600 hover:text-amber-700 underline break-all">${url}</a>`)
				.replace(/\n/g, '<br>');
			return processed;
		}
		
		// Otherwise use the standard formatMessage (handles markdown, tables, etc.)
		return formatMessage(content);
	}

	/** Format message/email content: handle HTML for emails, markdown for chat. */
	function formatMessageContent(content: string | null | undefined, isEmail: boolean = false): string {
		if (!content || typeof content !== 'string') return '';
		
		// For email messages, check if content contains HTML
		if (isEmail && containsHtml(content)) {
			// Render HTML (sanitized)
			return sanitizeHtml(content);
		}

		// For plain text or chat messages, use existing formatting
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
			<button
				type="button"
				disabled={mergeSuggestionsLoading}
				onclick={findDuplicates}
				class="inline-flex items-center gap-2 rounded-lg border border-amber-600 bg-white px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 disabled:opacity-60 disabled:pointer-events-none"
			>
				{#if mergeSuggestionsLoading}
					<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					Analyzing…
				{:else}
					<svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
					</svg>
					Find Duplicates
				{/if}
			</button>
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
		<!-- Conversation list (grouped by contact) -->
		<aside class="w-72 flex flex-col border-r border-gray-200 shrink-0 overflow-hidden">
			<div class="p-3 border-b border-gray-100 text-sm text-gray-500">
				{contactGroups.length} contact{contactGroups.length !== 1 ? 's' : ''} · {conversations.length} session{conversations.length !== 1 ? 's' : ''}
			</div>
			<div class="flex-1 overflow-y-auto">
				{#if loading}
					<div class="p-4 text-center text-gray-500 text-sm">Loading…</div>
				{:else if conversations.length === 0}
					<div class="p-4 text-center text-gray-500 text-sm">No conversations yet.</div>
				{:else}
					{#each contactGroups as group}
						{@const isSingle = group.conversations.length === 1}
						{@const isExpanded = expandedGroups.has(group.key)}
						{@const hasSelectedConv = group.conversations.some((c) => c.id === selectedConversation?.id)}

						{#if isSingle}
							<!-- Single conversation: render directly (like before) -->
							{@const conv = group.conversations[0]}
							<div
								role="button"
								tabindex="0"
								class="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none cursor-pointer {selectedConversation?.id === conv.id ? 'bg-amber-50 border-l-4 border-l-amber-500' : ''}"
								onclick={() => selectConversation(conv)}
								onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectConversation(conv)}
							>
								<div class="flex items-center gap-2">
									<a
										href={groupContactUrl(group)}
										onclick={(e) => e.stopPropagation()}
										class="shrink-0 w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-semibold hover:bg-amber-200 transition-colors no-underline"
										title="Open contact"
									>
										{groupInitial(group)}
									</a>
									<div class="min-w-0 flex-1">
										<div class="flex items-center justify-between gap-2">
											<a
												href={groupContactUrl(group)}
												onclick={(e) => e.stopPropagation()}
												class="font-medium text-gray-800 truncate hover:text-amber-600 transition-colors no-underline"
												title="Open contact"
											>
												{displayGroupLabel(group)}
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
						{:else}
							<!-- Multi-conversation group: collapsible header -->
							<div
								role="button"
								tabindex="0"
								class="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none cursor-pointer {hasSelectedConv && !isExpanded ? 'bg-amber-50 border-l-4 border-l-amber-500' : ''}"
								onclick={() => toggleGroup(group.key)}
								onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && toggleGroup(group.key)}
							>
								<div class="flex items-center gap-2">
									<a
										href={groupContactUrl(group)}
										onclick={(e) => e.stopPropagation()}
										class="shrink-0 w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-semibold hover:bg-amber-200 transition-colors no-underline"
										title="Open contact"
									>
										{groupInitial(group)}
									</a>
									<div class="min-w-0 flex-1">
										<div class="flex items-center justify-between gap-2">
											<a
												href={groupContactUrl(group)}
												onclick={(e) => e.stopPropagation()}
												class="font-medium text-gray-800 truncate hover:text-amber-600 transition-colors no-underline"
												title="Open contact"
											>
												{displayGroupLabel(group)}
											</a>
											<div class="flex items-center gap-1.5 shrink-0">
												{#if group.totalUnread > 0}
													<span class="rounded-full bg-amber-500 text-white text-xs font-medium min-w-5 h-5 flex items-center justify-center px-1.5">
														{group.totalUnread}
													</span>
												{/if}
												<svg class="w-3.5 h-3.5 text-gray-400 transition-transform {isExpanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
												</svg>
											</div>
										</div>
										<div class="flex items-center gap-2 mt-0.5">
											<span class="text-xs text-gray-500">{group.conversations.length} sessions</span>
											<span class="text-xs text-gray-400">{formatDate(group.latestUpdatedAt)}</span>
										</div>
									</div>
								</div>
							</div>
							<!-- Expanded session list -->
							{#if isExpanded}
								{#each group.conversations as conv}
									<div
										role="button"
										tabindex="0"
										class="w-full text-left pl-10 pr-4 py-2 border-b border-gray-50 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none cursor-pointer bg-gray-50/50 {selectedConversation?.id === conv.id ? 'bg-amber-50 border-l-4 border-l-amber-500' : ''}"
										onclick={() => selectConversation(conv)}
										onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectConversation(conv)}
									>
										<div class="flex items-center justify-between gap-2">
											<span class="text-xs text-gray-600 truncate font-mono">
												{conv.sessionId.slice(0, 20)}…
											</span>
											{#if conv.unreadCount > 0}
												<span class="shrink-0 rounded-full bg-amber-500 text-white text-xs font-medium min-w-4 h-4 flex items-center justify-center px-1">
													{conv.unreadCount}
												</span>
											{/if}
										</div>
										<div class="flex items-center gap-2 mt-0.5">
											<span class="text-xs {conv.isAiActive ? 'text-green-600' : 'text-amber-600'}">
												{conv.isAiActive ? 'AI active' : 'Human takeover'}
											</span>
											<span class="text-xs text-gray-400">{formatDate(conv.updatedAt)}</span>
										</div>
									</div>
								{/each}
							{/if}
						{/if}
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
					<!-- Header: contact name, session, STOP AI / Start AI, AI email -->
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
										STOP AI
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
								{#if currentConv?.contactEmail}
									<button
										type="button"
										class="rounded-lg px-4 py-2 text-sm font-medium border disabled:opacity-50 {conversationDetail?.isAiEmailActive !== false
											? 'bg-amber-100 border-amber-300 text-amber-800 hover:bg-amber-200'
											: 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}"
										disabled={sendingEmailAi}
										onclick={() => setAiEmailActive(conversationDetail?.isAiEmailActive === false)}
									>
										{conversationDetail?.isAiEmailActive !== false ? 'AI email: On' : 'AI email: Off'}
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
									class="max-w-[80%] min-w-0 rounded-lg px-4 py-2 text-sm wrap-break-word {msg.role === 'user'
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
									<div class="wrap-break-word [&_.email-quote]:whitespace-normal [&_a]:break-all {msg.role === 'assistant' ? 'rich-message-content' : 'whitespace-pre-wrap'}">
										{#if msg.role === 'assistant'}
											{@const preview = getEffectivePreview(msg)}
											{#if preview}
											{#if msg.content && typeof msg.content === 'string' && stripCheckoutBlock(msg.content).trim()}
												<div class="chat-message-intro">{@html formatAssistantMessage(stripCheckoutBlock(msg.content), msg.channel === 'email')}</div>
											{/if}
											{@const btnBg = preview.styleOverrides?.checkoutButtonColor ?? '#C8892D'}
											{@const badgeBg = preview.styleOverrides?.qtyBadgeBackgroundColor ?? '#195A2A'}
											<div
												class="checkout-preview-block checkout-preview-block--messages"
												style="--checkout-button-bg: {btnBg}; --qty-badge-bg: {badgeBg};"
											>
												<div class="checkout-preview">
													<h3 class="checkout-title">Your Checkout Preview</h3>
													{#if preview.lineItemsUI && preview.lineItemsUI.length > 0}
														<div class="checkout-line-items">
															{#each preview.lineItemsUI as item}
																{@const imgUrl = item.imageUrl ?? (item as { image_url?: string }).image_url}
																<div class="checkout-line-item">
																	<div class="checkout-line-item-image-wrap">
																		{#if imgUrl}
																			<img class="checkout-line-item-image" src={imgUrl} alt={item.title} loading="lazy" />
																		{:else}
																			<div class="checkout-line-item-image image-placeholder" aria-hidden="true"></div>
																		{/if}
																		<span class="qty-badge">{item.quantity}</span>
																	</div>
																	<div class="checkout-line-item-details">
																		<div class="checkout-line-item-title">{item.title}</div>
																		<div class="checkout-price-grid">
																			<div class="checkout-price-block">
																				<span class="checkout-price-label">Unit Price</span>
																				<span class="checkout-price-value">${item.unitPrice} {preview.summary.currency ?? 'AUD'}</span>
																			</div>
																			<div class="checkout-price-block">
																				<span class="checkout-price-label">Total</span>
																				<span class="checkout-price-value">${item.lineTotal} {preview.summary.currency ?? 'AUD'}</span>
																			</div>
																		</div>
																	</div>
																</div>
															{/each}
														</div>
													{/if}
													<hr class="checkout-hr" />
													<table class="checkout-summary-table">
														<tbody>
															<tr class="summary-row"><td>Items</td><td>{preview.summary.totalItems}</td></tr>
															{#if preview.summary.discountPercent != null}
																<tr class="summary-row"><td>Discount</td><td>{preview.summary.discountPercent}% OFF</td></tr>
															{/if}
															<tr class="summary-row"><td>Shipping</td><td>FREE</td></tr>
															<tr class="summary-row subtotal"><td>Subtotal</td><td>${preview.summary.subtotal} {preview.summary.currency}</td></tr>
															{#if preview.summary.discountAmount != null}
																<tr class="summary-row savings"><td>Savings</td><td>- ${preview.summary.discountAmount} {preview.summary.currency}</td></tr>
															{/if}
															<tr class="summary-row total"><td>Total</td><td>${preview.summary.total} {preview.summary.currency}</td></tr>
														</tbody>
													</table>
													<div class="gst-note">GST included</div>
													{#if preview.checkoutUrl}
														<a href={preview.checkoutUrl} target="_blank" rel="noopener noreferrer" class="checkout-button">GO TO CHECKOUT</a>
													{/if}
												</div>
											</div>
											{:else}
												{@html formatAssistantMessage(typeof msg.content === 'string' ? msg.content : '', msg.channel === 'email')}
											{/if}
										{:else}
											{@html formatMessageContent(typeof msg.content === 'string' ? msg.content : '', msg.channel === 'email')}
										{/if}
									</div>
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

<!-- Merge Suggestions Modal -->
{#if showMergeSuggestions}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<!-- Backdrop -->
		<div
			class="absolute inset-0 bg-black/40"
			onclick={closeMergeSuggestions}
			role="button"
			tabindex="-1"
			onkeydown={(e) => e.key === 'Escape' && closeMergeSuggestions()}
		></div>
		<!-- Modal -->
		<div class="relative w-full max-w-3xl max-h-[85vh] rounded-xl bg-white shadow-2xl flex flex-col overflow-hidden">
			<!-- Header -->
			<div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
				<div>
					<h2 class="text-lg font-semibold text-gray-900">Duplicate Contacts</h2>
					{#if !mergeSuggestionsLoading}
						<p class="text-sm text-gray-500 mt-0.5">
							{mergeGroups.length === 0
								? 'No duplicates found'
								: `${mergeGroups.length} potential duplicate group${mergeGroups.length === 1 ? '' : 's'} found`}
							{#if mergeSuggestionsLlmUsed}
								<span class="ml-1 text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">AI-assisted</span>
							{/if}
						</p>
					{/if}
				</div>
				<button
					type="button"
					onclick={closeMergeSuggestions}
					class="rounded-lg p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
					aria-label="Close"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Content -->
			<div class="flex-1 overflow-y-auto p-6 space-y-4">
				{#if mergeSuggestionsLoading}
					<div class="flex flex-col items-center justify-center py-16 gap-4">
						<svg class="h-8 w-8 animate-spin text-amber-600" fill="none" viewBox="0 0 24 24" aria-hidden="true">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						<div class="text-center">
							<p class="text-sm font-medium text-gray-700">Analyzing contacts for duplicates…</p>
							{#if hasLlmKeys}
								<p class="text-xs text-gray-500 mt-1">Using AI to find fuzzy matches</p>
							{/if}
						</div>
					</div>
				{:else if mergeSuggestionsError}
					<div class="rounded-lg bg-red-50 border border-red-200 p-4">
						<p class="text-sm text-red-700">{mergeSuggestionsError}</p>
					</div>
				{:else if mergeGroups.length === 0}
					<div class="flex flex-col items-center justify-center py-16 text-gray-500">
						<svg class="h-12 w-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						<p class="text-sm font-medium">No duplicates found</p>
						<p class="text-xs mt-1">All your contacts look unique</p>
					</div>
				{:else}
					{#each mergeGroups as group, i}
						<div class="rounded-lg border border-gray-200 bg-gray-50/50 overflow-hidden">
							<!-- Group header -->
							<div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
								<div class="flex items-center gap-2 min-w-0">
									<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {group.confidence === 'high' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}">
										{group.confidence === 'high' ? 'High confidence' : 'Medium confidence'}
									</span>
									<span class="text-sm text-gray-600 truncate">{group.reason}</span>
								</div>
								<div class="flex items-center gap-2 shrink-0 ml-2">
									<button
										type="button"
										disabled={mergingGroupIndex === i}
										onclick={() => mergeGroup(i)}
										class="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 disabled:pointer-events-none transition-colors"
									>
										{#if mergingGroupIndex === i}
											<svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
												<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
												<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
											</svg>
											Merging…
										{:else}
											Merge
										{/if}
									</button>
									<button
										type="button"
										onclick={() => dismissGroup(i)}
										class="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
									>
										Skip
									</button>
								</div>
							</div>
							<!-- Contact cards -->
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
								{#each group.contacts as sc}
									<div class="rounded-lg border border-gray-200 bg-white p-3">
										<div class="flex items-start gap-3">
											<div class="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-semibold shrink-0">
												{(sc.name ?? sc.emails[0] ?? '?').charAt(0).toUpperCase()}
											</div>
											<div class="min-w-0 flex-1">
												<p class="font-medium text-gray-800 truncate">{sc.name ?? 'No name'}</p>
												{#if sc.emails.length > 0}
													{#each sc.emails as email}
														<p class="text-xs text-gray-500 truncate">{email}</p>
													{/each}
												{/if}
												{#if sc.phones.length > 0}
													{#each sc.phones as phone}
														<p class="text-xs text-gray-500">{phone}</p>
													{/each}
												{/if}
												{#if sc.widgetName}
													<p class="text-xs text-gray-400 mt-1">{sc.widgetName}</p>
												{/if}
												{#if sc.tags.length > 0}
													<div class="flex flex-wrap gap-1 mt-1">
														{#each sc.tags as tag}
															<span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{tag}</span>
														{/each}
													</div>
												{/if}
											</div>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}
