<script lang="ts">
	import { INTEGRATIONS } from '$lib/integrations';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';

	let connected = $state<string[]>([]);
	let configs = $state<Record<string, { fromEmail?: string; shopDomain?: string; apiVersion?: string; emailFooter?: { logoUrl?: string; websiteUrl?: string; websiteText?: string; phone?: string; email?: string } }>>({});
	let loaded = $state(false);
	let saving = $state(false);
	let disconnecting = $state<string | null>(null);
	let formValues = $state<Record<string, string>>({});
	let error = $state<string | null>(null);
	// Resend test email
	let testEmailTo = $state('');
	let testEmailSending = $state(false);
	let testEmailSuccess = $state(false);
	let testEmailError = $state<string | null>(null);
	// Resend from-email update (when already connected)
	let resendFromEmail = $state('');
	let resendFromEmailSaving = $state(false);
	// Email footer configuration
	let emailFooterLogoUrl = $state('');
	let emailFooterWebsiteUrl = $state('');
	let emailFooterWebsiteText = $state('');
	let emailFooterPhone = $state('');
	let emailFooterEmail = $state('');
	let emailFooterSaving = $state(false);
	// Logo upload
	let logoFileInput = $state<HTMLInputElement | undefined>(undefined);
	let logoUploading = $state(false);
	let logoUploadError = $state<string | null>(null);
	let logoPreviewUrl = $state<string | null>(null);
	// Sync received emails
	let syncReceivedLoading = $state(false);
	let syncReceivedResult = $state<{ synced: number; skipped: number } | null>(null);
	// Shopify OAuth
	let shopifyShopDomain = $state('');
	let shopifyConnecting = $state(false);

	async function load() {
		try {
			const res = await fetch('/api/settings/integrations');
			const data = await res.json().catch(() => ({}));
			connected = data.connected ?? [];
			configs = data.configs ?? {};
			resendFromEmail = configs.resend?.fromEmail ?? '';
			const footer = configs.resend?.emailFooter ?? {};
			emailFooterLogoUrl = footer.logoUrl ?? '';
			emailFooterWebsiteUrl = footer.websiteUrl ?? '';
			emailFooterWebsiteText = footer.websiteText ?? '';
			emailFooterPhone = footer.phone ?? '';
			emailFooterEmail = footer.email ?? '';
			// Set logoPreviewUrl from saved logo URL, or preserve existing preview if URL matches
			if (emailFooterLogoUrl) {
				logoPreviewUrl = emailFooterLogoUrl;
			} else if (!logoPreviewUrl) {
				// Only clear preview if we don't have a logo URL and no existing preview
				logoPreviewUrl = null;
			}
		} catch {
			connected = [];
			configs = {};
		} finally {
			loaded = true;
		}
	}

	function connectShopifyOAuth() {
		const shop = shopifyShopDomain.trim().toLowerCase();
		if (!shop) {
			error = 'Enter your shop domain (e.g. your-store.myshopify.com)';
			return;
		}
		shopifyConnecting = true;
		error = null;
		const shopParam = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
		window.location.href = `/api/settings/integrations/shopify/connect?shop=${encodeURIComponent(shopParam)}`;
	}

	function getFieldValue(id: string, fieldId: string) {
		return formValues[`${id}_${fieldId}`]?.trim() ?? '';
	}

	async function connect(id: string) {
		saving = true;
		error = null;
		try {
			if (id === 'resend') {
				const apiKey = getFieldValue(id, 'apiKey');
				const fromEmail = getFieldValue(id, 'fromEmail');
				if (!apiKey) {
					error = 'Please enter your Resend API key';
					return;
				}
				const res = await fetch('/api/settings/integrations', {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						type: id,
						config: { apiKey, fromEmail: fromEmail || undefined }
					})
				});
				const result = await res.json().catch(() => ({}));
				if (!res.ok) throw new Error(result.error || 'Failed to connect');
			} else if (id === 'shopify') {
				// Shopify uses OAuth – connect() is not used; connectShopifyOAuth() handles it
				return;
			} else {
				const apiKey = getFieldValue(id, 'apiKey');
				if (!apiKey) {
					error = 'Please enter your API key';
					return;
				}
				const res = await fetch('/api/settings/integrations', {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						type: id,
						config: { apiKey }
					})
				});
				const result = await res.json().catch(() => ({}));
				if (!res.ok) throw new Error(result.error || 'Failed to connect');
			}
			await load();
			formValues = {
				...formValues,
				[`${id}_apiKey`]: '',
				[`${id}_fromEmail`]: '',
				[`${id}_accessToken`]: '',
				[`${id}_shopDomain`]: '',
				[`${id}_apiVersion`]: ''
			};
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to connect';
		} finally {
			saving = false;
		}
	}

	async function updateResendFromEmail() {
		const email = resendFromEmail.trim();
		resendFromEmailSaving = true;
		error = null;
		try {
			const res = await fetch('/api/settings/integrations', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: 'resend', config: { fromEmail: email || undefined } })
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Failed to update');
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update';
		} finally {
			resendFromEmailSaving = false;
		}
	}

	async function uploadLogo() {
		if (!logoFileInput) {
			logoUploadError = 'File input not available';
			return;
		}
		const file = logoFileInput.files?.[0];
		if (!file) {
			logoUploadError = 'Please select a file';
			return;
		}
		
		// Validate file size (2MB max)
		if (file.size > 2 * 1024 * 1024) {
			logoUploadError = 'File too large (max 2MB)';
			return;
		}
		
		// Validate file type
		const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
		if (!allowedTypes.includes(file.type)) {
			logoUploadError = 'Invalid file type. Use PNG, JPEG, GIF, WebP, or SVG.';
			return;
		}
		
		logoUploading = true;
		logoUploadError = null;
		
		try {
			const formData = new FormData();
			formData.append('file', file);
			
			const res = await fetch('/api/settings/integrations/resend/upload-logo', {
				method: 'POST',
				body: formData
			});
			
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data.error || 'Upload failed');
			}
			
			const uploadedUrl = data.url || '';
			emailFooterLogoUrl = uploadedUrl;
			logoPreviewUrl = uploadedUrl || null;
			
			// Auto-save the footer with the new logo URL
			await updateEmailFooter();
			
			// Ensure logoPreviewUrl is preserved after load() runs in updateEmailFooter()
			if (uploadedUrl) {
				logoPreviewUrl = uploadedUrl;
			}
		} catch (e) {
			logoUploadError = e instanceof Error ? e.message : 'Failed to upload logo';
		} finally {
			logoUploading = false;
		}
	}
	
	function handleLogoFileChange() {
		const file = logoFileInput?.files?.[0];
		if (file) {
			// Create preview
			const reader = new FileReader();
			reader.onload = (e) => {
				logoPreviewUrl = e.target?.result as string || null;
			};
			reader.readAsDataURL(file);
		}
	}
	
	async function updateEmailFooter() {
		emailFooterSaving = true;
		error = null;
		// Preserve logoPreviewUrl before load() resets it
		const currentLogoPreview = logoPreviewUrl;
		const currentLogoUrl = emailFooterLogoUrl;
		try {
			const footer = {
				logoUrl: emailFooterLogoUrl.trim() || undefined,
				websiteUrl: emailFooterWebsiteUrl.trim() || undefined,
				websiteText: emailFooterWebsiteText.trim() || undefined,
				phone: emailFooterPhone.trim() || undefined,
				email: emailFooterEmail.trim() || undefined
			};
			const res = await fetch('/api/settings/integrations', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: 'resend', config: { emailFooter: footer } })
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Failed to update footer');
			await load();
			// Restore logoPreviewUrl if it was set and still matches the logo URL
			if (currentLogoPreview && currentLogoUrl && emailFooterLogoUrl === currentLogoUrl) {
				logoPreviewUrl = currentLogoPreview;
			} else if (emailFooterLogoUrl && !logoPreviewUrl) {
				// If we have a logo URL but no preview, set it
				logoPreviewUrl = emailFooterLogoUrl;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update footer';
		} finally {
			emailFooterSaving = false;
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

	async function syncReceivedEmails() {
		syncReceivedLoading = true;
		syncReceivedResult = null;
		error = null;
		try {
			const res = await fetch('/api/settings/integrations/resend/sync-received', {
				method: 'POST'
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				error = (data.error as string) ?? 'Failed to sync received emails';
				return;
			}
			syncReceivedResult = { synced: data.synced ?? 0, skipped: data.skipped ?? 0 };
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to sync received emails';
		} finally {
			syncReceivedLoading = false;
		}
	}

	async function sendTestEmail() {
		const email = testEmailTo.trim().toLowerCase();
		if (!email) {
			testEmailError = 'Enter an email address';
			return;
		}
		testEmailSending = true;
		testEmailError = null;
		testEmailSuccess = false;
		try {
			const res = await fetch('/api/settings/integrations/resend/test-email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ toEmail: email })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				testEmailError = (data.error as string) ?? 'Failed to send test email';
				return;
			}
			testEmailSuccess = true;
		} catch (e) {
			testEmailError = e instanceof Error ? e.message : 'Failed to send test email';
		} finally {
			testEmailSending = false;
		}
	}

	$effect(() => {
		if (!loaded) load();
	});

	// Handle OAuth callback params
	$effect(() => {
		const params = $page.url.searchParams;
		const err = params.get('error');
		const shopify = params.get('shopify');
		if (err) {
			const messages: Record<string, string> = {
				shop_required: 'Shop domain is required.',
				invalid_shop: 'Invalid shop domain. Use your-store.myshopify.com',
				shopify_oauth_failed: 'Shopify authorization failed or was cancelled.',
				shopify_not_configured: 'Shopify integration is not configured.',
				shopify_token_exchange_failed: 'Failed to complete Shopify connection.',
				shopify_no_token: 'Shopify did not return an access token.',
				shopify_save_failed: 'Failed to save Shopify connection.'
			};
			error = messages[err] ?? 'An error occurred.';
			goto('/integrations', { replaceState: true });
		}
		if (shopify === 'connected') {
			error = null;
			load();
			goto('/integrations', { replaceState: true });
		}
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
							{:else if integration.icon === 'bolt'}
								<svg class="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>
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
								<div class="mt-4 space-y-4">
									<div class="flex items-center gap-3">
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
									{#if integration.id === 'resend'}
										<div class="pt-3 border-t border-gray-100 space-y-4">
											<div>
												<p class="text-sm font-medium text-gray-700 mb-1">From email (for quote emails to customers)</p>
												<p class="text-xs text-gray-500 mb-2">Must be an address on your verified Resend domain (e.g. quotes@rs.netzerocoating.com). Required to send to customers.</p>
												<div class="flex flex-wrap items-end gap-2">
													<input
														type="email"
														placeholder="quotes@rs.yourdomain.com"
														bind:value={resendFromEmail}
														disabled={resendFromEmailSaving}
														class="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-60"
													/>
													<button
														type="button"
														disabled={resendFromEmailSaving}
														onclick={updateResendFromEmail}
														class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors text-sm"
													>
														{resendFromEmailSaving ? 'Saving…' : 'Save'}
													</button>
												</div>
											</div>
											<div>
												<p class="text-sm font-medium text-gray-700 mb-2">Received emails</p>
												<p class="text-xs text-gray-500 mb-2">Sync emails sent to your inbox (replies to quotes, etc.) into Messages. Enable Inbound in Resend and add the <code class="text-xs bg-gray-100 px-1 rounded">email.received</code> webhook event for real-time updates.</p>
												<div class="flex flex-wrap items-center gap-2">
													<button
														type="button"
														disabled={syncReceivedLoading}
														onclick={syncReceivedEmails}
														class="px-4 py-2 bg-gray-700 hover:bg-gray-800 disabled:opacity-60 text-white font-medium rounded-lg transition-colors text-sm"
													>
														{syncReceivedLoading ? 'Syncing…' : 'Sync received emails'}
													</button>
													{#if syncReceivedResult}
														<span class="text-sm text-gray-500">
															{syncReceivedResult.synced} synced, {syncReceivedResult.skipped} skipped
														</span>
													{/if}
												</div>
											</div>
											<div>
												<p class="text-sm font-medium text-gray-700 mb-2">Send test email</p>
												<div class="flex flex-wrap items-end gap-2">
													<label class="flex-1 min-w-[200px]">
														<span class="sr-only">Email address</span>
														<input
															type="email"
															placeholder="you@example.com"
															bind:value={testEmailTo}
															disabled={testEmailSending}
															class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-60"
														/>
													</label>
													<button
														type="button"
														disabled={testEmailSending}
														onclick={sendTestEmail}
														class="px-4 py-2 bg-gray-800 hover:bg-gray-900 disabled:opacity-60 text-white font-medium rounded-lg transition-colors text-sm"
													>
														{testEmailSending ? 'Sending…' : 'Send test email'}
													</button>
												</div>
												{#if testEmailError}
													<p class="mt-1.5 text-sm text-red-600">{testEmailError}</p>
												{/if}
												{#if testEmailSuccess}
													<p class="mt-1.5 text-sm text-green-600">Test email sent. Check the inbox for {testEmailTo || 'that address'}.</p>
												{/if}
											</div>
											<div class="pt-3 border-t border-gray-200">
												<p class="text-sm font-medium text-gray-700 mb-1">Email footer</p>
												<p class="text-xs text-gray-500 mb-3">Customize the footer that appears at the bottom of all emails. Add your logo, website link, phone, and email for a professional look.</p>
												<div class="space-y-3">
													<div>
														<div class="block mb-1">
															<label for="logo-upload" class="text-xs font-medium text-gray-600">Logo</label>
															<p class="text-xs text-gray-500 mt-0.5">Recommended: 200x40px or similar aspect ratio. Max 2MB. PNG, JPEG, GIF, WebP, or SVG.</p>
														</div>
														<div class="flex flex-col sm:flex-row gap-3 items-start">
															<div class="flex-1">
																<input
																	id="logo-upload"
																	type="file"
																	accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
																	bind:this={logoFileInput}
																	onchange={handleLogoFileChange}
																	disabled={logoUploading || emailFooterSaving}
																	class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-60 file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100"
																/>
																{#if logoUploadError}
																	<p class="mt-1 text-xs text-red-600">{logoUploadError}</p>
																{/if}
															</div>
															<button
																type="button"
																disabled={logoUploading || emailFooterSaving || !logoFileInput?.files?.length}
																onclick={uploadLogo}
																class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors text-sm whitespace-nowrap"
															>
																{logoUploading ? 'Uploading…' : 'Upload logo'}
															</button>
														</div>
														{#if logoPreviewUrl}
															<div class="mt-2 p-2 border border-gray-200 rounded-lg bg-gray-50">
																<p class="text-xs text-gray-600 mb-1">Preview:</p>
																<img src={logoPreviewUrl} alt="Logo preview" class="max-h-10 w-auto" />
															</div>
														{/if}
														{#if emailFooterLogoUrl && !logoPreviewUrl}
															<div class="mt-2 p-2 border border-gray-200 rounded-lg bg-gray-50">
																<p class="text-xs text-gray-600 mb-1">Current logo:</p>
																<img src={emailFooterLogoUrl} alt="Current logo" class="max-h-10 w-auto" />
															</div>
														{/if}
													</div>
													<div class="grid grid-cols-2 gap-3">
														<label class="block">
															<span class="text-xs font-medium text-gray-600 mb-1 block">Website URL</span>
															<input
																type="url"
																placeholder="https://example.com"
																bind:value={emailFooterWebsiteUrl}
																disabled={emailFooterSaving}
																class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-60"
															/>
														</label>
														<label class="block">
															<span class="text-xs font-medium text-gray-600 mb-1 block">Website text (optional)</span>
															<input
																type="text"
																placeholder="Visit our website"
																bind:value={emailFooterWebsiteText}
																disabled={emailFooterSaving}
																class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-60"
															/>
														</label>
													</div>
													<div class="grid grid-cols-2 gap-3">
														<label class="block">
															<span class="text-xs font-medium text-gray-600 mb-1 block">Phone</span>
															<input
																type="tel"
																placeholder="+1 234 567 8900"
																bind:value={emailFooterPhone}
																disabled={emailFooterSaving}
																class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-60"
															/>
														</label>
														<label class="block">
															<span class="text-xs font-medium text-gray-600 mb-1 block">Email</span>
															<input
																type="email"
																placeholder="contact@example.com"
																bind:value={emailFooterEmail}
																disabled={emailFooterSaving}
																class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-60"
															/>
														</label>
													</div>
													<button
														type="button"
														disabled={emailFooterSaving}
														onclick={updateEmailFooter}
														class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors text-sm"
													>
														{emailFooterSaving ? 'Saving…' : 'Save footer'}
													</button>
												</div>
											</div>
										</div>
									{:else if integration.id === 'shopify'}
										<div class="pt-3 border-t border-gray-100 space-y-4">
											<div>
												<p class="text-sm font-medium text-gray-700">Connected store</p>
												<p class="text-xs text-gray-500">
													{configs.shopify?.shopDomain || 'Shop domain not available'}
													{configs.shopify?.apiVersion ? ` · API ${configs.shopify.apiVersion}` : ''}
												</p>
											</div>
											<p class="text-xs text-gray-500">
												Sync products and manage pricing in <a href="/products" class="text-amber-600 hover:text-amber-700 underline">Products</a>.
											</p>
										</div>
									{/if}
								</div>
							{:else if 'oauth' in integration && integration.oauth && integration.id === 'shopify'}
								<div class="mt-4 space-y-3">
									<p class="text-sm text-gray-600">
										Connect your Shopify store with one click. You'll be redirected to Shopify to authorize ProfitBot.
									</p>
									<p class="text-xs text-gray-500">
										Ensure your Shopify app has this redirect URL: <code class="bg-gray-100 px-1 rounded">{$page.url.origin}/api/settings/integrations/shopify/callback</code>
									</p>
									<label class="block">
										<span class="text-sm font-medium text-gray-700 mb-1">Shop domain</span>
										<input
											type="text"
											placeholder="your-store.myshopify.com"
											bind:value={shopifyShopDomain}
											disabled={shopifyConnecting}
											class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-60"
										/>
									</label>
									<button
										type="button"
										disabled={shopifyConnecting}
										onclick={connectShopifyOAuth}
										class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors text-sm"
									>
										{shopifyConnecting ? 'Redirecting…' : 'Connect with Shopify'}
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
