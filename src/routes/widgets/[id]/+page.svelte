<script lang="ts">
	import WidgetPreview from '$lib/components/WidgetPreview.svelte';
	import IconUrlField from '$lib/components/IconUrlField.svelte';
	import { defaultWidgetConfig, type WidgetConfig, type WebhookTrigger } from '$lib/widget-config';

	type MainTab = 'customize' | 'agent' | 'embed';
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
						webhookTriggers: config.webhookTriggers ?? [],
						agentId: config.agentId ?? '',
						agentAutonomy: Boolean(config.agentAutonomy)
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

	function getEmbedSnippet(): string {
		const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com';
		return `<script src="${origin}/embed/chat-widget.js" data-widget-id="${widgetId}"><\/script>`;
	}

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
			class="pb-3 text-sm font-medium border-b-2 transition-colors {mainTab === 'agent' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
			onclick={() => (mainTab = 'agent')}
		>
			Agent
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
						<input type="text" bind:value={config.tooltip.message} class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Hi {first_name} 👋 Let's Chat." />
						<p class="mt-1 text-xs text-gray-500">Use <code class="px-1 py-0.5 bg-gray-100 rounded">{first_name}</code> or <code class="px-1 py-0.5 bg-gray-100 rounded">{name}</code> to show the visitor's name when known.</p>
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
	{:else if mainTab === 'agent'}
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h3 class="text-lg font-semibold text-gray-900 mb-1">Agent</h3>
			<p class="text-gray-500 text-sm mb-6">
				Choose which agent powers this widget. All training (Connect and Train Bot) is configured in <a href="/agents" class="text-amber-600 hover:underline">Agents</a>.
			</p>
			<label class="block mb-4">
				<span class="text-sm font-medium text-gray-700 mb-1">Agent</span>
				<select bind:value={config.agentId} class="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm">
					<option value="">— None —</option>
					{#each (data?.agents ?? []) as agent}
						<option value={agent.id}>{agent.name}</option>
					{/each}
				</select>
			</label>
			<label class="flex items-start gap-2">
				<input type="checkbox" bind:checked={config.agentAutonomy} class="mt-1 rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
				<div>
					<span class="text-sm font-medium text-gray-700">Enable agent autonomy</span>
					<p class="text-xs text-gray-500 mt-0.5">Let the agent use tools: search contacts, generate quote, send email—without creating workflows.</p>
				</div>
			</label>
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
