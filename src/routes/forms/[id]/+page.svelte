<script lang="ts">
	import { page } from '$app/stores';
	import { fly, fade, scale } from 'svelte/transition';
	import { cubicOut, backOut } from 'svelte/easing';

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
	let previewSlideDirection = $state<'forward' | 'backward'>('forward');

	function previewSetValue(key: string, value: string) {
		previewValues = { ...previewValues, [key]: value };
	}

	function previewNext() {
		previewSlideDirection = 'forward';
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
		previewSlideDirection = 'backward';
		previewShowSuccess = false;
		previewSubmitting = false;
		if (previewStep > 0) previewStep -= 1;
	}

	function previewStartOver() {
		previewSlideDirection = 'backward';
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
                <div class="preview-form-card min-h-[320px] w-full max-w-lg p-6 bg-white rounded-2xl shadow-lg border border-gray-200 flex flex-col overflow-hidden" style="--primary: {primaryColor}">
                    {#if previewShowSuccess}
                        <div class="flex-1 flex flex-col items-center justify-center py-6" in:scale={{ start: 0.9, duration: 400, easing: backOut }}>
                            <!-- Animated checkmark -->
                            <div class="preview-check-circle" style="border-color: var(--primary)">
                                <svg class="preview-check-icon" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                    <path class="preview-check-path" d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <h3 class="text-xl font-bold text-gray-900 mb-2 mt-6" in:fly={{ y: 8, duration: 300, delay: 200, easing: cubicOut }}>{successTitle || 'Thank you'} <span class="text-gray-400 text-sm font-normal">(preview)</span></h3>
                            <p class="text-gray-500 text-sm mb-6 whitespace-pre-line text-center" in:fly={{ y: 8, duration: 300, delay: 300, easing: cubicOut }}>{successMessage || 'We\'ll be in touch soon.'}</p>
                            <div class="flex flex-wrap gap-3 justify-center" in:fly={{ y: 8, duration: 300, delay: 400, easing: cubicOut }}>
                               	{#each successButtons.filter(b => b.linkToQuote || (b.url ?? '').trim()) as btn}
									{#if btn.linkToQuote}
										<span class="preview-btn preview-btn-primary opacity-80" style="background-color: var(--primary)" title="Links to quote PDF when workflow generates one">
											<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
											{btn.label || 'Download Quote'} (Quote PDF)
										</span>
									{:else}
										<a
											href={btn.url}
											target="_blank"
											rel="noopener"
											class="preview-btn preview-btn-primary"
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
                                    class="preview-btn preview-btn-outline"
                                    style="border-color: var(--primary); color: var(--primary)"
                                >
                                    Start over
                                </button>
                            </div>
                        </div>
                    {:else if previewSubmitting}
                        <div class="flex-1 flex flex-col items-center justify-center gap-5 py-10" in:fade={{ duration: 200 }}>
                            <div class="preview-loading-ring" style="--ring-color: {primaryColor}">
                                <div class="preview-loading-ring-inner"></div>
                            </div>
                            <div class="text-center" in:fly={{ y: 8, duration: 300, delay: 100, easing: cubicOut }}>
                                <h3 class="text-lg font-semibold text-gray-900 mb-1">Generating your quote…</h3>
                                <p class="text-sm text-gray-500">This shows the loading state visitors will see.</p>
                            </div>
                        </div>
                    {:else if steps.length === 0}
                        <p class="text-gray-500 text-sm py-8 text-center">Add at least one step above to see the preview.</p>
                    {:else}
                        <div class="flex flex-col flex-1 min-h-0">
                            <!-- Step indicators -->
                            {#if previewTotalSteps > 1}
                                <div class="flex items-center justify-between mb-6 shrink-0">
                                    {#each steps as _, i}
                                        <button
                                            type="button"
                                            class="preview-step-dot"
                                            class:preview-step-active={i === previewStep}
                                            class:preview-step-done={i < previewStep}
                                            style:--primary={primaryColor}
                                            onclick={() => { if (i < previewStep) { previewSlideDirection = 'backward'; previewStep = i; } }}
                                            disabled={i > previewStep}
                                            aria-current={i === previewStep ? 'step' : undefined}
                                            aria-label="Step {i + 1}"
                                        >
                                            {#if i < previewStep}
                                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>
                                            {:else}
                                                {i + 1}
                                            {/if}
                                        </button>
                                        {#if i < previewTotalSteps - 1}
                                            <div class="preview-step-line">
                                                <div class="preview-step-line-fill" style="width: {i < previewStep ? '100%' : '0%'}; background-color: {primaryColor}"></div>
                                            </div>
                                        {/if}
                                    {/each}
                                </div>
                            {/if}

                            <!-- Step content with slide -->
                            {#key previewStep}
                                <div
                                    class="flex-1 flex flex-col text-center"
                                    in:fly={{ x: previewSlideDirection === 'forward' ? 30 : -30, duration: 300, easing: cubicOut }}
                                >
                                    <h3 class="text-xl font-bold text-gray-900 mb-1">{title}</h3>
                                    {#if previewCurrentStepData?.description}
                                        <p class="text-sm text-gray-500 mb-6">{previewCurrentStepData.description}</p>
                                    {:else}
                                        <p class="text-sm text-gray-500 mb-6">Step {previewStep + 1} of {previewTotalSteps}</p>
                                    {/if}
                                    {#if previewCurrentStepData}
                                        <div class="space-y-4 mb-6 w-full max-w-sm mx-auto">
                                            {#each previewCurrentStepData.fields as field, fi}
                                                <div class="text-left" in:fly={{ y: 10, duration: 280, delay: fi * 50, easing: cubicOut }}>
                                                    <label for="preview-field-{field.key}-{previewStep}" class="block text-sm font-semibold text-gray-900 mb-1.5">
                                                        {field.label}
                                                        {#if field.required}<span class="text-red-500">*</span>{/if}
                                                    </label>
                                                    {#if field.type === 'select'}
                                                        <select
                                                            id="preview-field-{field.key}-{previewStep}"
                                                            value={previewValues[field.key] ?? ''}
                                                            onchange={(e) => previewSetValue(field.key, (e.currentTarget as HTMLSelectElement).value)}
                                                            class="preview-input"
                                                            style="--ring-color: {primaryColor}"
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
                                                            class="preview-input"
                                                            style="--ring-color: {primaryColor}"
                                                            placeholder={field.placeholder}
                                                        />
                                                    {/if}
                                                </div>
                                            {/each}
                                        </div>
                                    {/if}
                                </div>
                            {/key}

                            <!-- Buttons pinned to bottom -->
                            {#if previewCurrentStepData}
                                <div class="flex items-center justify-between gap-3 mt-auto pt-4 shrink-0">
                                    {#if previewStep > 0}
                                        <button
                                            type="button"
                                            onclick={previewPrev}
                                            class="preview-btn preview-btn-outline group"
                                            style="border-color: var(--primary); color: var(--primary)"
                                        >
                                            <svg class="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
                                            Previous
                                        </button>
                                    {:else}
                                        <span></span>
                                    {/if}
                                    <button
                                        type="button"
                                        onclick={previewNext}
                                        disabled={previewSubmitting}
                                        class="preview-btn preview-btn-primary group"
                                        style="background-color: var(--primary)"
                                    >
                                        {previewIsLastStep ? 'Generate quote' : 'Next'}
                                        {#if !previewIsLastStep}
                                            <svg class="w-4 h-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                                        {/if}
                                    </button>
                                </div>
                            {/if}
                        </div>
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

<style>
	/* Preview card overflow for transitions */
	.preview-form-card {
		position: relative;
	}

	/* Step indicator pills (preview) */
	.preview-step-dot {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8rem;
		font-weight: 600;
		border: 2px solid #e5e7eb;
		background: white;
		color: #9ca3af;
		cursor: default;
		transition: all 0.3s ease-out;
		flex-shrink: 0;
	}
	.preview-step-dot.preview-step-active {
		border-color: var(--primary);
		background-color: var(--primary);
		color: white;
		transform: scale(1.1);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 15%, transparent);
	}
	.preview-step-dot.preview-step-done {
		border-color: var(--primary);
		background-color: var(--primary);
		color: white;
		cursor: pointer;
	}
	.preview-step-dot.preview-step-done:hover {
		transform: scale(1.05);
	}
	.preview-step-dot:disabled:not(.preview-step-active):not(.preview-step-done) {
		cursor: default;
	}

	/* Step connector line (preview) */
	.preview-step-line {
		flex: 1;
		height: 2px;
		background: #e5e7eb;
		margin: 0 4px;
		border-radius: 1px;
		overflow: hidden;
	}
	.preview-step-line-fill {
		height: 100%;
		border-radius: 1px;
		transition: width 0.4s ease-out;
	}

	/* Preview inputs */
	.preview-input {
		width: 100%;
		border-radius: 0.75rem;
		border: 1.5px solid #e5e7eb;
		padding: 0.625rem 0.875rem;
		color: #111827;
		background: #fafafa;
		font-size: 0.95rem;
		transition: border-color 0.2s, box-shadow 0.2s, background-color 0.2s;
		outline: none;
	}
	.preview-input:hover {
		border-color: #d1d5db;
		background: #ffffff;
	}
	.preview-input:focus {
		border-color: var(--ring-color, #D4AF37);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring-color, #D4AF37) 12%, transparent);
		background: #ffffff;
	}
	.preview-input::placeholder {
		color: #9ca3af;
	}

	/* Preview buttons */
	.preview-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1.25rem;
		border-radius: 0.75rem;
		font-weight: 600;
		font-size: 0.95rem;
		transition: all 0.2s ease-out;
		cursor: pointer;
		border: none;
	}
	.preview-btn:active {
		transform: scale(0.97);
	}
	.preview-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.preview-btn-primary {
		color: white;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
	}
	.preview-btn-primary:hover:not(:disabled) {
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06);
		filter: brightness(1.05);
	}
	.preview-btn-outline {
		background: transparent;
		border: 2px solid;
	}
	.preview-btn-outline:hover:not(:disabled) {
		background: color-mix(in srgb, var(--primary) 8%, transparent);
	}

	/* Success checkmark animation (preview) */
	.preview-check-circle {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		border: 3px solid;
		display: flex;
		align-items: center;
		justify-content: center;
		animation: preview-check-pop 0.5s ease-out;
	}
	.preview-check-icon {
		width: 32px;
		height: 32px;
	}
	.preview-check-path {
		stroke-dasharray: 30;
		stroke-dashoffset: 30;
		animation: preview-check-draw 0.4s 0.3s ease-out forwards;
	}
	@keyframes preview-check-pop {
		0% { transform: scale(0); opacity: 0; }
		50% { transform: scale(1.15); }
		100% { transform: scale(1); opacity: 1; }
	}
	@keyframes preview-check-draw {
		to { stroke-dashoffset: 0; }
	}

	/* Loading ring (preview) */
	.preview-loading-ring {
		width: 48px;
		height: 48px;
		position: relative;
	}
	.preview-loading-ring-inner {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		border: 4px solid #e5e7eb;
		border-top-color: var(--ring-color, #D4AF37);
		animation: preview-ring-spin 0.8s linear infinite;
	}
	@keyframes preview-ring-spin {
		to { transform: rotate(360deg); }
	}

	/* Reduced-motion */
	@media (prefers-reduced-motion: reduce) {
		.preview-step-dot,
		.preview-step-line-fill,
		.preview-input,
		.preview-btn {
			transition-duration: 0.01ms !important;
		}
		.preview-check-circle,
		.preview-check-path {
			animation-duration: 0.01ms !important;
		}
	}
</style>
