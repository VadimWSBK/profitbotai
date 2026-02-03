<script lang="ts">
	import { page } from '$app/stores';

	let { data } = $props();

	type Widget = { id: string; name: string };
	type Contact = {
		id: string;
		conversationId: string | null;
		widgetId: string | null;
		widgetName: string | null;
		name: string | null;
		email: string | null;
		phone: string | null;
		address: string | null;
		pdfQuotes: unknown[];
		createdAt: string;
		updatedAt: string;
	};

	const widgets = $derived((data?.widgets ?? []) as Widget[]);

	let contacts = $state<Contact[]>([]);
	let selectedContact = $state<Contact | null>(null);
	let contactDetail = $state<Contact | null>(null);
	let selectedWidgetId = $state<string | null>(null);
	let searchQ = $state('');
	let loading = $state(false);
	let detailLoading = $state(false);

	const widgetFilterLabel = $derived(
		selectedWidgetId ? widgets.find((w) => w.id === selectedWidgetId)?.name ?? 'All widgets' : 'All widgets'
	);

	function buildContactsUrl() {
		const params = new URLSearchParams();
		if (selectedWidgetId) params.set('widget_id', selectedWidgetId);
		if (searchQ.trim()) params.set('q', searchQ.trim());
		return `/api/contacts?${params.toString()}`;
	}

	async function fetchContacts() {
		loading = true;
		try {
			const res = await fetch(buildContactsUrl());
			const json = await res.json().catch(() => ({}));
			contacts = Array.isArray(json.contacts) ? json.contacts : [];
			if (selectedContact && !contacts.some((c) => c.id === selectedContact!.id)) {
				selectedContact = null;
				contactDetail = null;
			}
		} finally {
			loading = false;
		}
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

	$effect(() => {
		const w = selectedWidgetId;
		const q = searchQ;
		fetchContacts();
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

<div class="flex flex-col min-h-0 gap-4 sm:gap-4">
	<!-- Title + filters: stack on mobile, row on md+ -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 shrink-0">
		<h1 class="text-xl font-semibold text-gray-800">Contacts</h1>
		<div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
			<div class="flex items-center gap-2">
				<label for="widget-filter" class="text-sm text-gray-600 shrink-0">Widget</label>
				<select
					id="widget-filter"
					class="flex-1 min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
					bind:value={selectedWidgetId}
				>
					<option value={null}>All widgets</option>
					{#each widgets as w}
						<option value={w.id}>{w.name}</option>
					{/each}
				</select>
			</div>
			<div class="relative flex-1 sm:flex-initial min-w-0">
				<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
				</span>
				<input
					type="search"
					class="w-full sm:w-56 rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 placeholder-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
					placeholder="Search name or email…"
					bind:value={searchQ}
				/>
			</div>
		</div>
	</div>

	<!-- List + detail: on mobile show one at a time; on lg show both -->
	<div class="flex flex-1 min-h-0 flex-col lg:flex-row gap-0 lg:gap-4 rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
		<!-- Contact list: full width on mobile when no selection; sidebar on lg -->
		<aside
			class="w-full lg:w-80 flex flex-col border-r-0 lg:border-r border-gray-200 overflow-hidden bg-gray-50/50 min-h-0 {selectedContact ? 'hidden lg:flex lg:shrink-0' : 'flex-1 lg:flex-initial lg:shrink-0'}"
		>
			<div class="p-3 border-b border-gray-200 flex items-center justify-between shrink-0">
				<span class="text-sm font-medium text-gray-700">{contacts.length} contact{contacts.length !== 1 ? 's' : ''}</span>
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
							class="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-white focus:bg-white focus:outline-none transition-colors {selectedContact?.id === c.id ? 'bg-white border-l-4 border-l-amber-500 shadow-sm' : ''}"
							onclick={() => selectContact(c)}
						>
							<div class="flex items-center gap-2">
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
							<div class="flex items-start gap-4 min-w-0">
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
											href="mailto:{contactDetail.email}"
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
							{#if contactDetail.conversationId}
								<a
									href="/messages?conversation={contactDetail.conversationId}"
									class="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors text-center"
								>
									View conversation
								</a>
							{/if}
						</div>
					</div>

					<!-- Info sections -->
					<div class="p-4 sm:p-6 space-y-6">
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
											<a href="mailto:{contactDetail.email}" class="text-amber-600 hover:text-amber-700">{contactDetail.email}</a>
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
									<dt class="text-xs font-medium text-gray-500 uppercase">Address</dt>
									<dd class="mt-0.5 text-gray-900">{contactDetail.address ?? '—'}</dd>
								</div>
							</dl>
						</section>

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
