<script lang="ts">
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

	const totalSteps = $derived(steps.length);
	const isLastStep = $derived(currentStep === totalSteps - 1);
	const currentStepData = $derived(steps[currentStep]);

	function setValue(key: string, value: string) {
		values = { ...values, [key]: value };
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
		if (isLastStep) {
			submit();
		} else {
			currentStep += 1;
		}
	}

	function prev() {
		error = '';
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

<div class="min-h-[400px] w-full max-w-lg mx-auto p-6 bg-white rounded-2xl shadow-lg flex flex-col" style="--primary: {primaryColor}">
	{#if showSuccess}
		<!-- Success: optional download + configured buttons + start over -->
		<div class="text-center py-6">
			<h2 class="text-xl font-bold text-gray-900 mb-2">{successTitle}</h2>
			<p class="text-gray-500 text-sm mb-6 whitespace-pre-line">{successMessage}</p>
			<div class="flex flex-wrap gap-3 justify-center">
				{#each successButtons as btn}
					{#if btn.linkToQuote && pdfUrl}
						<a
							href={pdfUrl}
							target="_blank"
							rel="noopener"
							class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-white transition-colors"
							style="background-color: var(--primary)"
						>
							{btn.label || 'Download Quote'}
						</a>
					{:else if !btn.linkToQuote && (btn.url ?? '').trim()}
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
				<button
					type="button"
					onclick={startOver}
					class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold border-2 transition-colors"
					style="border-color: var(--primary); color: var(--primary); background: transparent"
				>
					Submit again
				</button>
			</div>
		</div>
	{:else if submitting}
		<!-- Loading: spinner + message -->
		<div class="flex flex-col items-center justify-center gap-4 py-16">
			<div
				class="w-12 h-12 rounded-full border-4 border-gray-200 animate-spin shrink-0"
				style="border-top-color: var(--primary)"
				role="status"
				aria-label="Generating quote"
			></div>
			<div class="text-center">
				<h2 class="text-lg font-semibold text-gray-900 mb-1">Submitting…</h2>
				<p class="text-sm text-gray-500">Please wait a moment.</p>
			</div>
		</div>
	{:else}
		<!-- Multi-step form: step dots top, content centered, buttons bottom -->
		<div class="flex flex-col min-h-[360px] flex-1">
			<!-- Step indicator at top -->
			<div class="flex items-center justify-center gap-2 mb-6 shrink-0">
				{#each steps as _, i}
					<div
						class="flex items-center"
						aria-current={i === currentStep ? 'step' : undefined}
					>
						<div
							class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors"
							style:background-color={i <= currentStep ? primaryColor : '#e5e7eb'}
							style:color={i <= currentStep ? 'white' : '#9ca3af'}
						>
							{i + 1}
						</div>
						{#if i < totalSteps - 1}
							<div
								class="w-8 h-0.5 mx-0.5"
								style="background-color: {i < currentStep ? primaryColor : '#e5e7eb'}"
							></div>
						{/if}
					</div>
				{/each}
			</div>

			<!-- Content centered in container -->
			{#if currentStepData}
				<div class="flex-1 flex flex-col items-center justify-center text-center">
					<h1 class="text-xl font-bold text-gray-900 mb-1 w-full">{title}</h1>
					{#if currentStepData.description}
						<p class="text-sm text-gray-500 mb-6 w-full">{currentStepData.description}</p>
					{:else}
						<p class="text-sm text-gray-500 mb-6 w-full">Step {currentStep + 1} of {totalSteps}</p>
					{/if}

					{#if error}
						<div class="mb-4 w-full p-3 rounded-lg bg-red-50 text-red-800 text-sm">{error}</div>
					{/if}

					<div class="space-y-4 w-full max-w-sm mx-auto">
						{#each currentStepData.fields as field}
							<div class="text-left">
								<label for="embed-field-{field.key}-{currentStep}" class="block text-sm font-semibold text-gray-900 mb-1">
									{field.label}
									{#if field.required}<span class="text-red-500">*</span>{/if}
								</label>
								{#if field.type === 'select'}
									<select
										id="embed-field-{field.key}-{currentStep}"
										bind:value={values[field.key]}
										class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:ring-2 focus:ring-offset-0"
										style="--tw-ring-color: {primaryColor}"
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
										class="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:ring-2 focus:ring-offset-0 focus:border-transparent"
										style="--tw-ring-color: {primaryColor}"
										placeholder={field.placeholder}
									/>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Buttons pinned to bottom -->
			{#if currentStepData}
				<div class="flex items-center justify-between gap-3 mt-auto pt-6 shrink-0">
					{#if currentStep > 0}
						<button
							type="button"
							onclick={prev}
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
						onclick={next}
						disabled={submitting}
						class="px-5 py-2.5 rounded-lg font-semibold text-white transition-colors disabled:opacity-50"
						style="background-color: var(--primary)"
					>
						{submitting ? 'Submitting…' : isLastStep ? 'Submit' : 'Next'}
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
