<script lang="ts">
	type SmtpConfig = { host?: string; port?: number; username?: string; password?: string; secure?: boolean };
	type ImapConfig = { host?: string; port?: number; username?: string; password?: string; secure?: boolean };

	type EmailAccount = {
		id: string;
		email_address: string;
		display_name: string;
		reply_to: string | null;
		provider_type: 'google' | 'microsoft' | 'smtp';
		status: 'active' | 'paused' | 'error';
		smtp_config: SmtpConfig;
		imap_config: ImapConfig;
		daily_send_limit: number;
		warmup_enabled: boolean;
		daily_warmup_limit: number;
		signature_html: string;
		last_error: string | null;
		last_connected_at: string | null;
		created_at: string;
		updated_at: string;
	};

	type OutreachSettings = {
		default_daily_send_limit: number;
		min_delay_minutes: number;
		random_delay_minutes: number;
		bounce_threshold_pct: number;
		spam_complaint_threshold_pct: number;
	};

	// Provider presets for auto-filling SMTP/IMAP
	const PROVIDER_PRESETS: Record<string, { smtp: SmtpConfig; imap: ImapConfig }> = {
		google: {
			smtp: { host: 'smtp.gmail.com', port: 587, secure: false },
			imap: { host: 'imap.gmail.com', port: 993, secure: true }
		},
		microsoft: {
			smtp: { host: 'smtp.office365.com', port: 587, secure: false },
			imap: { host: 'outlook.office365.com', port: 993, secure: true }
		},
		smtp: {
			smtp: { host: '', port: 587, secure: false },
			imap: { host: '', port: 993, secure: true }
		}
	};

	// Page state
	let activeTab = $state<'accounts' | 'settings'>('accounts');
	let accounts = $state<EmailAccount[]>([]);
	let settings = $state<OutreachSettings>({
		default_daily_send_limit: 30,
		min_delay_minutes: 3,
		random_delay_minutes: 5,
		bounce_threshold_pct: 5.0,
		spam_complaint_threshold_pct: 2.0
	});
	let loaded = $state(false);
	let error = $state<string | null>(null);
	let successMsg = $state<string | null>(null);

	// Modal state
	let showModal = $state(false);
	let editingId = $state<string | null>(null);
	let modalStep = $state<'provider' | 'details'>('provider');
	let saving = $state(false);

	// Modal form
	let formProvider = $state<'google' | 'microsoft' | 'smtp'>('smtp');
	let formEmail = $state('');
	let formDisplayName = $state('');
	let formReplyTo = $state('');
	let formSmtpHost = $state('');
	let formSmtpPort = $state(587);
	let formSmtpUsername = $state('');
	let formSmtpPassword = $state('');
	let formSmtpSecure = $state(false);
	let formImapHost = $state('');
	let formImapPort = $state(993);
	let formImapUsername = $state('');
	let formImapPassword = $state('');
	let formImapSecure = $state(true);
	let formDailyLimit = $state(30);
	let formWarmupEnabled = $state(false);
	let formWarmupLimit = $state(10);
	let formSignature = $state('');

	// Test connection
	let testingId = $state<string | null>(null);
	let testResult = $state<{ smtp: { success: boolean; error?: string } } | null>(null);

	// Settings saving
	let settingsSaving = $state(false);

	// Delete confirm
	let deletingId = $state<string | null>(null);
	let deleteConfirmId = $state<string | null>(null);

	// Load accounts
	async function loadAccounts() {
		try {
			const res = await fetch('/api/email/accounts');
			const data = await res.json().catch(() => ({}));
			accounts = data.accounts ?? [];
		} catch {
			accounts = [];
		}
	}

	// Load settings
	async function loadSettings() {
		try {
			const res = await fetch('/api/email/settings');
			const data = await res.json().catch(() => ({}));
			settings = {
				default_daily_send_limit: data.default_daily_send_limit ?? 30,
				min_delay_minutes: data.min_delay_minutes ?? 3,
				random_delay_minutes: data.random_delay_minutes ?? 5,
				bounce_threshold_pct: data.bounce_threshold_pct ?? 5.0,
				spam_complaint_threshold_pct: data.spam_complaint_threshold_pct ?? 2.0
			};
		} catch {
			// Keep defaults
		}
	}

	async function load() {
		try {
			await Promise.all([loadAccounts(), loadSettings()]);
		} finally {
			loaded = true;
		}
	}

	// Open add modal
	function openAddModal() {
		editingId = null;
		modalStep = 'provider';
		resetForm();
		showModal = true;
	}

	// Open edit modal
	function openEditModal(account: EmailAccount) {
		editingId = account.id;
		modalStep = 'details';
		formProvider = account.provider_type;
		formEmail = account.email_address;
		formDisplayName = account.display_name;
		formReplyTo = account.reply_to ?? '';
		formSmtpHost = account.smtp_config.host ?? '';
		formSmtpPort = account.smtp_config.port ?? 587;
		formSmtpUsername = account.smtp_config.username ?? '';
		formSmtpPassword = ''; // Never pre-fill passwords
		formSmtpSecure = account.smtp_config.secure ?? false;
		formImapHost = account.imap_config.host ?? '';
		formImapPort = account.imap_config.port ?? 993;
		formImapUsername = account.imap_config.username ?? '';
		formImapPassword = ''; // Never pre-fill passwords
		formImapSecure = account.imap_config.secure ?? true;
		formDailyLimit = account.daily_send_limit;
		formWarmupEnabled = account.warmup_enabled;
		formWarmupLimit = account.daily_warmup_limit;
		formSignature = account.signature_html;
		showModal = true;
	}

	function resetForm() {
		formProvider = 'smtp';
		formEmail = '';
		formDisplayName = '';
		formReplyTo = '';
		formSmtpHost = '';
		formSmtpPort = 587;
		formSmtpUsername = '';
		formSmtpPassword = '';
		formSmtpSecure = false;
		formImapHost = '';
		formImapPort = 993;
		formImapUsername = '';
		formImapPassword = '';
		formImapSecure = true;
		formDailyLimit = 30;
		formWarmupEnabled = false;
		formWarmupLimit = 10;
		formSignature = '';
	}

	function selectProvider(provider: 'google' | 'microsoft' | 'smtp') {
		formProvider = provider;
		const preset = PROVIDER_PRESETS[provider];
		formSmtpHost = preset.smtp.host ?? '';
		formSmtpPort = preset.smtp.port ?? 587;
		formSmtpSecure = preset.smtp.secure ?? false;
		formImapHost = preset.imap.host ?? '';
		formImapPort = preset.imap.port ?? 993;
		formImapSecure = preset.imap.secure ?? true;
		modalStep = 'details';
	}

	// Save account (create or update)
	async function saveAccount() {
		error = null;
		if (!formEmail.trim()) {
			error = 'Email address is required';
			return;
		}
		if (!formSmtpHost.trim()) {
			error = 'SMTP host is required';
			return;
		}

		saving = true;
		try {
			const payload: Record<string, unknown> = {
				email_address: formEmail.trim(),
				display_name: formDisplayName.trim(),
				reply_to: formReplyTo.trim() || null,
				provider_type: formProvider,
				smtp_config: {
					host: formSmtpHost.trim(),
					port: formSmtpPort,
					username: formSmtpUsername.trim() || formEmail.trim(),
					secure: formSmtpSecure,
					...(formSmtpPassword ? { password: formSmtpPassword } : {})
				},
				imap_config: {
					host: formImapHost.trim(),
					port: formImapPort,
					username: formImapUsername.trim() || formEmail.trim(),
					secure: formImapSecure,
					...(formImapPassword ? { password: formImapPassword } : {})
				},
				daily_send_limit: formDailyLimit,
				warmup_enabled: formWarmupEnabled,
				daily_warmup_limit: formWarmupLimit,
				signature_html: formSignature
			};

			const url = editingId ? `/api/email/accounts/${editingId}` : '/api/email/accounts';
			const method = editingId ? 'PUT' : 'POST';

			const res = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Failed to save account');

			showModal = false;
			successMsg = editingId ? 'Account updated successfully' : 'Account added successfully';
			setTimeout(() => (successMsg = null), 3000);
			await loadAccounts();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save account';
		} finally {
			saving = false;
		}
	}

	// Delete account
	async function deleteAccount(id: string) {
		deletingId = id;
		error = null;
		try {
			const res = await fetch(`/api/email/accounts/${id}`, { method: 'DELETE' });
			if (!res.ok) {
				const result = await res.json().catch(() => ({}));
				throw new Error(result.error || 'Failed to delete account');
			}
			deleteConfirmId = null;
			successMsg = 'Account deleted';
			setTimeout(() => (successMsg = null), 3000);
			await loadAccounts();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete account';
		} finally {
			deletingId = null;
		}
	}

	// Toggle pause/active
	async function toggleStatus(account: EmailAccount) {
		const newStatus = account.status === 'active' ? 'paused' : 'active';
		try {
			const res = await fetch(`/api/email/accounts/${account.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: newStatus })
			});
			if (!res.ok) throw new Error('Failed to update status');
			await loadAccounts();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update status';
		}
	}

	// Test connection
	async function testConnection(id: string) {
		testingId = id;
		testResult = null;
		error = null;
		try {
			const res = await fetch(`/api/email/accounts/${id}/test`, { method: 'POST' });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Test failed');
			testResult = data;
			await loadAccounts();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Connection test failed';
		} finally {
			testingId = null;
		}
	}

	// Save settings
	async function saveSettings() {
		settingsSaving = true;
		error = null;
		try {
			const res = await fetch('/api/email/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(settings)
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Failed to save settings');
			successMsg = 'Settings saved';
			setTimeout(() => (successMsg = null), 3000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save settings';
		} finally {
			settingsSaving = false;
		}
	}

	function providerLabel(type: string) {
		if (type === 'google') return 'Google Workspace';
		if (type === 'microsoft') return 'Microsoft 365';
		return 'SMTP / IMAP';
	}

	function statusColor(status: string) {
		if (status === 'active') return 'bg-green-100 text-green-800';
		if (status === 'paused') return 'bg-yellow-100 text-yellow-800';
		return 'bg-red-100 text-red-800';
	}

	function formatDate(s: string | null) {
		if (!s) return 'Never';
		return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	$effect(() => {
		if (!loaded) load();
	});
</script>

<svelte:head>
	<title>Email – ProfitBot</title>
</svelte:head>

<div class="max-w-4xl mx-auto">
	<h1 class="text-2xl font-bold text-gray-900">Email</h1>
	<p class="text-gray-500 mt-1 mb-6">Manage your outreach email accounts and sending settings.</p>

	{#if error}
		<div class="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
			{error}
			<button type="button" onclick={() => (error = null)} class="ml-2 text-red-600 hover:text-red-800 font-medium">&times;</button>
		</div>
	{/if}

	{#if successMsg}
		<div class="mb-4 p-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
			{successMsg}
		</div>
	{/if}

	{#if testResult}
		<div class="mb-4 p-4 rounded-lg border text-sm {testResult.smtp.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}">
			<strong>SMTP Test:</strong>
			{testResult.smtp.success ? 'Connection successful!' : `Failed – ${testResult.smtp.error ?? 'Unknown error'}`}
			<button type="button" onclick={() => (testResult = null)} class="ml-2 font-medium">&times;</button>
		</div>
	{/if}

	<!-- Tabs -->
	<div class="flex gap-1 mb-6 border-b border-gray-200">
		<button
			type="button"
			onclick={() => (activeTab = 'accounts')}
			class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px {activeTab === 'accounts' ? 'border-amber-600 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}"
		>
			Accounts
			{#if accounts.length > 0}
				<span class="ml-1.5 inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full text-xs font-medium {activeTab === 'accounts' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}">{accounts.length}</span>
			{/if}
		</button>
		<button
			type="button"
			onclick={() => (activeTab = 'settings')}
			class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px {activeTab === 'settings' ? 'border-amber-600 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}"
		>
			Settings
		</button>
	</div>

	{#if !loaded}
		<div class="text-gray-500">Loading…</div>
	{:else if activeTab === 'accounts'}
		<!-- ACCOUNTS TAB -->
		<div class="flex items-center justify-between gap-4 mb-6">
			<span class="text-sm text-gray-500">{accounts.length} account{accounts.length === 1 ? '' : 's'} connected</span>
			<button
				type="button"
				onclick={openAddModal}
				class="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors"
			>
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
				Add email account
			</button>
		</div>

		{#if accounts.length === 0}
			<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
				<div class="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-50 flex items-center justify-center">
					<svg class="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
				</div>
				<p class="text-gray-900 font-medium mb-1">No email accounts connected</p>
				<p class="text-gray-500 text-sm mb-4">Connect your email accounts to start cold outreach campaigns. We support Gmail, Outlook, and any SMTP/IMAP provider.</p>
				<button
					type="button"
					onclick={openAddModal}
					class="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700"
				>
					Add your first account
				</button>
			</div>
		{:else}
			<div class="space-y-3">
				{#each accounts as account}
					<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:border-gray-300 transition-colors">
						<div class="flex items-start gap-4">
							<!-- Provider icon -->
							<div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 {account.provider_type === 'google' ? 'bg-red-50' : account.provider_type === 'microsoft' ? 'bg-blue-50' : 'bg-gray-100'}">
								{#if account.provider_type === 'google'}
									<svg class="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
								{:else if account.provider_type === 'microsoft'}
									<svg class="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="currentColor"><path d="M11.4 1H1v10.4h10.4V1zM23 1H12.6v10.4H23V1zM11.4 12.6H1V23h10.4V12.6zM23 12.6H12.6V23H23V12.6z"/></svg>
								{:else}
									<svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
								{/if}
							</div>

							<!-- Info -->
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 flex-wrap">
									<p class="font-medium text-gray-900 truncate">{account.email_address}</p>
									<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium {statusColor(account.status)}">
										{#if account.status === 'active'}
											<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
										{:else if account.status === 'error'}
											<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>
										{:else}
											<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>
										{/if}
										{account.status}
									</span>
								</div>
								<div class="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
									<span>{providerLabel(account.provider_type)}</span>
									<span class="text-gray-300">|</span>
									<span>Daily limit: {account.daily_send_limit}</span>
									<span class="text-gray-300">|</span>
									<span class="inline-flex items-center gap-1">
										{#if account.warmup_enabled}
											<span class="text-orange-500">🔥</span> Warmup: {account.daily_warmup_limit}/day
										{:else}
											Warmup: Off
										{/if}
									</span>
									{#if account.display_name}
										<span class="text-gray-300">|</span>
										<span>Name: {account.display_name}</span>
									{/if}
								</div>
								{#if account.last_error}
									<p class="mt-1 text-xs text-red-600 truncate" title={account.last_error}>Error: {account.last_error}</p>
								{/if}
								{#if account.last_connected_at}
									<p class="mt-0.5 text-xs text-gray-400">Last tested: {formatDate(account.last_connected_at)}</p>
								{/if}
							</div>

							<!-- Actions -->
							<div class="flex items-center gap-2 shrink-0">
								<button
									type="button"
									disabled={testingId === account.id}
									onclick={() => testConnection(account.id)}
									class="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
									title="Test SMTP connection"
								>
									{testingId === account.id ? 'Testing…' : 'Test'}
								</button>
								<button
									type="button"
									onclick={() => toggleStatus(account)}
									class="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors {account.status === 'active' ? 'border-yellow-300 text-yellow-700 hover:bg-yellow-50' : 'border-green-300 text-green-700 hover:bg-green-50'}"
									title={account.status === 'active' ? 'Pause this account' : 'Activate this account'}
								>
									{account.status === 'active' ? 'Pause' : 'Activate'}
								</button>
								<button
									type="button"
									onclick={() => openEditModal(account)}
									class="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
								>
									Edit
								</button>
								{#if deleteConfirmId === account.id}
									<button
										type="button"
										disabled={deletingId === account.id}
										onclick={() => deleteAccount(account.id)}
										class="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
									>
										{deletingId === account.id ? 'Deleting…' : 'Confirm'}
									</button>
									<button
										type="button"
										onclick={() => (deleteConfirmId = null)}
										class="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
									>
										Cancel
									</button>
								{:else}
									<button
										type="button"
										onclick={() => (deleteConfirmId = account.id)}
										class="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
									>
										Delete
									</button>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}

	{:else}
		<!-- SETTINGS TAB -->
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h2 class="text-lg font-semibold text-gray-900 mb-1">Global Outreach Settings</h2>
			<p class="text-sm text-gray-500 mb-6">These defaults apply to all email accounts and campaigns. Individual account settings can override these.</p>

			<div class="space-y-5">
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1 block">Default daily send limit (per account)</span>
						<p class="text-xs text-gray-400 mb-1">Max campaign emails per account per day. Recommended: 20–50.</p>
						<input
							type="number"
							min="1"
							max="1000"
							bind:value={settings.default_daily_send_limit}
							class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
						/>
					</label>
					<div></div>
				</div>

				<div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1 block">Min delay between emails (minutes)</span>
						<p class="text-xs text-gray-400 mb-1">Base minimum gap between sending from the same account.</p>
						<input
							type="number"
							min="0"
							max="60"
							bind:value={settings.min_delay_minutes}
							class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
						/>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1 block">Random additional delay (minutes)</span>
						<p class="text-xs text-gray-400 mb-1">Random jitter added to min delay to look more human.</p>
						<input
							type="number"
							min="0"
							max="60"
							bind:value={settings.random_delay_minutes}
							class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
						/>
					</label>
				</div>

				<div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1 block">Bounce threshold (%)</span>
						<p class="text-xs text-gray-400 mb-1">Auto-pause account if bounce rate exceeds this. Recommended: 2–5%.</p>
						<input
							type="number"
							min="0"
							max="100"
							step="0.1"
							bind:value={settings.bounce_threshold_pct}
							class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
						/>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1 block">Spam complaint threshold (%)</span>
						<p class="text-xs text-gray-400 mb-1">Auto-pause account if spam complaints exceed this. Recommended: 0.1–0.3%.</p>
						<input
							type="number"
							min="0"
							max="100"
							step="0.1"
							bind:value={settings.spam_complaint_threshold_pct}
							class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
						/>
					</label>
				</div>

				<div class="pt-4 border-t border-gray-100">
					<button
						type="button"
						disabled={settingsSaving}
						onclick={saveSettings}
						class="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors text-sm"
					>
						{settingsSaving ? 'Saving…' : 'Save settings'}
					</button>
				</div>
			</div>
		</div>

		<!-- Sending strategy info -->
		<div class="mt-6 bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h3 class="text-base font-semibold text-gray-900 mb-3">Cold Outreach Strategy Tips</h3>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
				<div class="p-3 rounded-lg bg-blue-50 border border-blue-100">
					<p class="font-medium text-blue-900 mb-1">Account Rotation</p>
					<p class="text-blue-700 text-xs">Use multiple accounts and rotate sends across them. This distributes volume and protects deliverability.</p>
				</div>
				<div class="p-3 rounded-lg bg-green-50 border border-green-100">
					<p class="font-medium text-green-900 mb-1">Daily Limits</p>
					<p class="text-green-700 text-xs">Keep each account to 20–50 campaign emails/day. Use more accounts to scale volume instead of increasing limits.</p>
				</div>
				<div class="p-3 rounded-lg bg-orange-50 border border-orange-100">
					<p class="font-medium text-orange-900 mb-1">Warmup First</p>
					<p class="text-orange-700 text-xs">Enable warmup on new accounts for 2+ weeks before launching campaigns. This builds sender reputation.</p>
				</div>
				<div class="p-3 rounded-lg bg-purple-50 border border-purple-100">
					<p class="font-medium text-purple-900 mb-1">Email Delays</p>
					<p class="text-purple-700 text-xs">Use 3–5 min base delay + 5 min random jitter between sends. This mimics natural human behavior.</p>
				</div>
			</div>
		</div>
	{/if}
</div>

<!-- ADD / EDIT ACCOUNT MODAL -->
{#if showModal}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
		onkeydown={(e) => e.key === 'Escape' && (showModal = false)}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="absolute inset-0" onclick={() => (showModal = false)}></div>
		<div class="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
			<!-- Header -->
			<div class="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
				<h2 class="text-lg font-semibold text-gray-900">
					{editingId ? 'Edit email account' : 'Add email account'}
				</h2>
				<button type="button" onclick={() => (showModal = false)} class="text-gray-400 hover:text-gray-600 transition-colors">
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
				</button>
			</div>

			<div class="px-6 py-5 space-y-6">
				{#if modalStep === 'provider' && !editingId}
					<!-- Provider selection -->
					<div>
						<p class="text-sm font-medium text-gray-700 mb-3">Choose your email provider</p>
						<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
							<!-- Google -->
							<button
								type="button"
								onclick={() => selectProvider('google')}
								class="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-gray-200 hover:border-amber-400 hover:bg-amber-50 transition-colors text-center"
							>
								<div class="w-12 h-12 rounded-lg bg-red-50 flex items-center justify-center">
									<svg class="w-7 h-7 text-red-500" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
								</div>
								<span class="text-sm font-medium text-gray-900">Google</span>
								<span class="text-xs text-gray-500">Gmail / G-Suite</span>
							</button>

							<!-- Microsoft -->
							<button
								type="button"
								onclick={() => selectProvider('microsoft')}
								class="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-gray-200 hover:border-amber-400 hover:bg-amber-50 transition-colors text-center"
							>
								<div class="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center">
									<svg class="w-7 h-7 text-blue-600" viewBox="0 0 24 24" fill="currentColor"><path d="M11.4 1H1v10.4h10.4V1zM23 1H12.6v10.4H23V1zM11.4 12.6H1V23h10.4V12.6zM23 12.6H12.6V23H23V12.6z"/></svg>
								</div>
								<span class="text-sm font-medium text-gray-900">Microsoft</span>
								<span class="text-xs text-gray-500">Office 365 / Outlook</span>
							</button>

							<!-- SMTP -->
							<button
								type="button"
								onclick={() => selectProvider('smtp')}
								class="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-gray-200 hover:border-amber-400 hover:bg-amber-50 transition-colors text-center"
							>
								<div class="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
									<svg class="w-7 h-7 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
								</div>
								<span class="text-sm font-medium text-gray-900">Any Provider</span>
								<span class="text-xs text-gray-500">IMAP / SMTP</span>
							</button>
						</div>
					</div>
				{:else}
					<!-- Detail form -->
					{#if !editingId}
						<button
							type="button"
							onclick={() => (modalStep = 'provider')}
							class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
							Change provider
						</button>
					{/if}

					<!-- Provider badge -->
					<div class="flex items-center gap-2 mb-1">
						<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium {formProvider === 'google' ? 'bg-red-50 text-red-700' : formProvider === 'microsoft' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-700'}">
							{providerLabel(formProvider)}
						</span>
						{#if formProvider !== 'smtp'}
							<span class="text-xs text-amber-600 font-medium">OAuth coming soon – use app password for now</span>
						{/if}
					</div>

					{#if error}
						<div class="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">{error}</div>
					{/if}

					<!-- Email & identity -->
					<div class="space-y-4">
						<h3 class="text-sm font-semibold text-gray-800 uppercase tracking-wider">Account Details</h3>
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<label class="block">
								<span class="text-sm font-medium text-gray-700 mb-1 block">Email address <span class="text-red-500">*</span></span>
								<input
									type="email"
									placeholder="you@domain.com"
									bind:value={formEmail}
									class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
								/>
							</label>
							<label class="block">
								<span class="text-sm font-medium text-gray-700 mb-1 block">Display name</span>
								<input
									type="text"
									placeholder="John Smith"
									bind:value={formDisplayName}
									class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
								/>
							</label>
						</div>
						<label class="block">
							<span class="text-sm font-medium text-gray-700 mb-1 block">Reply-to address (optional)</span>
							<input
								type="email"
								placeholder="replies@domain.com"
								bind:value={formReplyTo}
								class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
							/>
						</label>
					</div>

					<!-- SMTP settings -->
					<div class="space-y-4">
						<h3 class="text-sm font-semibold text-gray-800 uppercase tracking-wider">SMTP (Outgoing) <span class="text-red-500">*</span></h3>
						<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
							<label class="block col-span-2">
								<span class="text-xs font-medium text-gray-600 mb-1 block">Host</span>
								<input
									type="text"
									placeholder="smtp.example.com"
									bind:value={formSmtpHost}
									class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
								/>
							</label>
							<label class="block">
								<span class="text-xs font-medium text-gray-600 mb-1 block">Port</span>
								<input
									type="number"
									bind:value={formSmtpPort}
									class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
								/>
							</label>
							<label class="flex items-center gap-2 self-end pb-2">
								<input type="checkbox" bind:checked={formSmtpSecure} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
								<span class="text-xs font-medium text-gray-600">SSL/TLS</span>
							</label>
						</div>
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
							<label class="block">
								<span class="text-xs font-medium text-gray-600 mb-1 block">Username</span>
								<input
									type="text"
									placeholder={formEmail || 'you@domain.com'}
									bind:value={formSmtpUsername}
									class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
								/>
							</label>
							<label class="block">
								<span class="text-xs font-medium text-gray-600 mb-1 block">Password {editingId ? '(leave empty to keep current)' : ''}</span>
								<input
									type="password"
									autocomplete="new-password"
									placeholder={editingId ? '••••••••' : 'App password or SMTP password'}
									bind:value={formSmtpPassword}
									class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
								/>
							</label>
						</div>
					</div>

					<!-- IMAP settings -->
					<div class="space-y-4">
						<h3 class="text-sm font-semibold text-gray-800 uppercase tracking-wider">IMAP (Incoming)</h3>
						<p class="text-xs text-gray-500 -mt-2">Required for reply detection, bounce tracking, and warmup.</p>
						<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
							<label class="block col-span-2">
								<span class="text-xs font-medium text-gray-600 mb-1 block">Host</span>
								<input
									type="text"
									placeholder="imap.example.com"
									bind:value={formImapHost}
									class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
								/>
							</label>
							<label class="block">
								<span class="text-xs font-medium text-gray-600 mb-1 block">Port</span>
								<input
									type="number"
									bind:value={formImapPort}
									class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
								/>
							</label>
							<label class="flex items-center gap-2 self-end pb-2">
								<input type="checkbox" bind:checked={formImapSecure} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
								<span class="text-xs font-medium text-gray-600">SSL/TLS</span>
							</label>
						</div>
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
							<label class="block">
								<span class="text-xs font-medium text-gray-600 mb-1 block">Username</span>
								<input
									type="text"
									placeholder={formEmail || 'you@domain.com'}
									bind:value={formImapUsername}
									class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
								/>
							</label>
							<label class="block">
								<span class="text-xs font-medium text-gray-600 mb-1 block">Password {editingId ? '(leave empty to keep current)' : ''}</span>
								<input
									type="password"
									autocomplete="new-password"
									placeholder={editingId ? '••••••••' : 'App password or IMAP password'}
									bind:value={formImapPassword}
									class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
								/>
							</label>
						</div>
					</div>

					<!-- Sending settings -->
					<div class="space-y-4">
						<h3 class="text-sm font-semibold text-gray-800 uppercase tracking-wider">Sending Settings</h3>
						<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
							<label class="block">
								<span class="text-xs font-medium text-gray-600 mb-1 block">Daily send limit</span>
								<input
									type="number"
									min="1"
									max="1000"
									bind:value={formDailyLimit}
									class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
								/>
							</label>
							<label class="flex items-center gap-2 self-end pb-2">
								<input type="checkbox" bind:checked={formWarmupEnabled} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
								<span class="text-sm font-medium text-gray-700">Enable warmup</span>
							</label>
							{#if formWarmupEnabled}
								<label class="block">
									<span class="text-xs font-medium text-gray-600 mb-1 block">Daily warmup limit</span>
									<input
										type="number"
										min="1"
										max="100"
										bind:value={formWarmupLimit}
										class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
									/>
								</label>
							{/if}
						</div>
					</div>

					<!-- Signature -->
					<div class="space-y-2">
						<h3 class="text-sm font-semibold text-gray-800 uppercase tracking-wider">Email Signature</h3>
						<p class="text-xs text-gray-500">HTML signature appended to outgoing emails from this account.</p>
						<textarea
							rows="4"
							placeholder="<p>Best regards,<br>John Smith</p>"
							bind:value={formSignature}
							class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
						></textarea>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			{#if modalStep === 'details' || editingId}
				<div class="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 rounded-b-2xl flex items-center justify-end gap-3">
					<button
						type="button"
						onclick={() => (showModal = false)}
						class="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={saving}
						onclick={saveAccount}
						class="px-6 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors text-sm"
					>
						{saving ? 'Saving…' : editingId ? 'Update account' : 'Add account'}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
