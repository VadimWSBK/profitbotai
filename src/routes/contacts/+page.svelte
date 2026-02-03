<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';

	let { data } = $props();

	type Widget = { id: string; name: string };
	const shopifyConnected = $derived(Boolean(data?.shopifyConnected));

	type ShopifyDiscountCode = { code?: string | null; type?: string | null; amount?: string | null };
	type ShopifyOrder = {
		id: number;
		name: string;
		created_at?: string;
		financial_status?: string | null;
		fulfillment_status?: string | null;
		total_price?: string | null;
		currency?: string | null;
		order_status_url?: string | null;
		discount_codes?: ShopifyDiscountCode[] | null;
	};
	type Contact = {
		id: string;
		conversationId: string | null;
		widgetId: string | null;
		widgetName: string | null;
		name: string | null;
		email: string | null;
		phone: string | null;
		address: string | null;
		streetAddress?: string | null;
		city?: string | null;
		state?: string | null;
		postcode?: string | null;
		country?: string | null;
		note?: string | null;
		pdfQuotes: unknown[];
		shopifyOrders?: ShopifyOrder[];
		hasShopifyOrders?: boolean;
		tags?: string[];
		createdAt: string;
		updatedAt: string;
	};

	const widgets = $derived((data?.widgets ?? []) as Widget[]);
	const limit = 10;

	let contacts = $state<Contact[]>([]);
	let selectedContact = $state<Contact | null>(null);
	let contactDetail = $state<Contact | null>(null);
	let selectedWidgetId = $state<string | null>(null);
	let searchQ = $state('');
	let currentPage = $state(1);
	let totalCount = $state(0);
	let hasShopifyOrderFilter = $state(false);
	let selectedTag = $state<string | null>(null);
	let availableTags = $state<string[]>([]);
	let loading = $state(false);
	let detailLoading = $state(false);
	let syncLoading = $state(false);
	let syncError = $state<string | null>(null);
	let editingContact = $state(false);
	let editSaving = $state(false);
	let editError = $state<string | null>(null);
	let newTagInput = $state('');
	let startConversationLoading = $state(false);
	let startConversationError = $state<string | null>(null);

	const totalPages = $derived(Math.max(1, Math.ceil(totalCount / limit)));
	const hasNextPage = $derived(currentPage < totalPages);
	const hasPrevPage = $derived(currentPage > 1);
	const rangeLabel = $derived(
		totalCount === 0
			? '0 contacts'
			: `${(currentPage - 1) * limit + 1}–${Math.min(currentPage * limit, totalCount)} of ${totalCount}`
	);

	function buildContactsUrl() {
		const params = new URLSearchParams();
		params.set('limit', String(limit));
		params.set('page', String(currentPage));
		if (selectedWidgetId) params.set('widget_id', selectedWidgetId);
		if (searchQ.trim()) params.set('q', searchQ.trim());
		if (hasShopifyOrderFilter) params.set('has_shopify_order', 'true');
		if (selectedTag) params.set('tag', selectedTag);
		return `/api/contacts?${params.toString()}`;
	}

	async function fetchContacts() {
		loading = true;
		try {
			const res = await fetch(buildContactsUrl());
			const json = await res.json().catch(() => ({}));
			contacts = Array.isArray(json.contacts) ? json.contacts : [];
			totalCount = typeof json.totalCount === 'number' ? json.totalCount : 0;
			if (selectedContact && !contacts.some((c) => c.id === selectedContact!.id)) {
				selectedContact = null;
				contactDetail = null;
			}
		} finally {
			loading = false;
		}
	}

	async function fetchTags() {
		const res = await fetch('/api/contacts/tags');
		const json = await res.json().catch(() => ({}));
		availableTags = Array.isArray(json.tags) ? json.tags : [];
	}

	function goToNextPage() {
		if (hasNextPage) currentPage += 1;
	}

	function goToPrevPage() {
		if (hasPrevPage) currentPage -= 1;
	}

	async function selectContact(contact: Contact) {
		selectedContact = contact;
		contactDetail = null;
		detailLoading = true;
		try {
			const res = await fetch(`/api/contacts/${contact.id}`);
			const json = await res.json().catch(() => ({}));
			contactDetail = json.contact ?? null;
		} finally {
			detailLoading = false;
		}
	}

	function displayLabel(c: Contact): string {
		if (c.name?.trim()) return c.name.trim();
		if (c.email?.trim()) return c.email.trim();
		return 'Unknown contact';
	}

	function formatDate(iso: string) {
		const d = new Date(iso);
		return d.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
		});
	}

	function formatDateTime(iso: string) {
		const d = new Date(iso);
		return d.toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function backToList() {
		selectedContact = null;
		contactDetail = null;
	}

	function startEdit() {
		editError = null;
		editingContact = true;
	}

	function cancelEdit() {
		editingContact = false;
		editError = null;
		newTagInput = '';
	}

	async function saveContact(payload: {
		name?: string | null;
		email?: string | null;
		phone?: string | null;
		address?: string | null;
		streetAddress?: string | null;
		city?: string | null;
		state?: string | null;
		postcode?: string | null;
		country?: string | null;
		note?: string | null;
		tags?: string[];
	}) {
		if (!contactDetail) return;
		editSaving = true;
		editError = null;
		try {
			const res = await fetch(`/api/contacts/${contactDetail.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				editError = (json.error as string) ?? 'Save failed';
				return;
			}
			editingContact = false;
			newTagInput = '';
			await selectContact(selectedContact!);
		} finally {
			editSaving = false;
		}
	}

	async function addTag() {
		const tag = newTagInput.trim().toLowerCase();
		if (!tag || !contactDetail) return;
		const current = contactDetail.tags ?? [];
		if (current.includes(tag)) {
			newTagInput = '';
			return;
		}
		await saveContact({ tags: [...current, tag] });
		newTagInput = '';
		fetchTags();
	}

	function removeTag(tag: string) {
		if (!contactDetail) return;
		const current = contactDetail.tags ?? [];
		const next = current.filter((t) => t !== tag);
		saveContact({ tags: next });
		fetchTags();
	}

	async function startConversation() {
		if (!contactDetail) return;
		startConversationLoading = true;
		startConversationError = null;
		try {
			const res = await fetch(`/api/contacts/${contactDetail.id}/start-conversation`, { method: 'POST' });
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				startConversationError = (json.error as string) ?? 'Failed to start conversation';
				return;
			}
			const conversationId = json.conversationId as string | undefined;
			if (conversationId) {
				contactDetail = { ...contactDetail, conversationId };
				window.location.href = `/messages?conversation=${conversationId}`;
			} else {
				startConversationError = 'No conversation ID returned';
			}
		} finally {
			startConversationLoading = false;
		}
	}

	async function syncFromShopify() {
		syncLoading = true;
		syncError = null;
		try {
			const res = await fetch('/api/contacts/sync-shopify', { method: 'POST' });
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				syncError = json.error ?? 'Sync failed';
				return;
			}
			await fetchContacts();
		} finally {
			syncLoading = false;
		}
	}

	// Reset to page 1 when filters change
	let prevFilters = $state<{ w: string | null; q: string; shopify: boolean; tag: string | null }>({
		w: null,
		q: '',
		shopify: false,
		tag: null
	});
	$effect(() => {
		const w = selectedWidgetId;
		const q = searchQ;
		const shopify = hasShopifyOrderFilter;
		const tag = selectedTag;
		if (
			prevFilters.w !== w ||
			prevFilters.q !== q ||
			prevFilters.shopify !== shopify ||
			prevFilters.tag !== tag
		) {
			currentPage = 1;
			prevFilters = { w, q, shopify, tag };
		}
		fetchContacts();
	});

	onMount(() => {
		fetchTags();
	});

	// Deep-link: select contact from URL ?contact=id (e.g. from Messages page)
	$effect(() => {
		const contactId = $page.url.searchParams.get('contact');
		if (contactId && contacts.length > 0 && (!selectedContact || selectedContact.id !== contactId)) {
			const c = contacts.find((c) => c.id === contactId);
			if (c) selectContact(c);
		}
	});
</script>

<svelte:head>
	<title>Contacts</title>
</svelte:head>

	<div class="flex flex-col flex-1 min-h-0 gap-4 sm:gap-4">
	<!-- Title + Sync only in top bar -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 shrink-0">
		<h1 class="text-xl font-semibold text-gray-800">Contacts</h1>
		<div class="flex items-center gap-2">
			{#if shopifyConnected}
				<button
					type="button"
					disabled={syncLoading}
					onclick={syncFromShopify}
					class="inline-flex items-center gap-2 rounded-lg border border-amber-600 bg-white px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 disabled:opacity-60 disabled:pointer-events-none"
				>
					{#if syncLoading}
						<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						Syncing…
					{:else}
						<svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
						</svg>
						Sync from Shopify
					{/if}
				</button>
				{#if syncError}
					<p class="text-sm text-red-600">{syncError}</p>
				{/if}
			{/if}
		</div>
	</div>

	<!-- List + detail: fill remaining viewport height; on mobile show one at a time; on lg show both -->
	<div class="flex flex-1 min-h-0 flex-col lg:flex-row gap-0 lg:gap-4 rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
		<!-- Contact list panel: search + filter above list; max 10 shown (latest first) -->
		<aside
			class="w-full lg:w-80 flex flex-col border-r-0 lg:border-r border-gray-200 overflow-hidden bg-gray-50/50 min-h-0 {selectedContact ? 'hidden lg:flex lg:shrink-0' : 'flex-1 lg:flex-initial lg:shrink-0'}"
		>
			<!-- Search bar: just above the contact list -->
			<div class="p-3 border-b border-gray-200 shrink-0" role="search" aria-label="Search contacts">
				<label for="contact-search" class="sr-only">Search contacts</label>
				<div class="relative">
					<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
						</svg>
					</span>
					<input
						id="contact-search"
						type="search"
						class="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 placeholder-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
						placeholder="Search name or email…"
						bind:value={searchQ}
					/>
				</div>
			</div>
			<!-- Filters: widget, Has Shopify order, Tag -->
			<div class="px-3 pb-2 space-y-2 shrink-0">
				<label for="widget-filter" class="text-xs font-medium text-gray-500 block mb-1">Filter</label>
				<select
					id="widget-filter"
					class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
					bind:value={selectedWidgetId}
				>
					<option value={null}>All widgets</option>
					{#each widgets as w}
						<option value={w.id}>{w.name}</option>
					{/each}
				</select>
				<div class="flex items-center gap-2">
					<input
						type="checkbox"
						id="filter-shopify"
						class="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
						bind:checked={hasShopifyOrderFilter}
					/>
					<label for="filter-shopify" class="text-sm text-gray-700">Has Shopify order</label>
				</div>
				{#if availableTags.length > 0}
					<div>
						<label for="tag-filter" class="text-xs font-medium text-gray-500 block mb-1">Tag</label>
						<select
							id="tag-filter"
							class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
							bind:value={selectedTag}
						>
							<option value={null}>All tags</option>
							{#each availableTags as tag}
								<option value={tag}>{tag}</option>
							{/each}
						</select>
					</div>
				{/if}
			</div>
			<!-- Total count + pagination -->
			<div class="px-3 py-2 border-b border-gray-200 shrink-0 flex items-center justify-between gap-2 flex-wrap">
				<span class="text-sm font-medium text-gray-700">{rangeLabel}</span>
				<div class="flex items-center gap-1">
					<button
						type="button"
						disabled={!hasPrevPage || loading}
						onclick={goToPrevPage}
						class="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:pointer-events-none transition-colors"
						aria-label="Previous page"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
						</svg>
					</button>
					<span class="text-xs text-gray-500 min-w-16 text-center">Page {currentPage} of {totalPages}</span>
					<button
						type="button"
						disabled={!hasNextPage || loading}
						onclick={goToNextPage}
						class="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:pointer-events-none transition-colors"
						aria-label="Next page"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
						</svg>
					</button>
				</div>
			</div>
			<div class="flex-1 min-h-0 overflow-y-auto overscroll-contain">
				{#if loading}
					<div class="p-6 text-center text-gray-500 text-sm">Loading…</div>
				{:else if contacts.length === 0}
					<div class="p-6 text-center text-gray-500 text-sm">
						{searchQ.trim() || selectedWidgetId ? 'No contacts match your filters.' : 'No contacts yet.'}
					</div>
				{:else}
					{#each contacts as c}
						<button
							type="button"
							class="relative w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-white focus:bg-white focus:outline-none transition-colors {selectedContact?.id === c.id ? 'bg-white border-l-4 border-l-amber-500 shadow-sm' : ''}"
							onclick={() => selectContact(c)}
						>
							{#if c.hasShopifyOrders}
								<span
									class="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded bg-[#96bf48] text-white shrink-0"
									title="Has Shopify order(s)"
									aria-label="Has Shopify order(s)"
								>
									<!-- Shopping bag (Shopify-style) -->
									<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
										<path d="M3 6h18" />
										<path d="M16 10a4 4 0 01-8 0" />
									</svg>
								</span>
							{/if}
							<div class="flex items-center gap-2 pr-6">
								<div
									class="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-semibold shrink-0"
								>
									{(c.name ?? c.email ?? '?').charAt(0).toUpperCase()}
								</div>
								<div class="min-w-0 flex-1">
									<div class="font-medium text-gray-800 truncate">{displayLabel(c)}</div>
									{#if c.email && c.name}
										<div class="text-xs text-gray-500 truncate">{c.email}</div>
									{/if}
									{#if c.widgetName}
										<div class="text-xs text-gray-400 mt-0.5">{c.widgetName}</div>
									{/if}
									<div class="text-xs text-gray-400 mt-0.5">{formatDate(c.updatedAt)}</div>
								</div>
							</div>
						</button>
					{/each}
				{/if}
			</div>
		</aside>

		<!-- Contact detail: full width on mobile when selected; right column on lg -->
		<div
			class="flex-1 flex flex-col min-w-0 overflow-hidden bg-white {selectedContact ? 'flex' : 'hidden lg:flex'}"
		>
			{#if !selectedContact}
				<div class="flex-1 flex flex-col items-center justify-center text-gray-500 p-8">
					<div class="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
						<svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
						</svg>
					</div>
					<p class="text-sm font-medium">Select a contact</p>
					<p class="text-xs mt-1">Choose a contact from the list to view full details</p>
				</div>
			{:else if detailLoading}
				<div class="flex-1 flex items-center justify-center p-8">
					<div class="animate-pulse flex flex-col items-center gap-3">
						<div class="h-12 w-12 rounded-full bg-gray-200"></div>
						<div class="h-4 w-48 rounded bg-gray-200"></div>
						<div class="h-3 w-32 rounded bg-gray-100"></div>
					</div>
				</div>
			{:else if contactDetail}
				<div class="flex-1 overflow-y-auto min-h-0">
					<!-- Back button: visible only on mobile/tablet when detail is shown -->
					<div class="lg:hidden shrink-0 border-b border-gray-200 bg-white px-4 py-3">
						<button
							type="button"
							onclick={backToList}
							class="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 focus:outline-none"
						>
							<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
							</svg>
							Back to contacts
						</button>
					</div>

					<!-- Header card -->
					<div class="p-4 sm:p-6 border-b border-gray-200 bg-linear-to-b from-gray-50 to-white">
						<div class="flex flex-col sm:flex-row sm:items-start gap-4">
							<div class="flex items-start gap-4 min-w-0 flex-1">
								<div
									class="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-amber-500 text-white flex items-center justify-center text-lg sm:text-xl font-semibold shrink-0"
								>
									{(contactDetail.name ?? contactDetail.email ?? '?').charAt(0).toUpperCase()}
								</div>
								<div class="min-w-0 flex-1">
									<h2 class="text-lg sm:text-xl font-semibold text-gray-900 truncate">
										{contactDetail.name ?? 'No name'}
									</h2>
									{#if contactDetail.email}
										<a
											href={contactDetail.conversationId ? `/messages?conversation=${contactDetail.conversationId}` : `/messages?contact=${contactDetail.id}`}
											class="text-amber-600 hover:text-amber-700 text-sm font-medium break-all"
										>
											{contactDetail.email}
										</a>
									{/if}
									{#if contactDetail.widgetName}
										<p class="text-sm text-gray-500 mt-1">Widget: {contactDetail.widgetName}</p>
									{/if}
									<p class="text-xs text-gray-400 mt-1">
										Created {formatDateTime(contactDetail.createdAt)} · Updated {formatDateTime(contactDetail.updatedAt)}
									</p>
								</div>
							</div>
							<div class="flex items-center gap-2 shrink-0">
								{#if editingContact}
									<button
										type="button"
										disabled={editSaving}
										onclick={cancelEdit}
										class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
									>
										Cancel
									</button>
								{:else}
									{#if contactDetail.conversationId}
										<a
											href="/messages?conversation={contactDetail.conversationId}"
											class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors text-center"
										>
											Start conversation
										</a>
									{:else}
										<button
											type="button"
											disabled={startConversationLoading}
											onclick={startConversation}
											class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
										>
											{startConversationLoading ? 'Starting…' : 'Start conversation'}
										</button>
										{#if startConversationError}
											<p class="text-sm text-red-600">{startConversationError}</p>
										{/if}
									{/if}
									<button
										type="button"
										onclick={startEdit}
										class="rounded-lg border border-amber-600 bg-white px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 transition-colors"
									>
										Edit
									</button>
								{/if}
							</div>
						</div>
					</div>

					<!-- Info sections -->
					<div class="p-4 sm:p-6 space-y-6">
						{#if editingContact}
							<!-- Edit form -->
							<section>
								<h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Edit contact</h3>
								{#if editError}
									<p class="mb-3 text-sm text-red-600">{editError}</p>
								{/if}
								<form
									class="space-y-4 rounded-lg border border-gray-200 bg-gray-50/50 p-4"
									onsubmit={(e) => {
										e.preventDefault();
										const form = e.currentTarget;
										const fd = new FormData(form);
										saveContact({
											name: (fd.get('name') as string) ?? '',
											email: (fd.get('email') as string) ?? '',
											phone: (fd.get('phone') as string) ?? '',
											streetAddress: (fd.get('streetAddress') as string) ?? '',
											city: (fd.get('city') as string) ?? '',
											state: (fd.get('state') as string) ?? '',
											postcode: (fd.get('postcode') as string) ?? '',
											country: (fd.get('country') as string) ?? '',
											note: (fd.get('note') as string) ?? ''
										});
									}}
								>
									<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
										<div>
											<label for="edit-name" class="block text-xs font-medium text-gray-500 uppercase mb-1">Name</label>
											<input id="edit-name" name="name" type="text" value={contactDetail.name ?? ''} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
										</div>
										<div>
											<label for="edit-email" class="block text-xs font-medium text-gray-500 uppercase mb-1">Email</label>
											<input id="edit-email" name="email" type="email" value={contactDetail.email ?? ''} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
										</div>
										<div>
											<label for="edit-phone" class="block text-xs font-medium text-gray-500 uppercase mb-1">Phone</label>
											<input id="edit-phone" name="phone" type="tel" value={contactDetail.phone ?? ''} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
										</div>
									</div>
									<div class="space-y-2">
										<label for="edit-streetAddress" class="block text-xs font-medium text-gray-500 uppercase">Address</label>
										<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
											<div class="sm:col-span-2">
												<input id="edit-streetAddress" name="streetAddress" type="text" placeholder="Street address" value={contactDetail.streetAddress ?? ''} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
											</div>
											<div>
												<input name="city" type="text" placeholder="City" value={contactDetail.city ?? ''} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
											</div>
											<div>
												<input name="state" type="text" placeholder="State / Province" value={contactDetail.state ?? ''} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
											</div>
											<div>
												<input name="postcode" type="text" placeholder="Postcode" value={contactDetail.postcode ?? ''} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
											</div>
											<div>
												<input name="country" type="text" placeholder="Country" value={contactDetail.country ?? ''} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
											</div>
										</div>
									</div>
									<div>
										<label for="edit-note" class="block text-xs font-medium text-gray-500 uppercase mb-1">Note</label>
										<textarea id="edit-note" name="note" rows="3" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500" placeholder="Notes about this contact">{contactDetail.note ?? ''}</textarea>
									</div>
									<div class="flex items-center gap-2 pt-2">
										<button type="submit" disabled={editSaving} class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
											{editSaving ? 'Saving…' : 'Save'}
										</button>
										<button type="button" onclick={cancelEdit} class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
											Cancel
										</button>
									</div>
								</form>
							</section>
							<!-- Tags in edit mode: add/remove -->
							<section>
								<h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Tags</h3>
								<div class="flex flex-wrap gap-2 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
									{#each contactDetail.tags ?? [] as tag}
										<span class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-800">
											{tag}
											<button type="button" onclick={() => removeTag(tag)} class="ml-0.5 rounded-full p-0.5 hover:bg-amber-200" aria-label="Remove tag {tag}">×</button>
										</span>
									{/each}
									<div class="flex gap-2">
										<input
											type="text"
											class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm w-28 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
											placeholder="Add tag"
											bind:value={newTagInput}
											onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
										/>
										<button type="button" onclick={addTag} class="rounded-lg border border-amber-600 bg-white px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50">Add</button>
									</div>
								</div>
							</section>
						{:else}
							<!-- View mode: contact info -->
							<section>
								<h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Contact information</h3>
								<dl class="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
									<div>
										<dt class="text-xs font-medium text-gray-500 uppercase">Name</dt>
										<dd class="mt-0.5 text-gray-900">{contactDetail.name ?? '—'}</dd>
									</div>
									<div>
										<dt class="text-xs font-medium text-gray-500 uppercase">Email</dt>
										<dd class="mt-0.5">
											{#if contactDetail.email}
												<a
													href={contactDetail.conversationId ? `/messages?conversation=${contactDetail.conversationId}` : `/messages?contact=${contactDetail.id}`}
													class="text-amber-600 hover:text-amber-700"
												>
													{contactDetail.email}
												</a>
											{:else}
												<span class="text-gray-500">—</span>
											{/if}
										</dd>
									</div>
									<div>
										<dt class="text-xs font-medium text-gray-500 uppercase">Phone</dt>
										<dd class="mt-0.5">
											{#if contactDetail.phone}
												<a href="tel:{contactDetail.phone}" class="text-amber-600 hover:text-amber-700">{contactDetail.phone}</a>
											{:else}
												<span class="text-gray-500">—</span>
											{/if}
										</dd>
									</div>
									<div class="sm:col-span-2">
										<dt class="text-xs font-medium text-gray-500 uppercase">Street address</dt>
										<dd class="mt-0.5 text-gray-900">{contactDetail.streetAddress ?? '—'}</dd>
									</div>
									<div>
										<dt class="text-xs font-medium text-gray-500 uppercase">City</dt>
										<dd class="mt-0.5 text-gray-900">{contactDetail.city ?? '—'}</dd>
									</div>
									<div>
										<dt class="text-xs font-medium text-gray-500 uppercase">State</dt>
										<dd class="mt-0.5 text-gray-900">{contactDetail.state ?? '—'}</dd>
									</div>
									<div>
										<dt class="text-xs font-medium text-gray-500 uppercase">Postcode</dt>
										<dd class="mt-0.5 text-gray-900">{contactDetail.postcode ?? '—'}</dd>
									</div>
									<div>
										<dt class="text-xs font-medium text-gray-500 uppercase">Country</dt>
										<dd class="mt-0.5 text-gray-900">{contactDetail.country ?? '—'}</dd>
									</div>
									{#if !contactDetail.streetAddress && !contactDetail.city && !contactDetail.state && !contactDetail.postcode && !contactDetail.country && contactDetail.address}
										<div class="sm:col-span-2">
											<dt class="text-xs font-medium text-gray-500 uppercase">Address (legacy)</dt>
											<dd class="mt-0.5 text-gray-900">{contactDetail.address}</dd>
										</div>
									{/if}
								</dl>
							</section>
							<!-- Tags (view) + add tag -->
							<section>
								<h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Tags</h3>
								<div class="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
									{#each contactDetail.tags ?? [] as tag}
										<span class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-800">{tag}</span>
									{/each}
									{#if (contactDetail.tags ?? []).length === 0}
										<span class="text-sm text-gray-500">No tags</span>
									{/if}
									<div class="flex gap-2 ml-2">
										<input
											type="text"
											class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm w-28 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
											placeholder="Add tag"
											bind:value={newTagInput}
											onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
										/>
										<button type="button" onclick={addTag} class="rounded-lg border border-amber-600 bg-white px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50">Add</button>
									</div>
								</div>
							</section>
							<!-- Note -->
							<section>
								<h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Note</h3>
								<div class="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
									{#if contactDetail.note?.trim()}
										<p class="text-gray-900 whitespace-pre-wrap">{contactDetail.note}</p>
									{:else}
										<p class="text-gray-500 text-sm">No note</p>
									{/if}
								</div>
							</section>
						{/if}

						{#if contactDetail.pdfQuotes && contactDetail.pdfQuotes.length > 0}
							<section>
								<h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">PDF quotes</h3>
								<ul class="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-3">
									{#each contactDetail.pdfQuotes as quote}
										{@const resolved = typeof quote === 'string' ? { url: quote } : quote && typeof quote === 'object' && 'url' in quote ? quote as { url: string; created_at?: string; total?: string } : null}
										<li class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
											{#if typeof quote === 'string'}
												<a
													href={quote}
													target="_blank"
													rel="noopener noreferrer"
													class="text-amber-600 hover:text-amber-700 text-sm font-medium break-all"
												>
													View PDF
												</a>
											{:else if resolved}
												<a
													href={resolved.url}
													target="_blank"
													rel="noopener noreferrer"
													class="text-amber-600 hover:text-amber-700 text-sm font-medium break-all"
												>
													{(quote as { name?: string }).name ?? 'View PDF'}
												</a>
												{#if resolved.created_at || resolved.total}
													<span class="text-gray-500 text-xs">
														{#if resolved.created_at}
															{new Date(resolved.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}
														{/if}
														{#if resolved.created_at && resolved.total}
															<span class="text-gray-400"> · </span>
														{/if}
														{#if resolved.total}
															{resolved.total}
														{/if}
													</span>
												{/if}
											{:else}
												<span class="text-gray-500 text-sm">—</span>
											{/if}
										</li>
									{/each}
								</ul>
							</section>
						{/if}

						{#if contactDetail.shopifyOrders && contactDetail.shopifyOrders.length > 0}
							<section>
								<h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Shopify orders</h3>
								<ul class="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-3">
									{#each contactDetail.shopifyOrders as order}
										<li class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
											<span class="font-medium text-gray-800">{order.name}</span>
											{#if order.total_price != null}
												<span class="text-gray-600 text-sm">
													{order.total_price}{#if order.currency} {order.currency}{/if}
												</span>
											{/if}
											{#if order.created_at}
												<span class="text-gray-500 text-xs">
													{new Date(order.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}
												</span>
											{/if}
											{#if order.financial_status}
												<span class="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">{order.financial_status}</span>
											{/if}
											{#if order.discount_codes && order.discount_codes.length > 0}
												{#each order.discount_codes as dc}
													{#if dc.code}
														<span class="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800" title="Discount code">
															{dc.code}
															{#if dc.amount != null}
																{#if dc.type === 'percentage'}
																	({dc.amount}% off)
																{:else}
																	({dc.amount}{#if order.currency} {order.currency}{/if} off)
																{/if}
															{/if}
														</span>
													{/if}
												{/each}
											{/if}
											{#if order.order_status_url}
												<a
													href={order.order_status_url}
													target="_blank"
													rel="noopener noreferrer"
													class="text-amber-600 hover:text-amber-700 text-sm"
												>
													View order
												</a>
											{/if}
										</li>
									{/each}
								</ul>
							</section>
						{/if}

						<section>
							<h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Record</h3>
							<dl class="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-gray-50/50 p-4 text-sm">
								<div>
									<dt class="text-xs font-medium text-gray-500 uppercase">Contact ID</dt>
									<dd class="mt-0.5 font-mono text-gray-600 break-all">{contactDetail.id}</dd>
								</div>
								{#if contactDetail.conversationId}
									<div>
										<dt class="text-xs font-medium text-gray-500 uppercase">Conversation ID</dt>
										<dd class="mt-0.5 font-mono text-gray-600 break-all">{contactDetail.conversationId}</dd>
									</div>
								{/if}
								{#if contactDetail.widgetId}
									<div>
										<dt class="text-xs font-medium text-gray-500 uppercase">Widget ID</dt>
										<dd class="mt-0.5 font-mono text-gray-600 break-all">{contactDetail.widgetId}</dd>
									</div>
								{/if}
							</dl>
						</section>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
