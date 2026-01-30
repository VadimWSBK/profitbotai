<script lang="ts">
	import WidgetPreview from '$lib/components/WidgetPreview.svelte';
	import IconUrlField from '$lib/components/IconUrlField.svelte';
	import { defaultWidgetConfig, type WidgetConfig } from '$lib/widget-config';

	type MainTab = 'customize' | 'connect' | 'embed';
	type CustomizeTab = 'bubble' | 'tooltip' | 'window' | 'footer' | 'advanced';

	let config = $state<WidgetConfig>(JSON.parse(JSON.stringify(defaultWidgetConfig)));
	let mainTab = $state<MainTab>('customize');
	let customizeTab = $state<CustomizeTab>('bubble');
	let saving = $state(false);
	let embedCopied = $state(false);
	let botMessageSettingsOpen = $state(true);

	async function save() {
		saving = true;
		try {
			const res = await fetch('/api/widgets', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: config.name,
					display_mode: config.displayMode,
					config: {
						bubble: config.bubble,
						tooltip: config.tooltip,
						window: config.window
					},
					n8n_webhook_url: config.n8nWebhookUrl
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Failed to save');
			if (data.widget?.id) {
				window.location.href = `/widgets/${data.widget.id}`;
				return;
			}
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
		return `<script src="${origin}/embed/chat-widget.js" data-widget-id="YOUR_WIDGET_ID"><\/script>`;
	}
</script>

<div class="max-w-3xl">
	<!-- Header: name, tag, display mode, Save -->
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

	<!-- Main tabs: Customize | Connect | Embed -->
	<nav class="flex gap-6 border-b border-gray-200 mb-6">
		<button
			type="button"
			class="pb-3 text-sm font-medium border-b-2 transition-colors {mainTab === 'customize'
				? 'border-amber-600 text-amber-600'
				: 'border-transparent text-gray-500 hover:text-gray-700'}"
			onclick={() => (mainTab = 'customize')}
		>
			Customize
		</button>
		<button
			type="button"
			class="pb-3 text-sm font-medium border-b-2 transition-colors {mainTab === 'connect'
				? 'border-amber-600 text-amber-600'
				: 'border-transparent text-gray-500 hover:text-gray-700'}"
			onclick={() => (mainTab = 'connect')}
		>
			Connect
		</button>
		<button
			type="button"
			class="pb-3 text-sm font-medium border-b-2 transition-colors {mainTab === 'embed'
				? 'border-amber-600 text-amber-600'
				: 'border-transparent text-gray-500 hover:text-gray-700'}"
			onclick={() => (mainTab = 'embed')}
		>
			Embed
		</button>
	</nav>

	{#if mainTab === 'customize'}
		<!-- Sub-tabs: Bubble | Tooltip | Window | Footer | Advanced -->
		<nav class="flex flex-wrap gap-2 mb-6">
			{#each (['bubble', 'tooltip', 'window', 'footer', 'advanced'] as const) as tab}
				<button
					type="button"
					class="px-3 py-2 text-sm font-medium rounded-lg transition-colors {customizeTab === tab
						? 'bg-amber-100 text-amber-800'
						: tab === 'footer'
							? 'text-gray-400 cursor-not-allowed'
							: 'text-gray-600 hover:bg-gray-100'}"
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
				<p class="text-gray-500 text-sm mb-6">Modify the appearance of your chat bubble including its size, position, colors, and custom icon. This is the floating button users click to open the chat.</p>

				<div class="space-y-4">
					<label class="block">
						<span class="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">
							Border Radius Style
							<span class="text-gray-400 cursor-help" title="Shape of the bubble">ⓘ</span>
						</span>
						<div class="flex gap-4">
							{#each ['circle', 'rounded', 'none'] as style}
								<label class="flex items-center gap-2 cursor-pointer">
									<input type="radio" name="bubble-radius" value={style} bind:group={config.bubble.borderRadiusStyle} />
									<span class="text-sm capitalize">{style}</span>
								</label>
							{/each}
						</div>
					</label>
					<label class="block">
						<span class="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">Background Color ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.bubble.backgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="text" bind:value={config.bubble.backgroundColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
						</div>
					</label>
					<IconUrlField bind:value={config.bubble.customIconUrl} uploadUrl="/api/widgets/upload" label="Chat bubble icon (URL or upload)" />
					<label class="block">
						<span class="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">Custom Icon Size (%) ⓘ</span>
						<input type="range" min="20" max="100" bind:value={config.bubble.customIconSize} class="w-full accent-amber-600" />
						<span class="text-sm text-gray-500">{config.bubble.customIconSize}%</span>
					</label>
					<label class="block">
						<span class="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">Custom Icon Border Radius ⓘ</span>
						<input type="range" min="0" max="50" bind:value={config.bubble.customIconBorderRadius} class="w-full accent-amber-600" />
						<span class="text-sm text-gray-500">{config.bubble.customIconBorderRadius}</span>
					</label>
					<label class="block">
						<span class="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">Color of Internal Icons ⓘ</span>
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
				<p class="text-gray-500 text-sm mb-6">Configure the tooltip that appears when users hover over the chat button. Set custom messages and styling to enhance user engagement.</p>

				<div class="space-y-4">
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={config.tooltip.displayTooltip} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
						<span class="text-sm font-medium text-gray-700">Display Tooltip ⓘ</span>
					</label>
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={config.tooltip.hideTooltipOnMobile} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
						<span class="text-sm font-medium text-gray-700">Hide Tooltip on Mobile Devices ⓘ</span>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Message ⓘ</span>
						<input type="text" bind:value={config.tooltip.message} class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Hello 👋 ..." />
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
				<p class="text-gray-500 text-sm mb-6">Design your chat interface by customizing the chat window's appearance, messages, avatars, and input field. These settings affect the main chat experience.</p>

				<div class="space-y-4">
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Border Radius Style ⓘ</span>
						<div class="flex gap-4">
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="radio" name="window-radius" value="rounded" bind:group={config.window.borderRadiusStyle} />
								<span class="text-sm">Rounded</span>
							</label>
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="radio" name="window-radius" value="none" bind:group={config.window.borderRadiusStyle} />
								<span class="text-sm">None</span>
							</label>
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Avatar Size ⓘ</span>
						<input type="range" min="24" max="80" bind:value={config.window.avatarSize} class="w-full accent-amber-600" />
						<span class="text-sm text-gray-500">{config.window.avatarSize}</span>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Avatar Border Radius ⓘ</span>
						<input type="range" min="0" max="50" bind:value={config.window.avatarBorderRadius} class="w-full accent-amber-600" />
						<span class="text-sm text-gray-500">{config.window.avatarBorderRadius}</span>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Message Border Radius ⓘ</span>
						<input type="range" min="0" max="24" bind:value={config.window.messageBorderRadius} class="w-full accent-amber-600" />
						<span class="text-sm text-gray-500">{config.window.messageBorderRadius}</span>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Background Color ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.window.backgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="text" bind:value={config.window.backgroundColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
						</div>
					</label>
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={config.window.showTitleSection} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
						<span class="text-sm font-medium text-gray-700">Show Title Section ⓘ</span>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Title ⓘ</span>
						<input type="text" bind:value={config.window.title} class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="N8N Chat UI Bot" />
					</label>
					<IconUrlField bind:value={config.window.titleAvatarUrl} uploadUrl="/api/widgets/upload" label="Header logo (URL or upload)" />
					<label class="block">
						<span class="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">Header Background Color ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.window.headerBackgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="text" bind:value={config.window.headerBackgroundColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Header Text Color ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.window.headerTextColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="text" bind:value={config.window.headerTextColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Welcome Message ⓘ</span>
						<textarea bind:value={config.window.welcomeMessage} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-[80px]" placeholder="Hello! This is the default welcome message."></textarea>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Custom Error Message ⓘ</span>
						<input type="text" bind:value={config.window.customErrorMessage} class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Please connect me to n8n first" />
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Starter Prompts ⓘ</span>
						<div class="space-y-2">
							{#each config.window.starterPrompts as _, i}
								<div class="flex gap-2">
									<input type="text" bind:value={config.window.starterPrompts[i]} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Who are you?" />
									<button type="button" class="p-2 text-gray-500 hover:text-red-600 rounded-lg hover:bg-red-50" onclick={() => config.window.starterPrompts = config.window.starterPrompts.filter((__, j) => j !== i)} title="Remove">🗑</button>
								</div>
							{/each}
							<button type="button" class="text-sm text-amber-600 hover:text-amber-700 font-medium" onclick={addStarterPrompt}>+ Add Prompt</button>
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Starter Prompt Font Size (px) ⓘ</span>
						<input type="number" min="10" max="24" bind:value={config.window.starterPromptFontSizePx} class="w-full max-w-[120px] px-3 py-2 border border-gray-300 rounded-lg" />
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Starter prompt button background ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.window.starterPromptBackgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="text" bind:value={config.window.starterPromptBackgroundColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Starter prompt text color ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.window.starterPromptTextColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="text" bind:value={config.window.starterPromptTextColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Starter prompt border color ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.window.starterPromptBorderColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="text" bind:value={config.window.starterPromptBorderColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
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
						<span class="text-sm font-medium text-gray-700 mb-1">Input background ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.window.inputBackgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="text" bind:value={config.window.inputBackgroundColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Input border & placeholder color ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.window.inputBorderColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" title="Border" />
							<input type="color" bind:value={config.window.inputPlaceholderColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" title="Placeholder" />
							<input type="text" bind:value={config.window.inputTextColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" placeholder="Text color" />
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Send button ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.window.sendButtonBackgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" title="Background" />
							<input type="color" bind:value={config.window.sendButtonIconColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" title="Icon" />
							<input type="text" bind:value={config.window.sendButtonBackgroundColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
						</div>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Footer & borders ⓘ</span>
						<div class="flex gap-2 items-center">
							<input type="color" bind:value={config.window.footerBackgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="color" bind:value={config.window.footerTextColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
							<input type="color" bind:value={config.window.sectionBorderColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
						</div>
					</label>
					<!-- Bot Message Settings (collapsible) -->
					<div class="border border-gray-200 rounded-lg overflow-hidden">
						<button type="button" class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left font-medium text-gray-800" onclick={() => (botMessageSettingsOpen = !botMessageSettingsOpen)}>
							Bot Message Settings
							<svg class="w-5 h-5 transition-transform {botMessageSettingsOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
						</button>
						{#if botMessageSettingsOpen}
							<div class="p-4 space-y-4 border-t border-gray-200">
								<label class="block">
									<span class="text-sm font-medium text-gray-700 mb-1">Background Color ⓘ</span>
									<div class="flex gap-2 items-center">
										<input type="color" bind:value={config.window.botMessageSettings.backgroundColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
										<input type="text" bind:value={config.window.botMessageSettings.backgroundColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
									</div>
								</label>
								<label class="block">
									<span class="text-sm font-medium text-gray-700 mb-1">Text Color ⓘ</span>
									<div class="flex gap-2 items-center">
										<input type="color" bind:value={config.window.botMessageSettings.textColor} class="w-10 h-10 rounded border border-gray-300 cursor-pointer" />
										<input type="text" bind:value={config.window.botMessageSettings.textColor} class="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
									</div>
								</label>
								<label class="flex items-center gap-2">
									<input type="checkbox" bind:checked={config.window.botMessageSettings.showAvatar} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
									<span class="text-sm font-medium text-gray-700">Show Avatar ⓘ</span>
								</label>
								<IconUrlField bind:value={config.window.botMessageSettings.avatarUrl} uploadUrl="/api/widgets/upload" label="Bot avatar (URL or upload)" />
								<label class="flex items-center gap-2">
									<input type="checkbox" bind:checked={config.window.botMessageSettings.showCopyToClipboardIcon} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
									<span class="text-sm font-medium text-gray-700">Show Copy to Clipboard Icon ⓘ</span>
								</label>
							</div>
						{/if}
					</div>
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={config.window.renderHtmlInBotResponses} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
						<span class="text-sm font-medium text-gray-700">Render HTML in Bot Responses ⓘ</span>
					</label>
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={config.window.clearChatOnReload} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
						<span class="text-sm font-medium text-gray-700">Clear Chat on Reload ⓘ</span>
					</label>
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={config.window.showScrollbar} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
						<span class="text-sm font-medium text-gray-700">Show Scrollbar ⓘ</span>
					</label>
					<div class="grid grid-cols-2 gap-4">
						<label class="block">
							<span class="text-sm font-medium text-gray-700 mb-1">Height (px) ⓘ</span>
							<input type="number" min="300" max="900" bind:value={config.window.heightPx} class="w-full px-3 py-2 border border-gray-300 rounded-lg" />
						</label>
						<label class="block">
							<span class="text-sm font-medium text-gray-700 mb-1">Width (px) ⓘ</span>
							<input type="number" min="320" max="500" bind:value={config.window.widthPx} class="w-full px-3 py-2 border border-gray-300 rounded-lg" />
						</label>
					</div>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Font Size (px) ⓘ</span>
						<input type="number" min="12" max="24" bind:value={config.window.fontSizePx} class="w-full max-w-[120px] px-3 py-2 border border-gray-300 rounded-lg" />
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Input Placeholder ⓘ</span>
						<input type="text" bind:value={config.window.inputPlaceholder} class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Type your query" />
					</label>
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">Footer Text ⓘ</span>
						<input type="text" bind:value={config.window.footerText} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Free customizable chat widget for n8n" />
					</label>
				</div>
			{:else if customizeTab === 'advanced'}
				<h3 class="text-lg font-semibold text-gray-900 mb-1">Advanced</h3>
				<p class="text-gray-500 text-sm mb-6">Extra options for power users (e.g. custom CSS, z-index, animation).</p>
				<p class="text-sm text-gray-500">More options coming soon.</p>
			{/if}
		</div>
	{:else if mainTab === 'connect'}
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h3 class="text-lg font-semibold text-gray-900 mb-1">Connect to n8n</h3>
			<p class="text-gray-500 text-sm mb-6">Point your widget to an n8n webhook or chat workflow so messages are sent to your automation.</p>
			<label class="block">
				<span class="text-sm font-medium text-gray-700 mb-1">n8n Webhook URL</span>
				<input
					type="url"
					bind:value={config.n8nWebhookUrl}
					class="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
					placeholder="https://your-n8n.com/webhook/..."
				/>
			</label>
			<p class="text-xs text-gray-500 mt-2">Create a Webhook node in n8n and paste the production URL here. The widget will POST chat messages to this URL.</p>
		</div>
	{:else if mainTab === 'embed'}
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<h3 class="text-lg font-semibold text-gray-900 mb-1">Embed your widget</h3>
			<p class="text-gray-500 text-sm mb-6">Copy the code below and paste it before the closing &lt;/body&gt; tag on your website.</p>
			<pre class="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto font-mono">{getEmbedSnippet()}</pre>
			<button
				type="button"
				onclick={copyEmbedCode}
				class="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors"
			>
				{embedCopied ? 'Copied!' : 'Copy code'}
			</button>
		</div>
	{/if}
</div>

<!-- Live preview (fixed bottom-right) -->
<WidgetPreview config={config} />
