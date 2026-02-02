<script lang="ts">
	import { buildQuoteHtml, computeQuoteFromSettings } from '$lib/quote-html';
	import type { QuoteSettings, QuotePayload } from '$lib/quote-html';

	type LineItem = { desc: string; price: number; fixed: boolean; total?: number };
	type Company = { name?: string; address?: string; phone?: string; email?: string };
	type BankDetails = { name?: string; accountName?: string; bsb?: string; accountNumber?: string };

	let { data } = $props();
	let settings = $state({
		company: (data?.settings?.company ?? {}) as Company,
		bank_details: (data?.settings?.bank_details ?? {}) as BankDetails,
		line_items: (data?.settings?.line_items ?? []) as LineItem[],
		deposit_percent: data?.settings?.deposit_percent ?? 40,
		tax_percent: data?.settings?.tax_percent ?? 10,
		valid_days: data?.settings?.valid_days ?? 30,
		logo_url: data?.settings?.logo_url ?? '',
		barcode_url: data?.settings?.barcode_url ?? '',
		barcode_title: data?.settings?.barcode_title ?? 'Call Us or Visit Website',
		currency: data?.settings?.currency ?? 'USD'
	});
	let saving = $state(false);
	let generating = $state(false);
	let samplePdfUrl = $state<string | null>(null);
	let error = $state('');
	let uploadingLogo = $state(false);
	let uploadingQr = $state(false);

	async function uploadFile(type: 'logo' | 'qr', file: File) {
		const setUploading = type === 'logo' ? (v: boolean) => (uploadingLogo = v) : (v: boolean) => (uploadingQr = v);
		setUploading(true);
		error = '';
		try {
			const formData = new FormData();
			formData.set('file', file);
			formData.set('type', type);
			const res = await fetch('/api/quote/upload', { method: 'POST', body: formData });
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Upload failed');
			if (type === 'logo') settings.logo_url = result.url ?? '';
			else settings.barcode_url = result.url ?? '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Upload failed';
		} finally {
			setUploading(false);
		}
	}

	function addLineItem() {
		settings.line_items = [...settings.line_items, { desc: '', price: 0, fixed: false }];
	}

	function removeLineItem(i: number) {
		settings.line_items = settings.line_items.filter((_, idx) => idx !== i);
	}

	async function save() {
		saving = true;
		error = '';
		try {
			const res = await fetch('/api/quote/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					company: settings.company,
					bank_details: settings.bank_details,
					line_items: settings.line_items,
					deposit_percent: settings.deposit_percent,
					tax_percent: settings.tax_percent,
					valid_days: settings.valid_days,
					logo_url: settings.logo_url || null,
					barcode_url: settings.barcode_url || null,
					barcode_title: settings.barcode_title || null,
					currency: settings.currency
				})
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Failed to save');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save';
		} finally {
			saving = false;
		}
	}

	function openPreview() {
		const s: QuoteSettings = {
			company: settings.company,
			bank_details: settings.bank_details,
			line_items: settings.line_items,
			deposit_percent: settings.deposit_percent,
			tax_percent: settings.tax_percent,
			valid_days: settings.valid_days,
			logo_url: settings.logo_url || null,
			barcode_url: settings.barcode_url || null,
			barcode_title: settings.barcode_title || null,
			currency: settings.currency
		};
		const roofSize = 100;
		const computed = computeQuoteFromSettings(s, roofSize);
		const payload: QuotePayload = {
			customer: { name: 'Sample Customer', email: 'sample@example.com', phone: '+1 234 567 8900' },
			project: { roofSize, fullAddress: '123 Sample St, City' },
			quote: {
				quoteDate: computed.quoteDate,
				validUntil: computed.validUntil,
				breakdownTotals: computed.breakdownTotals,
				subtotal: computed.subtotal,
				gst: computed.gst,
				total: computed.total
			}
		};
		const html = buildQuoteHtml(s, payload);
		const blob = new Blob([html], { type: 'text/html' });
		const url = URL.createObjectURL(blob);
		window.open(url, '_blank', 'noopener');
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function generateSamplePdf() {
		generating = true;
		error = '';
		samplePdfUrl = null;
		try {
			const res = await fetch('/api/quote/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sample: true })
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || result.hint || 'Failed to generate PDF');
			if (result.pdfUrl) {
				samplePdfUrl = result.pdfUrl;
				window.open(result.pdfUrl, '_blank');
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to generate PDF';
		} finally {
			generating = false;
		}
	}
</script>

<svelte:head>
	<title>Quote – ProfitBot</title>
</svelte:head>

<div class="max-w-3xl mx-auto">
	<h1 class="text-2xl font-bold text-gray-900">Quote</h1>
	<p class="text-gray-500 mt-1 mb-6">
		Configure your quote template. When a visitor in the chat asks for a quote (Direct LLM widget), the system generates a PDF and attaches it to their contact automatically—no n8n or webhook required.
	</p>

	{#if error}
		<div class="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm">{error}</div>
	{/if}

	<div class="space-y-6">
		<!-- Company -->
		<section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h2 class="text-lg font-semibold text-gray-900 mb-4">Company</h2>
			<div class="grid gap-4">
				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
					<input type="text" bind:value={settings.company.name} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" placeholder="Your company name" />
				</div>
				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Address</label>
					<textarea bind:value={settings.company.address} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" rows="2" placeholder="Street, City, State, Postcode"></textarea>
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label class="block text-sm font-medium text-gray-700 mb-1">Phone</label>
						<input type="text" bind:value={settings.company.phone} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" placeholder="+1 234 567 8900" />
					</div>
					<div>
						<label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
						<input type="email" bind:value={settings.company.email} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" placeholder="hello@company.com" />
					</div>
				</div>
				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Logo</label>
					<div class="flex flex-wrap items-center gap-3">
						{#if settings.logo_url}
							<img src={settings.logo_url} alt="Logo" class="h-12 object-contain rounded border border-gray-200" />
							<button type="button" class="text-sm text-gray-500 hover:text-red-600" onclick={() => (settings.logo_url = '')}>Remove</button>
						{/if}
						<label class="cursor-pointer">
							<span class="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50">
								{uploadingLogo ? 'Uploading…' : settings.logo_url ? 'Replace' : 'Upload image'}
							</span>
							<input
								type="file"
								accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
								class="sr-only"
								disabled={uploadingLogo}
								onchange={(e) => {
									const f = (e.target as HTMLInputElement).files?.[0];
									if (f) uploadFile('logo', f);
									(e.target as HTMLInputElement).value = '';
								}}
							/>
						</label>
					</div>
					<p class="text-xs text-gray-500 mt-1">PNG, JPEG, GIF, WebP or SVG. Max 2MB.</p>
				</div>
			</div>
		</section>

		<!-- Bank details -->
		<section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h2 class="text-lg font-semibold text-gray-900 mb-4">Bank details</h2>
			<div class="grid gap-4">
				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Bank name</label>
					<input type="text" bind:value={settings.bank_details.name} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" placeholder="Bank name" />
				</div>
				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Account name</label>
					<input type="text" bind:value={settings.bank_details.accountName} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" placeholder="Account name" />
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label class="block text-sm font-medium text-gray-700 mb-1">BSB</label>
						<input type="text" bind:value={settings.bank_details.bsb} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" placeholder="000-000" />
					</div>
					<div>
						<label class="block text-sm font-medium text-gray-700 mb-1">Account number</label>
						<input type="text" bind:value={settings.bank_details.accountNumber} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" placeholder="12345678" />
					</div>
				</div>
				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">QR code</label>
					<div class="flex flex-wrap items-center gap-3">
						{#if settings.barcode_url}
							<img src={settings.barcode_url} alt="QR code" class="h-16 w-16 object-contain rounded border border-gray-200" />
							<button type="button" class="text-sm text-gray-500 hover:text-red-600" onclick={() => (settings.barcode_url = '')}>Remove</button>
						{/if}
						<label class="cursor-pointer">
							<span class="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50">
								{uploadingQr ? 'Uploading…' : settings.barcode_url ? 'Replace' : 'Upload image'}
							</span>
							<input
								type="file"
								accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
								class="sr-only"
								disabled={uploadingQr}
								onchange={(e) => {
									const f = (e.target as HTMLInputElement).files?.[0];
									if (f) uploadFile('qr', f);
									(e.target as HTMLInputElement).value = '';
								}}
							/>
						</label>
					</div>
					<p class="text-xs text-gray-500 mt-1">PNG, JPEG, GIF, WebP or SVG. Max 2MB.</p>
				</div>
				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">QR code title</label>
					<input type="text" bind:value={settings.barcode_title} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" placeholder="Call Us or Visit Website" />
				</div>
			</div>
		</section>

		<!-- Line items & pricing -->
		<section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h2 class="text-lg font-semibold text-gray-900 mb-4">Line items & pricing</h2>
			<p class="text-sm text-gray-500 mb-4">Each line can be priced per m² (area × price) or a fixed total. When a visitor provides roof size (e.g. in chat), the quote uses that area.</p>
			<div class="space-y-3">
				{#each settings.line_items as item, i}
					<div class="flex flex-wrap items-end gap-3 p-3 rounded-lg bg-gray-50">
						<div class="flex-1 min-w-[180px]">
							<label class="block text-xs font-medium text-gray-500 mb-1">Description</label>
							<input type="text" bind:value={item.desc} class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" placeholder="e.g. Roof coating per m²" />
						</div>
						<div class="flex items-center gap-2">
							<label class="flex items-center gap-1.5 text-sm">
								<input type="checkbox" bind:checked={item.fixed} />
								Fixed total
							</label>
						</div>
						{#if item.fixed}
							<div class="w-24">
								<label class="block text-xs font-medium text-gray-500 mb-1">Total</label>
								<input type="number" step="0.01" bind:value={item.total} class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
							</div>
						{:else}
							<div class="w-24">
								<label class="block text-xs font-medium text-gray-500 mb-1">Price / m²</label>
								<input type="number" step="0.01" bind:value={item.price} class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
							</div>
						{/if}
						<button type="button" class="text-red-600 hover:text-red-800 text-sm" onclick={() => removeLineItem(i)}>Remove</button>
					</div>
				{/each}
				<button type="button" class="text-sm text-amber-600 hover:text-amber-800 font-medium" onclick={addLineItem}>+ Add line item</button>
			</div>
			<div class="mt-4 grid grid-cols-2 gap-4 max-w-md">
				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Deposit %</label>
					<input type="number" min="0" max="100" bind:value={settings.deposit_percent} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
				</div>
				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Tax (GST) %</label>
					<input type="number" min="0" max="100" bind:value={settings.tax_percent} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
				</div>
				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Quote valid (days)</label>
					<input type="number" min="1" max="365" bind:value={settings.valid_days} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
				</div>
				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Currency</label>
					<input type="text" bind:value={settings.currency} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" placeholder="USD" />
				</div>
			</div>
		</section>

		<!-- Actions -->
		<div class="flex flex-wrap items-center gap-3">
			<button
				type="button"
				class="px-4 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
				onclick={save}
				disabled={saving}
			>
				{saving ? 'Saving…' : 'Save settings'}
			</button>
			<button type="button" class="px-4 py-2 rounded-lg font-medium bg-gray-100 text-gray-800 hover:bg-gray-200" onclick={openPreview}>
				Preview HTML
			</button>
			<button
				type="button"
				class="px-4 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
				onclick={generateSamplePdf}
				disabled={generating}
			>
				{generating ? 'Generating…' : 'Generate sample PDF'}
			</button>
		</div>
		{#if samplePdfUrl}
			<p class="text-sm text-gray-500">
				<a href={samplePdfUrl} target="_blank" rel="noopener" class="text-amber-600 hover:underline">Download sample PDF</a> (opens in new tab)
			</p>
		{/if}
	</div>
</div>
