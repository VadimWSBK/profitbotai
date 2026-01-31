<script lang="ts">
	import { INTEGRATIONS } from '$lib/integrations';

	let connected = $state<string[]>([]);
	let loaded = $state(false);
	let saving = $state(false);
	let disconnecting = $state<string | null>(null);
	let formValues = $state<Record<string, string>>({});
	let error = $state<string | null>(null);

	async function load() {
		try {
			const res = await fetch('/api/settings/integrations');
			const data = await res.json().catch(() => ({}));
			connected = data.connected ?? [];
		} catch {
			connected = [];
		} finally {
			loaded = true;
		}
	}

	async function connect(id: string) {
		saving = true;
		error = null;
		try {
			const apiKey = formValues[`${id}_apiKey`]?.trim();
			if (!apiKey) {
				error = 'Please enter your API key';
				return;
			}
			const res = await fetch('/api/settings/integrations', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: id, config: { apiKey } })
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Failed to connect');
			await load();
			formValues = { ...formValues, [`${id}_apiKey`]: '' };
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to connect';
		} finally {
			saving = false;
		}
	}

	async function disconnect(id: string) {
		disconnecting = id;
		error = null;
		try {
			const res = await fetch(`/api/settings/integrations/${id}`, { method: 'DELETE' });
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Failed to disconnect');
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to disconnect';
		} finally {
			disconnecting = null;
		}
	}

	$effect(() => {
		if (!loaded) load();
	});
</script>

<svelte:head>
	<title>Integrations – ProfitBot</title>
</svelte:head>

<div class="max-w-2xl mx-auto">
	<h1 class="text-2xl font-bold text-gray-900">Integrations</h1>
	<p class="text-gray-500 mt-1 mb-8">Connect third-party services to send emails and more.</p>

	{#if error}
		<div class="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
			{error}
		</div>
	{/if}

	{#if !loaded}
		<div class="text-gray-500">Loading…</div>
	{:else}
		<div class="space-y-6">
			{#each INTEGRATIONS as integration}
				{@const isConnected = connected.includes(integration.id)}
				<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
					<div class="flex items-start gap-4">
						<div class="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
							{#if integration.icon === 'mail'}
								<svg class="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
								</svg>
							{:else}
								<svg class="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
								</svg>
							{/if}
						</div>
						<div class="flex-1 min-w-0">
							<h2 class="text-lg font-semibold text-gray-900">{integration.name}</h2>
							<p class="text-gray-500 text-sm mt-1">{integration.description}</p>

							{#if isConnected}
								<div class="mt-4 flex items-center gap-3">
									<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
										<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
											<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
										</svg>
										Connected
									</span>
									<button
										type="button"
										disabled={disconnecting === integration.id}
										onclick={() => disconnect(integration.id)}
										class="text-sm text-red-600 hover:text-red-700 disabled:opacity-60"
									>
										{disconnecting === integration.id ? 'Disconnecting…' : 'Disconnect'}
									</button>
								</div>
							{:else}
								<div class="mt-4 space-y-3">
									{#each integration.configFields as field}
										{@const fieldKey = `${integration.id}_${field.id}`}
										<label class="block">
											<span class="text-sm font-medium text-gray-700 mb-1">{field.label}</span>
											<input
												type={field.type}
												autocomplete="off"
												placeholder={field.placeholder}
												bind:value={formValues[fieldKey]}
												class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
											/>
										</label>
									{/each}
									{#if integration.id === 'resend'}
										<p class="text-xs text-gray-400">
											Get your Resend API key from <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer" class="text-amber-600 hover:underline">resend.com/api-keys</a>
										</p>
									{/if}
									<button
										type="button"
										disabled={saving}
										onclick={() => connect(integration.id)}
										class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors text-sm"
									>
										{saving ? 'Connecting…' : 'Connect'}
									</button>
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>

		<p class="mt-8 text-sm text-gray-400">More integrations coming soon.</p>
	{/if}
</div>
