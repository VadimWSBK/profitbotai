<script lang="ts">
	import type { WidgetConfig } from '$lib/widget-config';

	let { config, onClose } = $props<{ config: WidgetConfig; onClose: () => void }>();

	type Message = { role: 'user' | 'bot'; content: string };

	let inputText = $state('');
	let messages = $state<Message[]>([]);
	let showStarterPrompts = $state(true);
	let loading = $state(false);
	let contentEl: HTMLDivElement;

	const win = $derived(config.window);
	const bubble = $derived(config.bubble);
	const botStyle = $derived(win.botMessageSettings);

	function addBotMessage(content: string) {
		messages = [...messages, { role: 'bot', content }];
		showStarterPrompts = false;
		requestAnimationFrame(() => scrollToBottom());
	}

	function scrollToBottom() {
		if (contentEl) contentEl.scrollTop = contentEl.scrollHeight;
	}

	async function sendMessage(text: string) {
		const trimmed = text.trim();
		if (!trimmed) return;
		messages = [...messages, { role: 'user', content: trimmed }];
		inputText = '';
		showStarterPrompts = false;
		requestAnimationFrame(() => scrollToBottom());

		loading = true;
		let botReply = config.window.customErrorMessage;
		if (config.n8nWebhookUrl) {
			try {
				const res = await fetch(config.n8nWebhookUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ message: trimmed, sessionId: 'preview' })
				});
				const data = await res.json().catch(() => ({}));
				botReply = data.output ?? data.message ?? data.reply ?? data.text ?? botReply;
				if (typeof botReply !== 'string') botReply = JSON.stringify(botReply);
			} catch {
				botReply = config.window.customErrorMessage;
			}
		} else {
			botReply = "Preview mode — add your n8n webhook URL in the Connect tab to get real responses.";
		}
		addBotMessage(botReply);
		loading = false;
	}

	function handleSubmit(e: Event) {
		e.preventDefault();
		sendMessage(inputText);
	}

	function handleStarterPrompt(prompt: string) {
		sendMessage(prompt);
	}

	const winRadius = $derived(win.borderRadiusStyle === 'rounded' ? '12px' : '0');
	const headerRadius = $derived(win.borderRadiusStyle === 'rounded' ? '12px 12px 0 0' : '0');
</script>

<div
	class="chat-window flex flex-col overflow-hidden shadow-2xl"
	style="
		width: {win.widthPx}px;
		height: {win.heightPx}px;
		background-color: {win.backgroundColor};
		border-radius: {winRadius};
		font-size: {win.fontSizePx}px;
	"
	role="dialog"
	aria-label="Chat"
>
	{#if win.showTitleSection}
		<header
			class="flex items-center gap-2 px-4 py-3 shrink-0"
			style="
				background-color: {win.headerBackgroundColor};
				color: {win.headerTextColor};
				border-radius: {headerRadius};
			"
		>
			{#if win.titleAvatarUrl}
				<img
					src={win.titleAvatarUrl}
					alt=""
					class="w-8 h-8 rounded-full object-contain bg-white/20"
				/>
			{:else}
				<div class="w-8 h-8 rounded-full flex items-center justify-center bg-white/20">
					<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>
				</div>
			{/if}
			<span class="flex-1 font-semibold text-sm truncate">{win.title}</span>
			<button type="button" class="p-1.5 rounded hover:opacity-80 transition-opacity" style="color: {win.headerIconColor};" onclick={() => { messages = []; showStarterPrompts = true; }} title="Refresh">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
			</button>
			<button type="button" class="p-1.5 rounded hover:opacity-80 transition-opacity" style="color: {win.headerIconColor};" onclick={onClose} title="Close">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
			</button>
		</header>
	{/if}

	<div
		bind:this={contentEl}
		class="flex-1 overflow-y-auto p-4 flex flex-col gap-3 {win.showScrollbar ? '' : 'scrollbar-hide'}"
		role="log"
		aria-live="polite"
	>
		{#if messages.length === 0}
			<!-- Welcome message -->
			<div class="flex gap-2 items-start">
				{#if botStyle.showAvatar && botStyle.avatarUrl}
					<img src={botStyle.avatarUrl} alt="Bot" class="w-10 h-10 rounded-full object-contain shrink-0" style="border-radius: {win.avatarBorderRadius}px;" />
				{:else if botStyle.showAvatar}
					<div class="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center shrink-0" style="width: {win.avatarSize}px; height: {win.avatarSize}px; border-radius: {win.avatarBorderRadius}px;">
						<svg class="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1v1h-3v2h4v2h-6v-4H9v-1a5 5 0 01-5-5H4V4.73C3.4 4.39 3 3.74 3 3a2 2 0 012-2h7z"/></svg>
					</div>
				{/if}
				<div
					class="px-3 py-2 max-w-[85%] rounded-lg"
					style="
						background-color: {botStyle.backgroundColor};
						color: {botStyle.textColor};
						border-radius: {win.messageBorderRadius}px;
					"
				>
					{win.welcomeMessage}
				</div>
			</div>
			{#if win.starterPrompts.filter((p: string) => p.trim()).length > 0}
				<div class="flex flex-wrap gap-2">
					{#each win.starterPrompts.filter((p: string) => p.trim()) as prompt}
						<button
							type="button"
							class="px-3 py-2 rounded-lg border text-left transition-colors hover:opacity-90"
							style="
								font-size: {win.starterPromptFontSizePx}px;
								background-color: {win.starterPromptBackgroundColor};
								color: {win.starterPromptTextColor};
								border-color: {win.starterPromptBorderColor};
							"
							onclick={() => handleStarterPrompt(prompt)}
						>
							{prompt}
						</button>
					{/each}
				</div>
			{/if}
		{:else}
			{#each messages as msg}
				{#if msg.role === 'bot'}
					<div class="flex gap-2 items-start">
						{#if botStyle.showAvatar && botStyle.avatarUrl}
							<img src={botStyle.avatarUrl} alt="Bot" class="shrink-0 object-contain" style="width: {win.avatarSize}px; height: {win.avatarSize}px; border-radius: {win.avatarBorderRadius}px;" />
						{:else if botStyle.showAvatar}
							<div class="shrink-0 rounded-full bg-gray-300 flex items-center justify-center" style="width: {win.avatarSize}px; height: {win.avatarSize}px; border-radius: {win.avatarBorderRadius}px;">
								<svg class="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1v1h-3v2h4v2h-6v-4H9v-1a5 5 0 01-5-5H4V4.73C3.4 4.39 3 3.74 3 3a2 2 0 012-2h7z"/></svg>
							</div>
						{/if}
						<div
							class="px-3 py-2 max-w-[85%] rounded-lg flex items-start gap-2"
							style="
								background-color: {botStyle.backgroundColor};
								color: {botStyle.textColor};
								border-radius: {win.messageBorderRadius}px;
							"
						>
							<span class="flex-1">{msg.content}</span>
							{#if botStyle.showCopyToClipboardIcon}
								<button type="button" class="shrink-0 opacity-70 hover:opacity-100" onclick={() => navigator.clipboard.writeText(msg.content)} title="Copy">
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
								</button>
							{/if}
						</div>
					</div>
				{:else}
					<div class="flex justify-end">
				<div
					class="px-3 py-2 max-w-[85%] rounded-lg"
					style="
						background-color: {bubble.backgroundColor};
						color: {bubble.colorOfInternalIcons};
						border-radius: {win.messageBorderRadius}px;
					"
				>
					{msg.content}
				</div>
					</div>
				{/if}
			{/each}
			{#if loading}
				<div class="flex gap-2 items-start">
					{#if botStyle.showAvatar}
						<div class="w-10 h-10 rounded-full bg-gray-200 shrink-0 animate-pulse" style="border-radius: {win.avatarBorderRadius}px;"></div>
					{/if}
					<div class="px-3 py-2 rounded-lg bg-gray-200 text-gray-500 animate-pulse" style="border-radius: {win.messageBorderRadius}px;">...</div>
				</div>
			{/if}
		{/if}
	</div>

	<form
		class="shrink-0 p-3 border-t flex gap-2"
		style="background-color: {win.backgroundColor}; border-color: {win.sectionBorderColor};"
		onsubmit={handleSubmit}
	>
		<input
			type="text"
			class="chat-window-input flex-1 px-3 py-2 border rounded-lg outline-none focus:ring-2"
			style="
				background-color: {win.inputBackgroundColor};
				border-color: {win.inputBorderColor};
				color: {win.inputTextColor};
				--ph: {win.inputPlaceholderColor};
			"
			placeholder={win.inputPlaceholder}
			bind:value={inputText}
			disabled={loading}
		/>
		<button
			type="submit"
			class="shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-opacity disabled:opacity-50"
			style="background-color: {win.sendButtonBackgroundColor}; color: {win.sendButtonIconColor};"
			disabled={loading}
			title="Send"
		>
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0V11"/></svg>
		</button>
	</form>

	{#if win.footerText}
		<footer
			class="shrink-0 px-3 py-2 text-center text-xs border-t"
			style="background-color: {win.footerBackgroundColor}; color: {win.footerTextColor}; border-color: {win.sectionBorderColor};"
		>
			{win.footerText}
		</footer>
	{/if}
</div>

<style>
	.chat-window .overflow-y-auto::-webkit-scrollbar {
		width: 6px;
	}
	.chat-window .overflow-y-auto::-webkit-scrollbar-thumb {
		background: #d1d5db;
		border-radius: 3px;
	}
	.chat-window .scrollbar-hide {
		scrollbar-width: none;
		-ms-overflow-style: none;
	}
	.chat-window .scrollbar-hide::-webkit-scrollbar {
		display: none;
	}
	.chat-window-input::placeholder {
		color: var(--ph, #9ca3af);
	}
</style>
