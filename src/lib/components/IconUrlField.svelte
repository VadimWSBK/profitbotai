<script lang="ts">
	let { value = $bindable(''), uploadUrl, label = 'Icon URL', placeholder = 'https://... or upload' } = $props();
	let uploading = $state(false);
	let error = $state('');
	let fileInput: HTMLInputElement;

	async function handleUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		input.value = '';
		uploading = true;
		error = '';
		try {
			const form = new FormData();
			form.set('file', file);
			const res = await fetch(uploadUrl, { method: 'POST', body: form });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Upload failed');
			if (typeof data.url === 'string') value = data.url;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Upload failed';
		} finally {
			uploading = false;
		}
	}

	function triggerUpload() {
		fileInput?.click();
	}
</script>

<label class="block">
	<span class="text-sm font-medium text-gray-700 mb-1">{label}</span>
	<div class="flex gap-2">
		<input
			type="url"
			bind:value
			class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
			placeholder={placeholder}
		/>
		<input
			type="file"
			accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
			class="hidden"
			bind:this={fileInput}
			onchange={handleUpload}
		/>
		<button
			type="button"
			class="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 shrink-0 disabled:opacity-50"
			onclick={triggerUpload}
			disabled={uploading}
		>
			{uploading ? '…' : 'Upload'}
		</button>
	</div>
	{#if error}
		<p class="mt-1 text-sm text-red-600">{error}</p>
	{/if}
</label>
