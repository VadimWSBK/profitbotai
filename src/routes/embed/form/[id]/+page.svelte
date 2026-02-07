<script lang="ts">
	import { fly, fade, scale } from 'svelte/transition';
	import { cubicOut, cubicInOut, backOut } from 'svelte/easing';
	import { onMount } from 'svelte';

	type Field = { key: string; label: string; required: boolean; placeholder?: string; type?: string };
	type Step = { title: string; description?: string; fields: Field[] };

	let { data } = $props();
	const formId = $derived((data?.formId as string) ?? '');
	type SuccessButton = { label: string; url: string; linkToQuote?: boolean };
	const form = $derived((data?.form as { name: string; title: string; steps: Step[]; colors: Record<string, string>; success_title?: string | null; success_message?: string | null; success_buttons?: SuccessButton[] }) ?? { title: 'Get Your Quote', steps: [], colors: {}, success_buttons: [] });

	const steps = $derived((form.steps ?? []) as Step[]);
	const primaryColor = $derived(form.colors?.primary ?? '#D4AF37');
	const title = $derived(form.title ?? 'Get Your Quote');
	const successTitle = $derived(form.success_title?.trim() || 'Thank you');
	const successMessage = $derived(form.success_message?.trim() || "We'll be in touch soon.");
	const successButtons = $derived((form.success_buttons ?? []) as SuccessButton[]);

	let currentStep = $state(0);
	let values = $state<Record<string, string>>({});
	let submitting = $state(false);
	let error = $state('');
	let showSuccess = $state(false);
	let pdfUrl = $state<string | null>(null);
	let slideDirection = $state<'forward' | 'backward'>('forward');
	let mounted = $state(false);

	// Reduced-motion support
	let prefersReducedMotion = $state(false);
	function dur(ms: number) { return prefersReducedMotion ? 0 : ms; }

	onMount(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		prefersReducedMotion = mq.matches;
		mq.addEventListener('change', (e) => { prefersReducedMotion = e.matches; });
		// Trigger mount animation
		requestAnimationFrame(() => { mounted = true; });
	});

	const totalSteps = $derived(steps.length);
	const isLastStep = $derived(currentStep === totalSteps - 1);
	const currentStepData = $derived(steps[currentStep]);
	// Progress as a percentage for the progress bar
	const progressPercent = $derived(totalSteps > 1 ? (currentStep / (totalSteps - 1)) * 100 : 100);

	function setValue(key: string, value: string) {
		values = { ...values, [key]: value };
		// Clear error when user starts typing
		if (error) error = '';
	}

	function next() {
		const step = steps[currentStep];
		if (!step) return;
		for (const f of step.fields) {
			if (f.required && !(values[f.key] ?? '').trim()) {
				error = `${f.label} is required`;
				return;
			}
		}
		error = '';
		slideDirection = 'forward';
		if (isLastStep) {
			submit();
		} else {
			currentStep += 1;
		}
	}

	function prev() {
		error = '';
		slideDirection = 'backward';
		if (currentStep > 0) currentStep -= 1;
	}

	async function submit() {
		submitting = true;
		error = '';
		try {
			const body: Record<string, string | number> = {
				name: values.name ?? '',
				email: (values.email ?? '').trim().toLowerCase(),
				phone: values.phone ?? '',
				street_address: values.street_address ?? '',
				post_code: values.post_code ?? '',
				city: values.city ?? '',
				state: values.state ?? ''
			};
			const roofSize = Number(values.roof_size);
			if (!isNaN(roofSize) && roofSize > 0) body.roofSize = roofSize;

			const res = await fetch(`/api/forms/${formId}/submit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Failed to submit');
			pdfUrl = result.pdfUrl ?? null;
			showSuccess = true;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to submit';
		} finally {
			submitting = false;
		}
	}

	function startOver() {
		slideDirection = 'backward';
		currentStep = 0;
		values = {};
		error = '';
		showSuccess = false;
		pdfUrl = null;
	}
</script>

<svelte:head>
	<title>{title} – ProfitBot</title>
</svelte:head>

<div
	class="form-container min-h-[400px] w-full max-w-lg mx-auto bg-white rounded-2xl shadow-lg flex flex-col overflow-hidden"
	class:form-mounted={mounted}
	style="--primary: {primaryColor}"
>
	{#if showSuccess}
		<!-- Success state -->
		<div class="flex-1 flex flex-col items-center justify-center p-6" in:scale={{ start: 0.9, duration: dur(400), easing: backOut }}>
			<!-- Animated checkmark -->
			<div class="success-check-circle" style="border-color: var(--primary)">
				<svg class="success-check-icon" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
					<path class="success-check-path" d="M5 13l4 4L19 7" />
				</svg>
			</div>

			<h2 class="text-xl font-bold text-gray-900 mb-2 mt-6" in:fly={{ y: 8, duration: dur(300), delay: dur(200), easing: cubicOut }}>{successTitle}</h2>
			<p class="text-gray-500 text-sm mb-6 whitespace-pre-line text-center" in:fly={{ y: 8, duration: dur(300), delay: dur(300), easing: cubicOut }}>{successMessage}</p>

			<div class="flex flex-wrap gap-3 justify-center" in:fly={{ y: 8, duration: dur(300), delay: dur(400), easing: cubicOut }}>
				{#each successButtons as btn, idx}
					{#if btn.linkToQuote && pdfUrl}
						<a
							href={pdfUrl}
							target="_blank"
							rel="noopener"
							class="form-btn form-btn-primary"
							style="background-color: var(--primary)"
							in:fly={{ y: 6, duration: dur(250), delay: dur(450 + idx * 60), easing: cubicOut }}
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
							{btn.label || 'Download Quote'}
						</a>
					{:else if !btn.linkToQuote && (btn.url ?? '').trim()}
						<a
							href={btn.url}
							target="_blank"
							rel="noopener"
							class="form-btn form-btn-primary"
							style="background-color: var(--primary)"
							in:fly={{ y: 6, duration: dur(250), delay: dur(450 + idx * 60), easing: cubicOut }}
						>
							{btn.label || 'Button'}
						</a>
					{/if}
				{/each}
				<button
					type="button"
					onclick={startOver}
					class="form-btn form-btn-outline"
					style="border-color: var(--primary); color: var(--primary)"
				>
					Submit again
				</button>
			</div>
		</div>
	{:else if submitting}
		<!-- Loading state -->
		<div class="flex-1 flex flex-col items-center justify-center gap-5 p-6" in:fade={{ duration: dur(200) }}>
			<div class="loading-ring" style="--ring-color: {primaryColor}">
				<div class="loading-ring-inner"></div>
			</div>
			<div class="text-center" in:fly={{ y: 8, duration: dur(300), delay: dur(100), easing: cubicOut }}>
				<h2 class="text-lg font-semibold text-gray-900 mb-1">Submitting…</h2>
				<p class="text-sm text-gray-500">Please wait a moment.</p>
			</div>
		</div>
	{:else}
		<!-- Multi-step form -->
		<div class="flex flex-col min-h-[360px] flex-1 p-6">
			<!-- Progress bar (modern alternative to dots) -->
			{#if totalSteps > 1}
				<div class="mb-6 shrink-0">
					<div class="flex items-center justify-between mb-2">
						{#each steps as _, i}
							<button
								type="button"
								class="step-indicator"
								class:step-active={i === currentStep}
								class:step-completed={i < currentStep}
								style:--primary={primaryColor}
								onclick={() => { if (i < currentStep) { slideDirection = 'backward'; currentStep = i; error = ''; } }}
								disabled={i > currentStep}
								aria-current={i === currentStep ? 'step' : undefined}
								aria-label="Step {i + 1}"
							>
								{#if i < currentStep}
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>
								{:else}
									{i + 1}
								{/if}
							</button>
							{#if i < totalSteps - 1}
								<div class="step-connector">
									<div
										class="step-connector-fill"
										style="width: {i < currentStep ? '100%' : '0%'}; background-color: {primaryColor}"
									></div>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/if}

			<!-- Step content with slide transition -->
			{#key currentStep}
				<div
					class="flex-1 flex flex-col items-center justify-center text-center"
					in:fly={{ x: slideDirection === 'forward' ? 30 : -30, duration: dur(300), easing: cubicOut }}
					out:fly={{ x: slideDirection === 'forward' ? -30 : 30, duration: dur(200), easing: cubicOut }}
				>
					{#if currentStepData}
						<h1 class="text-xl font-bold text-gray-900 mb-1 w-full">{title}</h1>
						{#if currentStepData.description}
							<p class="text-sm text-gray-500 mb-6 w-full">{currentStepData.description}</p>
						{:else}
							<p class="text-sm text-gray-500 mb-6 w-full">Step {currentStep + 1} of {totalSteps}</p>
						{/if}

						{#if error}
							<div
								class="mb-4 w-full p-3 rounded-lg bg-red-50 text-red-800 text-sm flex items-center gap-2"
								in:fly={{ y: -8, duration: dur(250), easing: cubicOut }}
							>
								<svg class="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
								{error}
							</div>
						{/if}

						<div class="space-y-4 w-full max-w-sm mx-auto">
							{#each currentStepData.fields as field, fi}
								<div class="text-left" in:fly={{ y: 10, duration: dur(280), delay: dur(fi * 50), easing: cubicOut }}>
									<label for="embed-field-{field.key}-{currentStep}" class="block text-sm font-semibold text-gray-900 mb-1.5">
										{field.label}
										{#if field.required}<span class="text-red-500">*</span>{/if}
									</label>
									{#if field.type === 'select'}
										<select
											id="embed-field-{field.key}-{currentStep}"
											bind:value={values[field.key]}
											class="form-input"
											style="--ring-color: {primaryColor}"
											placeholder={field.placeholder}
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
											id="embed-field-{field.key}-{currentStep}"
											type={field.key === 'email' ? 'email' : field.key === 'phone' ? 'tel' : 'text'}
											bind:value={values[field.key]}
											class="form-input"
											style="--ring-color: {primaryColor}"
											placeholder={field.placeholder}
											oninput={() => { if (error) error = ''; }}
										/>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/key}

			<!-- Buttons pinned to bottom -->
			{#if currentStepData}
				<div class="flex items-center justify-between gap-3 mt-auto pt-6 shrink-0">
					{#if currentStep > 0}
						<button
							type="button"
							onclick={prev}
							class="form-btn form-btn-outline group"
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
						onclick={next}
						disabled={submitting}
						class="form-btn form-btn-primary group"
						style="background-color: var(--primary)"
					>
						{submitting ? 'Submitting…' : isLastStep ? 'Submit' : 'Next'}
						{#if !isLastStep}
							<svg class="w-4 h-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
						{/if}
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* Container entrance */
	.form-container {
		opacity: 0;
		transform: translateY(12px);
		transition: opacity 0.4s ease-out, transform 0.4s ease-out;
	}
	.form-container.form-mounted {
		opacity: 1;
		transform: translateY(0);
	}

	/* Step indicator pills */
	.step-indicator {
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
	.step-indicator.step-active {
		border-color: var(--primary);
		background-color: var(--primary);
		color: white;
		transform: scale(1.1);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 15%, transparent);
	}
	.step-indicator.step-completed {
		border-color: var(--primary);
		background-color: var(--primary);
		color: white;
		cursor: pointer;
	}
	.step-indicator.step-completed:hover {
		transform: scale(1.05);
	}
	.step-indicator:disabled:not(.step-active):not(.step-completed) {
		cursor: default;
	}

	/* Step connector line */
	.step-connector {
		flex: 1;
		height: 2px;
		background: #e5e7eb;
		margin: 0 4px;
		border-radius: 1px;
		overflow: hidden;
	}
	.step-connector-fill {
		height: 100%;
		border-radius: 1px;
		transition: width 0.4s ease-out;
	}

	/* Form inputs */
	.form-input {
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
	.form-input:hover {
		border-color: #d1d5db;
		background: #ffffff;
	}
	.form-input:focus {
		border-color: var(--ring-color, #D4AF37);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring-color, #D4AF37) 12%, transparent);
		background: #ffffff;
	}
	.form-input::placeholder {
		color: #9ca3af;
	}

	/* Buttons */
	.form-btn {
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
		position: relative;
		overflow: hidden;
	}
	.form-btn:active {
		transform: scale(0.97);
	}
	.form-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.form-btn-primary {
		color: white;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
	}
	.form-btn-primary:hover:not(:disabled) {
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06);
		filter: brightness(1.05);
	}
	.form-btn-outline {
		background: transparent;
		border: 2px solid;
	}
	.form-btn-outline:hover:not(:disabled) {
		background: color-mix(in srgb, var(--primary) 8%, transparent);
	}

	/* Success checkmark animation */
	.success-check-circle {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		border: 3px solid;
		display: flex;
		align-items: center;
		justify-content: center;
		animation: check-circle-pop 0.5s ease-out;
	}
	.success-check-icon {
		width: 32px;
		height: 32px;
	}
	.success-check-path {
		stroke-dasharray: 30;
		stroke-dashoffset: 30;
		animation: check-draw 0.4s 0.3s ease-out forwards;
	}
	@keyframes check-circle-pop {
		0% { transform: scale(0); opacity: 0; }
		50% { transform: scale(1.15); }
		100% { transform: scale(1); opacity: 1; }
	}
	@keyframes check-draw {
		to { stroke-dashoffset: 0; }
	}

	/* Loading ring */
	.loading-ring {
		width: 48px;
		height: 48px;
		position: relative;
	}
	.loading-ring-inner {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		border: 4px solid #e5e7eb;
		border-top-color: var(--ring-color, #D4AF37);
		animation: ring-spin 0.8s linear infinite;
	}
	@keyframes ring-spin {
		to { transform: rotate(360deg); }
	}

	/* Reduced-motion */
	@media (prefers-reduced-motion: reduce) {
		.form-container {
			transition-duration: 0.01ms !important;
		}
		.step-indicator,
		.step-connector-fill,
		.form-input,
		.form-btn {
			transition-duration: 0.01ms !important;
		}
		.success-check-circle,
		.success-check-path {
			animation-duration: 0.01ms !important;
		}
		.loading-ring-inner {
			animation-duration: 0.8s; /* Keep spinner visible */
		}
	}
</style>
