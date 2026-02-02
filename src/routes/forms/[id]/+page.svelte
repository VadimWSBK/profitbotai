<script lang="ts">
	import { page } from '$app/stores';

	type Field = { key: string; label: string; required: boolean; placeholder?: string; type?: string };
	type Step = { title: string; description?: string; fields: Field[] };

	let { data } = $props();
	const formId = $derived((data?.formId as string) ?? '');
	type SuccessButton = { label: string; url: string; linkToQuote?: boolean };
	const initialForm = $derived((data?.form as { name: string; title: string; steps: Step[]; colors: Record<string, string>; success_title?: string | null; success_message?: string | null; success_buttons?: SuccessButton[] }) ?? { name: '', title: '', steps: [], colors: {}, success_buttons: [] });

	const defaultSteps: Step[] = [
		{ title: 'Contact information', description: 'Please provide your contact information to receive your instant quote.', fields: [
			{ key: 'name', label: 'Full Name', required: true, placeholder: 'Enter your full name' },
			{ key: 'email', label: 'Email Address', required: true, placeholder: 'Enter your email' },
			{ key: 'phone', label: 'Phone Number (Optional)', required: false, placeholder: 'e.g., 0400 123 456' }
		]},
		{ title: 'Property location', description: 'Please provide the location of your property.', fields: [
			{ key: 'street_address', label: 'Street Address', required: true, placeholder: 'Enter street address' },
			{ key: 'post_code', label: 'Post Code', required: true, placeholder: 'Enter post code' },
			{ key: 'city', label: 'City', required: true, placeholder: 'Enter city' },
			{ key: 'state', label: 'State/Territory', required: true, placeholder: 'Select State/Territory', type: 'select' }
		]}
	];

	let name = $state('');
	let title = $state('Get Your Quote');
	let steps = $state<Step[]>([]);
	let primaryColor = $state('#D4AF37');
	let successTitle = $state('');
	let successMessage = $state('');
	let successButtons = $state<SuccessButton[]>([]);

	$effect(() => {
		const f = initialForm;
		name = f.name || 'Quote form';
		title = f.title || 'Get Your Quote';
		steps = f.steps?.length ? JSON.parse(JSON.stringify(f.steps)) : JSON.parse(JSON.stringify(defaultSteps));
		primaryColor = f.colors?.primary ?? '#D4AF37';
		successTitle = f.success_title ?? '';
		successMessage = f.success_message ?? '';
		successButtons = Array.isArray(f.success_buttons) && f.success_buttons.length
			? f.success_buttons.map((b) => ({ label: b.label || 'Button', url: b.url || '', linkToQuote: !!b.linkToQuote }))
			: [];
	});

	// Keep preview step in bounds when steps are edited
	$effect(() => {
		const len = steps.length;
		if (len === 0) return;
		if (previewStep >= len) previewStep = Math.max(0, len - 1);
	});

	let saving = $state(false);
	let deleting = $state(false);
	let embedCopied = $state(false);
	let error = $state('');

	// Preview state (separate from builder so user can click through steps)
	let previewStep = $state(0);
	let previewValues = $state<Record<string, string>>({});
	const previewTotalSteps = $derived(steps.length);
	const previewIsLastStep = $derived(previewStep === previewTotalSteps - 1);
	const previewCurrentStepData = $derived(steps[previewStep]);
	let previewShowSuccess = $state(false);
	let previewSubmitting = $state(false);

	function previewSetValue(key: string, value: string) {
		previewValues = { ...previewValues, [key]: value };
	}

	function previewNext() {
		if (previewIsLastStep) {
			if (previewSubmitting) return;
			previewShowSuccess = false;
			previewSubmitting = true;
			setTimeout(() => {
				previewSubmitting = false;
				previewShowSuccess = true;
			}, 1000);
		} else {
			previewStep += 1;
		}
	}

	function previewPrev() {
		previewShowSuccess = false;
		previewSubmitting = false;
		if (previewStep > 0) previewStep -= 1;
	}

	function previewStartOver() {
		previewStep = 0;
		previewValues = {};
		previewShowSuccess = false;
		previewSubmitting = false;
	}

	const embedUrl = $derived(`${typeof window !== 'undefined' ? window.location.origin : ''}/embed/form/${formId}`);
	const embedCode = $derived(`<iframe src="${embedUrl}" width="100%" height="600" frameborder="0" title="Quote form"></iframe>`);

	async function save() {
		saving = true;
		error = '';
		try {
			const res = await fetch(`/api/forms/${formId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, title, steps, colors: { primary: primaryColor }, success_title: successTitle || null, success_message: successMessage || null, success_buttons: successButtons })
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Failed to save');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save';
		} finally {
			saving = false;
		}
	}

	async function deleteForm() {
		if (!confirm('Delete this form? This cannot be undone.')) return;
		deleting = true;
		try {
			const res = await fetch(`/api/forms/${formId}`, { method: 'DELETE' });
			if (!res.ok) {
				const result = await res.json().catch(() => ({}));
				throw new Error(result.error || 'Failed to delete');
			}
			window.location.href = '/forms';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete';
		} finally {
			deleting = false;
		}
	}

	function copyEmbed() {
		navigator.clipboard.writeText(embedCode);
		embedCopied = true;
		setTimeout(() => (embedCopied = false), 2000);
	}

	function addStep() {
		steps = [...steps, { title: 'New step', description: '', fields: [{ key: 'name', label: 'Full Name', required: true, placeholder: '' }] }];
	}

	function removeStep(i: number) {
		steps = steps.filter((_, idx) => idx !== i);
	}

	function moveStepUp(i: number) {
		if (i <= 0) return;
		steps = steps.map((s, idx) => {
			if (idx === i) return steps[i - 1];
			if (idx === i - 1) return steps[i];
			return s;
		});
	}

	function moveStepDown(i: number) {
		if (i >= steps.length - 1) return;
		steps = steps.map((s, idx) => {
			if (idx === i) return steps[i + 1];
			if (idx === i + 1) return steps[i];
			return s;
		});
	}

	function addField(stepIndex: number) {
		const s = steps[stepIndex];
		if (!s) return;
		const newFields = [...s.fields, { key: 'field', label: 'Field', required: false, placeholder: '' }];
		steps = steps.map((st, idx) => (idx === stepIndex ? { ...st, fields: newFields } : st));
	}

	function removeField(stepIndex: number, fieldIndex: number) {
		steps = steps.map((st, idx) => {
			if (idx !== stepIndex) return st;
			return { ...st, fields: st.fields.filter((_, fi) => fi !== fieldIndex) };
		});
	}

	const FIELD_KEYS = ['name', 'email', 'phone', 'street_address', 'post_code', 'city', 'state', 'roof_size'];
</script>

<svelte:head>
	<title>Form builder – ProfitBot</title>
</svelte:head>

<div class="max-w-4xl mx-auto pb-8">
	<div class="flex items-center gap-4 mb-6">
		<a href="/forms" class="text-gray-500 hover:text-gray-700" title="Back to forms" aria-label="Back to forms">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
		</a>
		<h1 class="text-2xl font-bold text-gray-900">Form builder</h1>
	</div>

	{#if error}
		<div class="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm">{error}</div>
	{/if}

	<div class="space-y-6">
		<!-- Basic -->
		<section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h2 class="text-lg font-semibold text-gray-900 mb-4">Basic</h2>
			<div class="grid gap-4">
				<div>
					<label for="form-name" class="block text-sm font-medium text-gray-700 mb-1">Form name</label>
					<input id="form-name" type="text" bind:value={name} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" placeholder="Quote form" />
				</div>
				<div>
					<label for="form-title" class="block text-sm font-medium text-gray-700 mb-1">Form title (shown to visitors)</label>
					<input id="form-title" type="text" bind:value={title} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" placeholder="Get Your Quote" />
				</div>
				<div>
					<label for="form-primary-color" class="block text-sm font-medium text-gray-700 mb-1">Primary color</label>
					<div class="flex items-center gap-3">
						<input id="form-primary-color" type="color" bind:value={primaryColor} class="h-10 w-14 rounded border border-gray-300 cursor-pointer" />
						<input type="text" bind:value={primaryColor} class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 font-mono text-sm" aria-label="Primary color hex" />
					</div>
				</div>
			</div>
		</section>

		<!-- Success page -->
		<section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h2 class="text-lg font-semibold text-gray-900 mb-2">Success page</h2>
			<p class="text-sm text-gray-500 mb-4">Text and buttons shown after the form is submitted. Configure a workflow (Form submit trigger) to generate quotes or send emails.</p>
			<div class="grid gap-4">
				<div>
					<label for="success-title" class="block text-sm font-medium text-gray-700 mb-1">Heading</label>
					<input id="success-title" type="text" bind:value={successTitle} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" placeholder="Thank you" />
				</div>
				<div>
					<label for="success-message" class="block text-sm font-medium text-gray-700 mb-1">Message (optional)</label>
					<textarea id="success-message" bind:value={successMessage} rows="3" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" placeholder="We'll be in touch soon."></textarea>
				</div>
				<div>
					<div class="flex items-center justify-between mb-2">
						<label class="block text-sm font-medium text-gray-700">Buttons</label>
						<button type="button" class="text-sm text-amber-600 hover:text-amber-800 font-medium" onclick={() => successButtons = [...successButtons, { label: 'Button', url: '', linkToQuote: false }]}>+ Add button</button>
					</div>
					<p class="text-xs text-gray-500 mb-2">Use "Quote PDF" to link to the generated quote (when your workflow has Generate quote). Use "Custom URL" for any other link.</p>
					<div class="space-y-2">
						{#each successButtons as btn, bi}
							<div class="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-gray-200 bg-gray-50/50">
								<input type="text" bind:value={btn.label} class="w-32 rounded border border-gray-300 px-2 py-1.5 text-sm" placeholder="Label" />
								<select
									class="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
									aria-label="Button action"
									value={btn.linkToQuote ? 'quote' : 'url'}
									onchange={(e) => {
										const v = (e.currentTarget as HTMLSelectElement).value === 'quote';
										successButtons = successButtons.map((b, i) => (i === bi ? { ...b, linkToQuote: v } : b));
									}}
								>
									<option value="url">Custom URL</option>
									<option value="quote">Quote PDF</option>
								</select>
								{#if !btn.linkToQuote}
									<input type="url" bind:value={btn.url} class="flex-1 min-w-[160px] rounded border border-gray-300 px-2 py-1.5 text-sm font-mono" placeholder="https://..." />
								{:else}
									<span class="flex-1 min-w-[160px] text-xs text-gray-500 py-1.5">Uses the quote link from the workflow</span>
								{/if}
								<button type="button" class="text-red-600 hover:text-red-800 text-sm" onclick={() => successButtons = successButtons.filter((_, i) => i !== bi)}>Remove</button>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</section>

		<!-- Steps -->
		<section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-lg font-semibold text-gray-900">Steps</h2>
				<button type="button" class="text-sm text-amber-600 hover:text-amber-800 font-medium" onclick={addStep}>+ Add step</button>
			</div>
			<div class="space-y-6">
				{#each steps as step, si}
					<div class="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
						<div class="flex items-center justify-between gap-2 mb-3">
							<div class="flex items-center gap-1 shrink-0" role="group" aria-label="Move step">
								<button type="button" class="p-1.5 rounded text-gray-500 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-40 disabled:pointer-events-none" title="Move up" onclick={() => moveStepUp(si)} disabled={si === 0} aria-label="Move step up">
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
								</button>
								<button type="button" class="p-1.5 rounded text-gray-500 hover:bg-gray-200 hover:text-gray-700 disabled:opacity-40 disabled:pointer-events-none" title="Move down" onclick={() => moveStepDown(si)} disabled={si === steps.length - 1} aria-label="Move step down">
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
								</button>
							</div>
							<input type="text" bind:value={step.title} class="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm font-medium" placeholder="Step title" />
							<button type="button" class="text-red-600 hover:text-red-800 text-sm" onclick={() => removeStep(si)}>Remove step</button>
						</div>
						<input type="text" bind:value={step.description} class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-600 mb-3" placeholder="Step description (optional)" />
						<div class="space-y-2">
							{#each step.fields as field, fi}
								<div class="flex flex-wrap items-center gap-2">
									<select bind:value={field.key} class="rounded border border-gray-300 px-2 py-1.5 text-sm w-36" id="step-{si}-field-{fi}-key">
										{#each FIELD_KEYS as k}
											<option value={k}>{k.replace('_', ' ')}</option>
										{/each}
										<option value="field">Custom</option>
									</select>
									<label for="step-{si}-field-{fi}-label" class="sr-only">Label</label>
									<input type="text" bind:value={field.label} id="step-{si}-field-{fi}-label" class="flex-1 min-w-[120px] rounded border border-gray-300 px-2 py-1.5 text-sm" placeholder="Label" />
									<label for="step-{si}-field-{fi}-placeholder" class="sr-only">Placeholder</label>
									<input type="text" bind:value={field.placeholder} id="step-{si}-field-{fi}-placeholder" class="w-40 rounded border border-gray-300 px-2 py-1.5 text-sm" placeholder="Placeholder" />
									<label class="flex items-center gap-1 text-sm">
										<input type="checkbox" bind:checked={field.required} aria-label="Required" />
										Required
									</label>
									<button type="button" class="text-red-600 hover:text-red-800 text-sm" onclick={() => removeField(si, fi)}>Remove</button>
								</div>
							{/each}
							<button type="button" class="text-sm text-amber-600 hover:text-amber-800" onclick={() => addField(si)}>+ Add field</button>
						</div>
					</div>
				{/each}
			</div>
		</section>

        <!-- Preview -->
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 class="text-lg font-semibold text-gray-900 mb-2">Preview</h2>
            <p class="text-sm text-gray-500 mb-4">See how your form will look to visitors. Submissions from the preview are not saved.</p>
            <div class="flex justify-center bg-gray-100 rounded-xl p-6 min-h-[360px]">
                <div class="min-h-[320px] w-full max-w-lg p-6 bg-white rounded-2xl shadow-lg border border-gray-200" style="--primary: {primaryColor}">
                    {#if previewShowSuccess}
                        <div class="text-center py-6">
                            <h3 class="text-xl font-bold text-gray-900 mb-2">{successTitle || 'Thank you'} (preview)</h3>
                            <p class="text-gray-500 text-sm mb-6 whitespace-pre-line">{successMessage || 'We\'ll be in touch soon.'}</p>
                            <div class="flex flex-wrap gap-3 justify-center">
                               	{#each successButtons.filter(b => b.linkToQuote || (b.url ?? '').trim()) as btn}
									{#if btn.linkToQuote}
										<span class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-white opacity-80" style="background-color: var(--primary)" title="Links to quote PDF when workflow generates one">
											{btn.label || 'Download Quote'} (Quote PDF)
										</span>
									{:else}
										<a
											href={btn.url}
											target="_blank"
											rel="noopener"
											class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-white transition-colors"
											style="background-color: var(--primary)"
										>
											{btn.label || 'Button'}
										</a>
									{/if}
								{/each}
								{#if successButtons.length === 0}
									<span class="text-gray-400 text-sm">Add buttons in Success page section</span>
								{/if}
                                <button
                                    type="button"
                                    onclick={previewStartOver}
                                    class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold border-2 transition-colors"
                                    style="border-color: var(--primary); color: var(--primary); background: transparent"
                                >
                                    Start over
                                </button>
                            </div>
                        </div>
                    {:else if previewSubmitting}
                        <div class="flex flex-col items-center justify-center gap-4 py-10">
                            <div class="w-10 h-10 rounded-full border-4 border-amber-200 border-t-amber-500 animate-spin"></div>
                            <div class="text-center">
                                <h3 class="text-lg font-semibold text-gray-900 mb-1">Generating your quote…</h3>
                                <p class="text-sm text-gray-500">This shows the loading state visitors will see.</p>
                            </div>
                        </div>
                    {:else if steps.length === 0}
                        <p class="text-gray-500 text-sm py-8 text-center">Add at least one step above to see the preview.</p>
                    {:else}
                        <!-- Step indicator -->
                        <div class="flex items-center justify-center gap-2 mb-6">
                            {#each steps as _, i}
                                <div class="flex items-center" aria-current={i === previewStep ? 'step' : undefined}>
                                    <div
                                        class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors"
                                        style:background-color={i <= previewStep ? primaryColor : '#e5e7eb'}
                                        style:color={i <= previewStep ? 'white' : '#9ca3af'}
                                    >
                                        {i + 1}
                                    </div>
                                    {#if i < previewTotalSteps - 1}
                                        <div
                                            class="w-8 h-0.5 mx-0.5"
                                            style="background-color: {i < previewStep ? primaryColor : '#e5e7eb'}"
                                        ></div>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                        <h3 class="text-xl font-bold text-gray-900 mb-1">{title}</h3>
                        {#if previewCurrentStepData?.description}
                            <p class="text-sm text-gray-500 mb-6">{previewCurrentStepData.description}</p>
                        {:else}
                            <p class="text-sm text-gray-500 mb-6">Step {previewStep + 1} of {previewTotalSteps}</p>
                        {/if}
                        {#if previewCurrentStepData}
                            <div class="space-y-4 mb-6">
                                {#each previewCurrentStepData.fields as field}
                                    <div>
                                        <label for="preview-field-{field.key}-{previewStep}" class="block text-sm font-semibold text-gray-900 mb-1">
                                            {field.label}
                                            {#if field.required}<span class="text-red-500">*</span>{/if}
                                        </label>
                                        {#if field.type === 'select'}
                                            <select
                                                id="preview-field-{field.key}-{previewStep}"
                                                value={previewValues[field.key] ?? ''}
                                                onchange={(e) => previewSetValue(field.key, (e.currentTarget as HTMLSelectElement).value)}
                                                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:ring-2 focus:ring-offset-0"
                                                style="--tw-ring-color: {primaryColor}"
                                            >
                                                <option value="">{field.placeholder ?? 'Select…'}</option>
                                                <option value="NSW">NSW</option>
                                                <option value="VIC">VIC</option>
                                                <option value="QLD">QLD</option>
                                                <option value="WA">WA</option>
                                                <option value="SA">SA</option>
                                                <option value="TAS">TAS</option>
                                                <option value="ACT">ACT</option>
                                                <option value="NT">NT</option>
                                            </select>
                                        {:else}
                                            <input
                                                id="preview-field-{field.key}-{previewStep}"
                                                type={field.key === 'email' ? 'email' : field.key === 'phone' ? 'tel' : 'text'}
                                                value={previewValues[field.key] ?? ''}
                                                oninput={(e) => previewSetValue(field.key, (e.currentTarget as HTMLInputElement).value)}
                                                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:ring-2 focus:ring-offset-0 focus:border-transparent"
                                                style="--tw-ring-color: {primaryColor}"
                                                placeholder={field.placeholder}
                                            />
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                            <div class="flex items-center justify-between gap-3">
                                {#if previewStep > 0}
                                    <button
                                        type="button"
                                        onclick={previewPrev}
                                        class="px-4 py-2 rounded-lg font-semibold border-2 transition-colors"
                                        style="border-color: var(--primary); color: var(--primary); background: transparent"
                                    >
                                        Previous
                                    </button>
                                {:else}
                                    <span></span>
                                {/if}
                                <button
                                    type="button"
                                    onclick={previewNext}
                                    disabled={previewSubmitting}
                                    class="px-5 py-2.5 rounded-lg font-semibold text-white transition-colors disabled:opacity-50"
                                    style="background-color: var(--primary)"
                                >
                                    {previewIsLastStep ? 'Generate quote' : 'Next'}
                                </button>
                            </div>
                        {/if}
                    {/if}
                </div>
            </div>
        </section>

		<!-- Embed code -->
		<section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h2 class="text-lg font-semibold text-gray-900 mb-2">Embed code</h2>
			<p class="text-sm text-gray-500 mb-4">Copy this code and paste it into any page to embed the form in an iframe.</p>
			<div class="flex gap-2">
				<pre class="flex-1 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800"><code>{embedCode}</code></pre>
				<button
					type="button"
					onclick={copyEmbed}
					class="shrink-0 px-4 py-2 rounded-lg font-medium border border-amber-500 text-amber-600 hover:bg-amber-50 transition-colors"
				>
					{embedCopied ? 'Copied!' : 'Copy'}
				</button>
			</div>
			<p class="text-xs text-gray-500 mt-2">Form URL: <a href={embedUrl} target="_blank" rel="noopener" class="text-amber-600 hover:underline">{embedUrl}</a></p>
		</section>

		<!-- Actions -->
		<div class="flex flex-wrap items-center gap-3">
			<button
				type="button"
				class="px-4 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
				onclick={save}
				disabled={saving}
			>
				{saving ? 'Saving…' : 'Save'}
			</button>
			<button
				type="button"
				class="px-4 py-2 rounded-lg font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 disabled:opacity-50"
				onclick={deleteForm}
				disabled={deleting}
			>
				{deleting ? 'Deleting…' : 'Delete form'}
			</button>
		</div>
	</div>
</div>
