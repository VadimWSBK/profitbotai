<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let { data } = $props();
	const TEMPLATE_VARIABLE_GROUPS: { group: string; fields: { key: string; label: string }[] }[] = [
		{ group: 'Contact', fields: [{ key: 'name', label: 'Name' }, { key: 'first_name', label: 'First name' }, { key: 'last_name', label: 'Last name' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }] },
		{ group: 'Company', fields: [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }] },
		{ group: 'Quote', fields: [{ key: 'total', label: 'Total' }, { key: 'items', label: 'Items' }, { key: 'downloadUrl', label: 'Quote link' }] }
	];

	const templateId = $derived((data?.templateId as string) ?? '');
	const initialTemplate = $derived(
		(data?.template as { name: string; subject: string; body: string }) ?? { name: '', subject: '', body: '' }
	);

	type TemplateVarField = 'name' | 'subject' | 'body';
	let name = $state('');
	let subject = $state('');
	let body = $state('');
	let saving = $state(false);
	let deleting = $state(false);
	let error = $state('');
	let variableDropdownOpen = $state(false);
	let lastFocusedField = $state<TemplateVarField>('body');

	function insertTemplateVariable(field: TemplateVarField, groupKey: string, fieldKey: string) {
		const tag = `{{${groupKey.toLowerCase()}.${fieldKey}}}`;
		if (field === 'name') name = name + tag;
		else if (field === 'subject') subject = subject + tag;
		else body = body + tag;
		variableDropdownOpen = false;
	}

	let bodyTextareaEl: HTMLTextAreaElement;
	function wrapSelectionAsQuoteLink() {
		const el = bodyTextareaEl;
		if (!el) return;
		const start = el.selectionStart;
		const end = el.selectionEnd;
		const selected = body.slice(start, end);
		const linkText = selected.trim() || 'Download your quote';
		const snippet = `[[${linkText}]]`;
		const before = body.slice(0, start);
		const after = body.slice(end);
		body = before + snippet + after;
		el.focus();
		el.setSelectionRange(before.length, before.length + snippet.length);
	}

	let variableDropdownEl: HTMLDivElement;
	onMount(() => {
		function onDocClick(e: MouseEvent) {
			if (variableDropdownOpen && variableDropdownEl && !variableDropdownEl.contains(e.target as Node)) {
				variableDropdownOpen = false;
			}
		}
		document.addEventListener('click', onDocClick);
		return () => document.removeEventListener('click', onDocClick);
	});

	$effect(() => {
		const t = initialTemplate;
		name = t.name;
		subject = t.subject;
		body = t.body;
	});

	async function save() {
		error = '';
		saving = true;
		try {
			const res = await fetch(`/api/templates/${templateId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, subject, body })
			});
			if (!res.ok) {
				const d = await res.json().catch(() => ({}));
				error = (d.error as string) ?? 'Failed to save';
				return;
			}
		} finally {
			saving = false;
		}
	}

	async function deleteTemplate() {
		if (!confirm('Delete this template? This cannot be undone.')) return;
		error = '';
		deleting = true;
		try {
			const res = await fetch(`/api/templates/${templateId}`, { method: 'DELETE' });
			if (!res.ok) {
				const d = await res.json().catch(() => ({}));
				error = (d.error as string) ?? 'Failed to delete';
				return;
			}
			goto('/templates');
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:head>
	<title>{name || 'Template'} – Templates – ProfitBot</title>
</svelte:head>

<div class="max-w-2xl mx-auto">
	<div class="flex items-center gap-4 mb-6">
		<a
			href="/templates"
			class="inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700"
			aria-label="Back to templates"
		>
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
			Templates
		</a>
	</div>

	<h1 class="text-2xl font-bold text-gray-900 mb-2">Edit template</h1>
	<p class="text-gray-500 text-sm mb-6">
		Use placeholders like <code class="bg-gray-100 px-1 rounded">{'{{contact.name}}'}</code>, <code class="bg-gray-100 px-1 rounded">{'{{contact.email}}'}</code>, <code class="bg-gray-100 px-1 rounded">{'{{quote.total}}'}</code>. This template can be selected in the workflow builder for the "Send email" action.
	</p>

	{#if error}
		<p class="mb-4 text-sm text-red-600">{error}</p>
	{/if}

	<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
		<div class="flex items-center justify-between gap-2 mb-1" bind:this={variableDropdownEl}>
			<span class="text-sm font-medium text-gray-700">Insert variable</span>
			<div class="relative">
				<button
					type="button"
					onclick={() => variableDropdownOpen = !variableDropdownOpen}
					class="text-sm font-medium text-amber-600 hover:text-amber-700"
				>
					Add variable
				</button>
				{#if variableDropdownOpen}
					<div class="absolute right-0 top-full mt-1 z-10 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
						<p class="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">Insert into: {lastFocusedField === 'name' ? 'Name' : lastFocusedField === 'subject' ? 'Subject' : 'Body'}</p>
						{#each TEMPLATE_VARIABLE_GROUPS as { group, fields }}
							<p class="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">{group}</p>
							{#each fields as { key, label }}
								<button type="button" class="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-amber-50" onclick={() => insertTemplateVariable(lastFocusedField, group, key)}>{label}</button>
							{/each}
						{/each}
					</div>
				{/if}
			</div>
		</div>
		<div>
			<label for="template-name" class="block text-sm font-medium text-gray-700 mb-1">Name</label>
			<input
				id="template-name"
				type="text"
				bind:value={name}
				onfocus={() => lastFocusedField = 'name'}
				placeholder="e.g. Quote follow-up"
				class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 bg-white placeholder:text-gray-400"
			/>
		</div>
		<div>
			<label for="template-subject" class="block text-sm font-medium text-gray-700 mb-1">Subject</label>
			<input
				id="template-subject"
				type="text"
				bind:value={subject}
				onfocus={() => lastFocusedField = 'subject'}
				placeholder={'e.g. Your quote from {{company.name}}'}
				class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 bg-white placeholder:text-gray-400"
			/>
		</div>
		<div>
			<div class="flex items-center justify-between gap-2 mb-1">
				<label for="template-body" class="text-sm font-medium text-gray-700">Body</label>
				<button
					type="button"
					onclick={wrapSelectionAsQuoteLink}
					class="text-sm font-medium text-amber-600 hover:text-amber-700"
				>
					Link selection to quote
				</button>
			</div>
			<textarea
				id="template-body"
				bind:this={bodyTextareaEl}
				bind:value={body}
				onfocus={() => lastFocusedField = 'body'}
				placeholder={'Hi {{contact.name}},\n\nPlease find your quote attached.\n\nBest regards'}
				class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 bg-white placeholder:text-gray-400 min-h-[200px]"
				rows={10}
			></textarea>
			<p class="text-xs text-gray-500 mt-1">Select text and click "Link selection to quote" to make it a clickable quote link, or use [[link text]] in the body.</p>
		</div>
		<div class="flex items-center justify-between gap-4 pt-2">
			<button
				type="button"
				onclick={deleteTemplate}
				disabled={deleting}
				class="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
			>
				{deleting ? 'Deleting…' : 'Delete template'}
			</button>
			<button
				type="button"
				onclick={save}
				disabled={saving}
				class="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
			>
				{saving ? 'Saving…' : 'Save'}
			</button>
		</div>
	</div>
</div>
