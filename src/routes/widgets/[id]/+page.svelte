<script lang="ts">
	import WidgetPreview from '$lib/components/WidgetPreview.svelte';
	import IconUrlField from '$lib/components/IconUrlField.svelte';
	import { defaultWidgetConfig, type WidgetConfig, type WebhookTrigger } from '$lib/widget-config';
	import { getModels } from '$lib/llm-providers';

	function slugFromName(name: string): string {
		const base = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'trigger';
		return base;
	}

	type MainTab = 'customize' | 'connect' | 'train' | 'embed';
	type CustomizeTab = 'bubble' | 'tooltip' | 'window' | 'footer' | 'advanced';

	const customizeTabs: CustomizeTab[] = ['bubble', 'tooltip', 'window', 'footer', 'advanced'];

	let { data } = $props();
	const widgetId = $derived((data.widgetId as string) ?? '');
	const llmKeysAvailable = $derived((data.llmKeysAvailable as string[]) ?? []);
	const initial = $derived((data.initial as {
		id: string;
		name: string;
		displayMode: string;
		config: Partial<WidgetConfig>;
		n8nWebhookUrl?: string;
	}) ?? null);

	function deepMerge<T extends object>(target: T, source: Partial<T>): T {
		const out = { ...target } as T;
		for (const key of Object.keys(source) as (keyof T)[]) {
			const s = source[key];
			if (s === undefined) continue;
			const tVal = target[key];
			if (s !== null && typeof s === 'object' && !Array.isArray(s) && tVal !== null && typeof tVal === 'object' && !Array.isArray(tVal)) {
				out[key] = deepMerge(tVal as object, s as object) as T[keyof T];
			} else {
				(out[key] as T[keyof T]) = s as T[keyof T];
			}
		}
		return out;
	}

	const base = JSON.parse(JSON.stringify(defaultWidgetConfig)) as WidgetConfig;
	const mergedConfig = $derived(
		initial?.config
			? deepMerge(base, {
					...initial.config,
					name: initial.name ?? initial.config.name,
					displayMode: (initial.displayMode ?? initial.config.displayMode) as WidgetConfig['displayMode'],
					n8nWebhookUrl: initial.n8nWebhookUrl ?? initial.config.n8nWebhookUrl ?? '',
					webhookTriggers: (initial.config as { webhookTriggers?: WebhookTrigger[] })?.webhookTriggers ?? []
				})
			: base
	);

	let config = $state<WidgetConfig>(base);
	$effect(() => {
		config = mergedConfig;
	});
	let mainTab = $state<MainTab>('customize');
	let customizeTab = $state<CustomizeTab>('bubble');
	let saving = $state(false);
	let embedCopied = $state(false);
	let botMessageSettingsOpen = $state(true);
	let trainStatus = $state<{ configured: boolean; documentCount: number } | null>(null);
	let trainUploading = $state(false);
	let trainScraping = $state(false);
	let trainUploadFile = $state<File | null>(null);
	let trainScrapeUrl = $state('');

	async function save() {
		saving = true;
		try {
			const res = await fetch(`/api/widgets/${widgetId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: config.name,
					display_mode: config.displayMode,
					config: {
						bubble: config.bubble,
						tooltip: config.tooltip,
						window: config.window,
						bot: config.bot,
						chatBackend: config.chatBackend,
						llmProvider: config.llmProvider ?? '',
						llmModel: config.llmModel ?? '',
						llmFallbackProvider: config.llmFallbackProvider ?? '',
						llmFallbackModel: config.llmFallbackModel ?? '',
						agentTakeoverTimeoutMinutes: config.agentTakeoverTimeoutMinutes ?? 5,
						webhookTriggers: config.webhookTriggers ?? []
					},
					n8n_webhook_url: config.n8nWebhookUrl
				})
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Failed to save');
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to save');
		} finally {
			saving = false;
		}
	}

	function copyEmbedCode() {
		const code = getEmbedSnippet();
		navigator.clipboard.writeText(code).then(() => {
			embedCopied = true;
			setTimeout(() => (embedCopied = false), 2000);
		});
	}

	function addStarterPrompt() {
		config.window.starterPrompts = [...config.window.starterPrompts, ''];
	}

	function addTrigger() {
		if (!config.webhookTriggers) config.webhookTriggers = [];
		const name = 'New trigger';
		const id = slugFromName(name);
		const existingIds = new Set(config.webhookTriggers.map((t) => t.id));
		let uniqueId = id;
		let n = 1;
		while (existingIds.has(uniqueId)) {
			uniqueId = `${id}_${n}`;
			n += 1;
		}
		config.webhookTriggers = [
			...config.webhookTriggers,
			{ id: uniqueId, name, description: '', webhookUrl: '', enabled: true }
		];
	}

	function removeTrigger(index: number) {
		if (!config.webhookTriggers) return;
		config.webhookTriggers = config.webhookTriggers.filter((_, i) => i !== index);
	}

	function getEmbedSnippet(): string {
		const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com';
		return `<script src="${origin}/embed/chat-widget.js" data-widget-id="${widgetId}"><\/script>`;
	}

	async function fetchTrainStatus() {
		if (!widgetId) return;
		try {
			const res = await fetch(`/api/widgets/${widgetId}/train`);
			const data = await res.json().catch(() => ({}));
			trainStatus = { configured: data.configured ?? false, documentCount: data.documentCount ?? 0 };
		} catch {
			trainStatus = { configured: false, documentCount: 0 };
		}
	}

	async function trainUpload() {
		if (!trainUploadFile || !widgetId) return;
		trainUploading = true;
		try {
			const form = new FormData();
			form.append('file', trainUploadFile);
			const res = await fetch(`/api/widgets/${widgetId}/train/upload`, { method: 'POST', body: form });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Upload failed');
			alert(`Added ${data.chunks ?? 0} chunks to the knowledge base.`);
			trainUploadFile = null;
			fetchTrainStatus();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Upload failed');
		} finally {
			trainUploading = false;
		}
	}

	async function trainScrape() {
		const url = trainScrapeUrl.trim();
		if (!url || !widgetId) return;
		trainScraping = true;
		try {
			const res = await fetch(`/api/widgets/${widgetId}/train/scrape`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Scrape failed');
			alert(`Added ${data.chunks ?? 0} chunks to the knowledge base.`);
			trainScrapeUrl = '';
			fetchTrainStatus();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Scrape failed');
		} finally {
			trainScraping = false;
		}
	}

	$effect(() => {
		if (mainTab === 'train' && widgetId) fetchTrainStatus();
	});
</script>

<svelte:head>
	<title>{config.name} – Edit Widget</title>
</svelte:head>

<div class="max-w-3xl mx-auto">
	<header class="flex flex-wrap items-center justify-between gap-4 mb-6">
		<div class="flex items-center gap-2 flex-wrap">
			<input
				type="text"
				class="text-xl font-bold text-gray-900 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-amber-500 focus:outline-none px-0 py-1"
				bind:value={config.name}
				placeholder="Widget name"
			/>
			<span class="text-xs font-medium px-2 py-1 rounded bg-gray-200 text-gray-700">
				{config.displayMode === 'popup' ? 'Popup' : config.displayMode === 'standalone' ? 'Standalone' : 'Embedded'}
			</span>
		</div>
		<div class="flex items-center gap-2">
			<select
				bind:value={config.displayMode}
				class="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none"
			>
				<option value="popup">Popup</option>
				<option value="standalone">Standalone</option>
				<option value="embedded">Embedded</option>
			</select>
			<button
				type="button"
				onclick={save}
				disabled={saving}
				class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors"
			>
				{saving ? 'Saving…' : 'Save'}
			</button>
		</div>
	</header>
	<p class="text-gray-500 text-sm mb-6">Customize your widget's appearance and behavior.</p>

	<nav class="flex gap-6 border-b border-gray-200 mb-6">
		<button
			type="button"
			class="pb-3 text-sm font-medium border-b-2 transition-colors {mainTab === 'customize' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
			onclick={() => (mainTab = 'customize')}
		>
			Customize
		</button>
		<button
			type="button"
			class="pb-3 text-sm font-medium border-b-2 transition-colors {mainTab === 'connect' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
			onclick={() => (mainTab = 'connect')}
		>
			Connect
		</button>
		<button
			type="button"
			class="pb-3 text-sm font-medium border-b-2 transition-colors {mainTab === 'train' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
			onclick={() => (mainTab = 'train')}
		>
			Train Bot
		</button>
		<button
			type="button"
			class="pb-3 text-sm font-medium border-b-2 transition-colors {mainTab === 'embed' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
			onclick={() => (mainTab = 'embed')}
		>
			Embed
		</button>
	</nav>

	{#if mainTab === 'customize'}
		<nav class="flex flex-wrap gap-2 mb-6">
			{#each customizeTabs as tab}
				<button
					type="button"
					class="px-3 py-2 text-sm font-medium rounded-lg transition-colors {customizeTab === tab ? 'bg-amber-100 text-amber-800' : tab === 'footer' ? 'text-gray-400 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'}"
					onclick={() => tab !== 'footer' && (customizeTab = tab)}
					disabled={tab === 'footer'}
				>
					{tab === 'footer' ? 'Footer 🔒' : tab.charAt(0).toUpperCase() + tab.slice(1)}
				</button>
			{/each}
		</nav>
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			{#if customizeTab === 'bubble'}
				<h3 class="text-lg font-semibold text-gray-900 mb-1">Customize Chat Bubble</h3>
				<p class="text-gray-500 text-sm mb-6">Modify the appearance of your chat bubble including its size, position, colors, and custom icon.</p>
				<div class="space-y-4">
					<label class="block">
						<span class="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">Border Radius Style ⓘ</span>
						<div class="flex gap-4">
							{#each ['circle', 'rounded', 'none'] as style}
								<label class="flex items-center gap-2 cursor-pointer">
									<input type="radio" name="bubble-radius-edit" value={style} bind:group={config.bubble.borderRadiusStyle} />
									<span class="text-sm capitalize">{style}</span>
								</label>
							{/each}
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Background Color ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.bubble.backgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="text" bind:value={config.bubble.backgroundColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
						</div>
					</label>
					<IconUrlField bind:value={config.bubble.customIconUrl} uploadUrl={widgetId ? `/api/widgets/${widgetId}/upload` : '/api/widgets/upload'} label="Chat bubble icon (URL or upload)" />
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Custom Icon Size (%) ⓘ</span>
						<input type="range" min="20" max="100" bind:value={config.bubble.customIconSize} class="w-full accent-amber-600" />
						<span class="text-sm text-gray-500">{config.bubble.customIconSize}%</span>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Custom Icon Border Radius ⓘ</span>
						<input type="range" min="0" max="50" bind:value={config.bubble.customIconBorderRadius} class="w-full accent-amber-600" />
						<span class="text-sm text-gray-500">{config.bubble.customIconBorderRadius}</span>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Color of Internal Icons ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.bubble.colorOfInternalIcons} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="text" bind:value={config.bubble.colorOfInternalIcons} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
						</div>
					</label>
					<div class="grid grid-cols-3 gap-4">
						<label class="block">
							<span class="text-sm font-medium text-gray-700 mb-1">Bubble Size (px) ⓘ</span>
							<input type="number" min="32" max="120" bind:value={config.bubble.bubbleSizePx} class="w-full px-3 py-2 border border-gray-300 rounded-lg" />
						</label>
						<label class="block">
							<span class="text-sm font-medium text-gray-700 mb-1">Right Position (px) ⓘ</span>
							<input type="number" min="0" max="100" bind:value={config.bubble.rightPositionPx} class="w-full px-3 py-2 border border-gray-300 rounded-lg" />
						</label>
						<label class="block">
							<span class="text-sm font-medium text-gray-700 mb-1">Bottom Position (px) ⓘ</span>
							<input type="number" min="0" max="100" bind:value={config.bubble.bottomPositionPx} class="w-full px-3 py-2 border border-gray-300 rounded-lg" />
						</label>
					</div>
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={config.bubble.autoOpenBotWindow} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
						<span class="text-sm font-medium text-gray-700">Auto Open Bot Window ⓘ</span>
					</label>
				</div>
			{:else if customizeTab === 'tooltip'}
				<h3 class="text-lg font-semibold text-gray-900 mb-1">Customize Tooltip</h3>
				<p class="text-gray-500 text-sm mb-6">Configure the tooltip that appears when users hover over the chat button.</p>
				<div class="space-y-4">
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={config.tooltip.displayTooltip} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
						<span class="text-sm font-medium text-gray-700">Display Tooltip ⓘ</span>
					</label>
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={config.tooltip.hideTooltipOnMobile} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
						<span class="text-sm font-medium text-gray-700">Hide Tooltip on Mobile ⓘ</span>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Message ⓘ</span>
						<input type="text" bind:value={config.tooltip.message} class="w-full px-3 py-2 border border-gray-300 rounded-lg" />
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Background Color ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.tooltip.backgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="text" bind:value={config.tooltip.backgroundColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Text Color ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.tooltip.textColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="text" bind:value={config.tooltip.textColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Font Size (px) ⓘ</span>
						<input type="number" min="10" max="24" bind:value={config.tooltip.fontSizePx} class="w-full max-w-[120px] px-3 py-2 border border-gray-300 rounded-lg" />
					</label>
				</div>
			{:else if customizeTab === 'window'}
				<h3 class="text-lg font-semibold text-gray-900 mb-1">Customize Chat Window</h3>
				<p class="text-gray-500 text-sm mb-6">Design your chat interface.</p>
				<div class="space-y-4">
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Border Radius Style ⓘ</span>
						<div class="flex gap-4">
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="radio" name="window-radius-edit" value="rounded" bind:group={config.window.borderRadiusStyle} />
								<span class="text-sm">Rounded</span>
							</label>
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="radio" name="window-radius-edit" value="none" bind:group={config.window.borderRadiusStyle} />
								<span class="text-sm">None</span>
							</label>
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Title ⓘ</span>
						<input type="text" bind:value={config.window.title} class="w-full px-3 py-2 border border-gray-300 rounded-lg" />
					</label>
					<IconUrlField bind:value={config.window.titleAvatarUrl} uploadUrl={widgetId ? `/api/widgets/${widgetId}/upload` : '/api/widgets/upload'} label="Header logo (URL or upload)" />
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Header background color ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.window.headerBackgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="text" bind:value={config.window.headerBackgroundColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Header text color ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.window.headerTextColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="text" bind:value={config.window.headerTextColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Welcome Message ⓘ</span>
						<textarea bind:value={config.window.welcomeMessage} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-[80px]"></textarea>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Custom Error Message ⓘ</span>
						<input type="text" bind:value={config.window.customErrorMessage} class="w-full px-3 py-2 border border-gray-300 rounded-lg" />
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Starter Prompts ⓘ</span>
						<div class="space-y-2">
							{#each config.window.starterPrompts as _, i}
								<div class="flex gap-2">
									<input type="text" bind:value={config.window.starterPrompts[i]} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
									<button type="button" class="p-2 text-gray-500 hover:text-red-600 rounded-lg hover:bg-red-50" onclick={() => (config.window.starterPrompts = config.window.starterPrompts.filter((__, j) => j !== i))} title="Remove">🗑</button>
								</div>
							{/each}
							<button type="button" class="text-sm text-amber-600 hover:text-amber-700 font-medium" onclick={addStarterPrompt}>+ Add Prompt</button>
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Starter prompt colors ⓘ</span>
						<div class="flex flex-wrap gap-2 items-center">
							<input type="color" bind:value={config.window.starterPromptBackgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" title="Background" />
							<input type="color" bind:value={config.window.starterPromptTextColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" title="Text" />
							<input type="color" bind:value={config.window.starterPromptBorderColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" title="Border" />
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Header icon color ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.window.headerIconColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="text" bind:value={config.window.headerIconColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Input & send button colors ⓘ</span>
						<div class="flex flex-wrap gap-2 items-center">
							<input type="color" bind:value={config.window.inputBackgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" title="Input bg" />
							<input type="color" bind:value={config.window.inputBorderColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" title="Input border" />
							<input type="color" bind:value={config.window.inputPlaceholderColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" title="Placeholder" />
							<input type="color" bind:value={config.window.sendButtonBackgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" title="Send bg" />
							<input type="color" bind:value={config.window.sendButtonIconColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" title="Send icon" />
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Footer & section border ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.window.footerBackgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="color" bind:value={config.window.footerTextColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="color" bind:value={config.window.sectionBorderColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
						</div>
					</label>
					<div class="border border-gray-200 rounded-lg overflow-hidden">
						<button type="button" class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left font-medium text-gray-800" onclick={() => (botMessageSettingsOpen = !botMessageSettingsOpen)}>
							Bot Message Settings
							<svg class="w-5 h-5 transition-transform {botMessageSettingsOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
						</button>
						{#if botMessageSettingsOpen}
							<div class="p-4 space-y-4 border-t border-gray-200">
								<label class="block">
									<span class="text-sm font-medium text-gray-700 mb-1">Bot message bubble background & text ⓘ</span>
									<div class="flex gap-2 items-center">
										<input type="color" bind:value={config.window.botMessageSettings.backgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
										<input type="color" bind:value={config.window.botMessageSettings.textColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
									</div>
								</label>
								<label class="flex items-center gap-2">
									<input type="checkbox" bind:checked={config.window.botMessageSettings.showAvatar} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
									<span class="text-sm font-medium text-gray-700">Show Avatar ⓘ</span>
								</label>
								<IconUrlField bind:value={config.window.botMessageSettings.avatarUrl} uploadUrl={widgetId ? `/api/widgets/${widgetId}/upload` : '/api/widgets/upload'} label="Bot avatar (URL or upload)" />
							</div>
						{/if}
					</div>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Height (px) ⓘ</span>
						<input type="number" min="300" max="900" bind:value={config.window.heightPx} class="w-full max-w-[120px] px-3 py-2 border border-gray-300 rounded-lg" />
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Width (px) ⓘ</span>
						<input type="number" min="320" max="500" bind:value={config.window.widthPx} class="w-full max-w-[120px] px-3 py-2 border border-gray-300 rounded-lg" />
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Footer Text ⓘ</span>
						<input type="text" bind:value={config.window.footerText} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Input Placeholder ⓘ</span>
						<input type="text" bind:value={config.window.inputPlaceholder} class="w-full px-3 py-2 border border-gray-300 rounded-lg" />
					</label>
				</div>
			{:else if customizeTab === 'advanced'}
				<h3 class="text-lg font-semibold text-gray-900 mb-1">Advanced</h3>
				<p class="text-gray-500 text-sm mb-6">Extra options coming soon.</p>
			{/if}
		</div>
	{:else if mainTab === 'connect'}
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h3 class="text-lg font-semibold text-gray-900 mb-1">Connect</h3>
			<p class="text-gray-500 text-sm mb-6">Use an n8n webhook or a Direct LLM (API keys set in Settings).</p>

			<label class="block mb-4">
				<span class="text-sm font-medium text-gray-700 mb-2 block">Backend</span>
				<select bind:value={config.chatBackend} class="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm">
					<option value="n8n">n8n Webhook</option>
					<option value="direct">Direct LLM</option>
				</select>
			</label>

			{#if config.chatBackend === 'n8n'}
				<label class="block">
					<span class="text-sm font-medium text-gray-700 mb-1">n8n Webhook URL</span>
					<input type="url" bind:value={config.n8nWebhookUrl} class="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" placeholder="https://your-n8n.com/webhook/..." />
				</label>
			{:else}
				{#if llmKeysAvailable.length === 0}
					<p class="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">Add at least one LLM API key in <a href="/settings" class="underline font-medium">Settings</a> to use Direct LLM.</p>
				{:else}
					<div class="space-y-4">
						<label class="block">
							<span class="text-sm font-medium text-gray-700 mb-1">Primary LLM</span>
							<select bind:value={config.llmProvider} class="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm">
								<option value="">— Select —</option>
								{#each llmKeysAvailable as pid}
									<option value={pid}>{pid === 'openai' ? 'OpenAI' : pid === 'anthropic' ? 'Anthropic' : pid === 'google' ? 'Google (Gemini)' : pid}</option>
								{/each}
							</select>
						</label>
						{#if config.llmProvider}
							<label class="block">
								<span class="text-sm font-medium text-gray-700 mb-1">Primary model</span>
								<select bind:value={config.llmModel} class="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono">
									{#each getModels(config.llmProvider) as model}
										<option value={model}>{model}</option>
									{/each}
								</select>
							</label>
						{/if}
						<label class="block">
							<span class="text-sm font-medium text-gray-700 mb-1">Fallback LLM (optional)</span>
							<select bind:value={config.llmFallbackProvider} class="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm">
								<option value="">— None —</option>
								{#each llmKeysAvailable.filter((p) => p !== config.llmProvider) as pid}
									<option value={pid}>{pid === 'openai' ? 'OpenAI' : pid === 'anthropic' ? 'Anthropic' : pid === 'google' ? 'Google (Gemini)' : pid}</option>
								{/each}
							</select>
						</label>
						{#if config.llmFallbackProvider}
							<label class="block">
								<span class="text-sm font-medium text-gray-700 mb-1">Fallback model</span>
								<select bind:value={config.llmFallbackModel} class="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono">
									{#each getModels(config.llmFallbackProvider) as model}
										<option value={model}>{model}</option>
									{/each}
								</select>
							</label>
						{/if}
						<label class="block">
							<span class="text-sm font-medium text-gray-700 mb-1">Live agent timeout (minutes)</span>
							<p class="text-xs text-gray-500 mb-1">If a live agent hasn&apos;t replied in this many minutes, the AI takes over again and apologizes for the delay.</p>
							<input type="number" min="1" max="120" bind:value={config.agentTakeoverTimeoutMinutes} class="w-full max-w-[120px] px-3 py-2 border border-gray-300 rounded-lg text-sm" />
						</label>

						<div class="mt-6 pt-6 border-t border-gray-200">
							<h4 class="text-sm font-semibold text-gray-900 mb-1">Webhook triggers</h4>
							<p class="text-xs text-gray-500 mb-1">When the AI recognises the user&apos;s intent, it calls the matching webhook and uses the result in the reply (e.g. order status).</p>
							<p class="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5 mb-3"><strong>Quote:</strong> Quote generation is built-in—no webhook needed. When a visitor asks for a quote, the bot collects name, email and roof size (sqm) then generates the PDF automatically. Do not add a separate webhook trigger for quotes.</p>
							<div class="space-y-4">
								{#each (config.webhookTriggers ?? []) as trigger, i}
									<div class="border border-gray-200 rounded-lg p-4 bg-gray-50/50 space-y-3">
										<div class="flex items-center justify-between gap-2">
											<label class="block flex-1 min-w-0">
												<span class="text-xs font-medium text-gray-500">Name</span>
												<input type="text" bind:value={trigger.name} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-0.5" placeholder="e.g. Roof quote" />
											</label>
											<label class="block w-32 shrink-0">
												<span class="text-xs font-medium text-gray-500">ID (slug)</span>
												<input type="text" bind:value={trigger.id} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono mt-0.5" placeholder="roof_quote" />
											</label>
											<label class="flex items-center gap-2 pt-6">
												<input type="checkbox" bind:checked={trigger.enabled} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
												<span class="text-xs font-medium text-gray-600">Enabled</span>
											</label>
											<button type="button" class="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 shrink-0" title="Remove trigger" onclick={() => removeTrigger(i)}>🗑</button>
										</div>
										<label class="block">
											<span class="text-xs font-medium text-gray-500">Description (for AI to recognise intent)</span>
											<textarea bind:value={trigger.description} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-0.5 min-h-[60px]" placeholder="e.g. User asks for a roof sealing quote or cost by area in sqm" rows="2"></textarea>
										</label>
										<label class="block">
											<span class="text-xs font-medium text-gray-500">Webhook URL (N8N)</span>
											<input type="url" bind:value={trigger.webhookUrl} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono mt-0.5" placeholder="https://your-n8n.com/webhook/roof-quote" />
										</label>
									</div>
								{/each}
								<button type="button" onclick={addTrigger} class="text-sm text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1">
									+ Add trigger
								</button>
							</div>
						</div>
					</div>
				{/if}
			{/if}
		</div>
	{:else if mainTab === 'train'}
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h3 class="text-lg font-semibold text-gray-900 mb-1">Train Bot</h3>
			<p class="text-gray-500 text-sm mb-6">
				Define how the bot should act and add knowledge. These instructions are sent with every message to your n8n webhook so your AI Agent can use them.
			</p>

			<div class="border border-gray-200 rounded-lg p-4 mb-6 bg-gray-50/50">
				<h4 class="text-sm font-semibold text-gray-900 mb-3">Bot instructions (role, tone, rules)</h4>
				<p class="text-xs text-gray-500 mb-4">Sent to n8n as <code class="bg-gray-200 px-1 rounded">systemPrompt</code>, <code class="bg-gray-200 px-1 rounded">role</code>, <code class="bg-gray-200 px-1 rounded">tone</code>, and <code class="bg-gray-200 px-1 rounded">instructions</code>. In n8n, map these into your AI Agent node&apos;s system message.</p>
				<div class="space-y-4">
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Role</span>
						<input
							type="text"
							bind:value={config.bot.role}
							placeholder="e.g. You are a helpful sales assistant for NetZero Coating."
							class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
						/>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Tone</span>
						<input
							type="text"
							bind:value={config.bot.tone}
							placeholder="e.g. Professional and friendly, concise"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
						/>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Instructions / rules</span>
						<textarea
							bind:value={config.bot.instructions}
							placeholder="e.g. Answer only about our products. Keep replies under 3 sentences. Do not discuss competitors."
							class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-[80px]"
							rows="3"
						></textarea>
					</label>
				</div>
			</div>

			<h4 class="text-sm font-semibold text-gray-800 mb-2">Knowledge base (RAG)</h4>
			<p class="text-gray-500 text-sm mb-4">
				Add knowledge from PDFs or web pages. Content is chunked, embedded with OpenAI, and stored in Supabase. In n8n, connect the same Supabase project and use <strong>Supabase Vector Store</strong> → &quot;Retrieve documents for AI Agent as Tool&quot; so your bot can answer from this data.
			</p>
			{#if trainStatus && !trainStatus.configured}
				<p class="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm mb-6">
					Add <code class="bg-amber-100 px-1 rounded">OPENAI_API_KEY</code> to your <code class="bg-amber-100 px-1 rounded">.env</code> to enable Train Bot.
				</p>
			{/if}
			{#if trainStatus}
				<p class="text-sm text-gray-600 mb-6">Knowledge base: <strong>{trainStatus.documentCount}</strong> chunk(s) stored for this widget.</p>
			{/if}
			<div class="space-y-6">
				<div>
					<h4 class="text-sm font-medium text-gray-800 mb-2">Upload PDF</h4>
					<div class="flex flex-wrap items-end gap-3">
						<label class="flex-1 min-w-[200px]">
							<span class="sr-only">Choose PDF</span>
							<input
								type="file"
								accept="application/pdf"
								class="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-amber-50 file:text-amber-800 file:font-medium"
								onchange={(e) => (trainUploadFile = (e.currentTarget.files ?? [])[0] ?? null)}
							/>
						</label>
						<button
							type="button"
							disabled={!trainUploadFile || trainUploading || !trainStatus?.configured}
							onclick={trainUpload}
							class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:pointer-events-none text-white font-medium rounded-lg"
						>
							{trainUploading ? 'Uploading…' : 'Add to knowledge base'}
						</button>
					</div>
				</div>
				<div>
					<h4 class="text-sm font-medium text-gray-800 mb-2">Scrape a webpage</h4>
					<div class="flex flex-wrap gap-3">
						<input
							type="url"
							bind:value={trainScrapeUrl}
							placeholder="https://example.com/page"
							class="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm"
						/>
						<button
							type="button"
							disabled={!trainScrapeUrl.trim() || trainScraping || !trainStatus?.configured}
							onclick={trainScrape}
							class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:pointer-events-none text-white font-medium rounded-lg"
						>
							{trainScraping ? 'Scraping…' : 'Add to knowledge base'}
						</button>
					</div>
				</div>
			</div>
		</div>
	{:else if mainTab === 'embed'}
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h3 class="text-lg font-semibold text-gray-900 mb-1">Embed your widget</h3>
			<p class="text-gray-500 text-sm mb-6">Copy the code below and paste it before the closing &lt;/body&gt; tag on your website.</p>
			<pre class="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto font-mono">{getEmbedSnippet()}</pre>
			<button type="button" onclick={copyEmbedCode} class="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors">
				{embedCopied ? 'Copied!' : 'Copy code'}
			</button>
		</div>
	{/if}
</div>

<WidgetPreview config={config} widgetId={widgetId} />
