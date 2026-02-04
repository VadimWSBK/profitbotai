<script lang="ts">
	import type { WidgetConfig } from '$lib/widget-config';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import { getSessionId } from '$lib/widget-session';
	import ChatWindow from './ChatWindow.svelte';

	let { config, widgetId } = $props<{ config: WidgetConfig; widgetId?: string }>();
	let iconError = $state(false);
	let open = $state(false);
	let visitorName = $state<string | null>(null);

	const bubble = $derived(config.bubble);
	const tooltip = $derived(config.tooltip);
	const showCustomIcon = $derived(bubble.customIconUrl && !iconError);
	const visitorFirstName = $derived(
		visitorName?.trim() ? visitorName.trim().split(/\s+/)[0] ?? '' : ''
	);
	const tooltipMessage = $derived(
		(tooltip.message ?? '')
			.replace(/\{first_name\}/gi, visitorFirstName || 'there')
			.replace(/\{name\}/gi, visitorName?.trim() || 'there')
	);

	// Fetch visitor name when embedded so tooltip can show "Hi {first_name}"
	$effect(() => {
		if (!widgetId || widgetId === 'preview' || !browser) return;
		const sessionId = getSessionId(widgetId, browser);
		if (sessionId === 'preview') return;
		fetch(`/api/widgets/${widgetId}/visitor?session_id=${encodeURIComponent(sessionId)}`)
			.then((r) => r.json())
			.then((data: { name?: string | null }) => {
				const n = data?.name;
				visitorName = typeof n === 'string' && n.trim() ? n.trim() : null;
			})
			.catch(() => {});
	});

	// Auto-open if configured
	$effect(() => {
		if (config.bubble.autoOpenBotWindow) open = true;
	});

	$effect(() => {
		void config.bubble.customIconUrl;
		iconError = false;
	});

	const bubbleRadius = $derived(
		bubble.borderRadiusStyle === 'circle'
			? '50%'
			: bubble.borderRadiusStyle === 'rounded'
				? '16px'
				: '0'
	);

</script>

<div
	class="widget-preview-wrapper fixed z-[9999] flex flex-col items-end"
	style="right: {bubble.rightPositionPx}px; bottom: {bubble.bottomPositionPx}px;"
>
	{#if open}
		<div
			class="chat-window-container absolute flex flex-col items-end gap-2"
			class:is-open={open}
			style="right: 0; bottom: {bubble.bubbleSizePx + 12}px;"
			in:fly={{ y: 12, duration: 200, easing: cubicOut }}
			out:fly={{ y: 8, duration: 150, easing: cubicOut }}
		>
			<ChatWindow config={config} widgetId={widgetId} onClose={() => (open = false)} />
		</div>
	{/if}

	<!-- Tooltip left, bubble right -->
	<div class="flex flex-row items-end gap-2">
		{#if tooltip.displayTooltip && !open}
			<div
				class="tooltip-preview px-3 py-2 shadow-lg max-w-[220px] whitespace-normal cursor-pointer order-first"
				style="
					background-color: {tooltip.backgroundColor};
					color: {tooltip.textColor};
					font-size: {tooltip.fontSizePx}px;
					border-radius: 10px;
				"
				role="button"
				tabindex="0"
				onclick={() => (open = true)}
				onkeydown={(e) => e.key === 'Enter' && (open = true)}
			>
				{tooltipMessage}
			</div>
		{/if}
		<button
		type="button"
		class="bubble-preview flex items-center justify-center flex-shrink-0 cursor-pointer hover:opacity-90 transition-opacity border-0 rounded-none"
		style="
			width: {bubble.bubbleSizePx}px;
			height: {bubble.bubbleSizePx}px;
			background-color: {bubble.backgroundColor};
			border-radius: {bubbleRadius};
		"
		onclick={() => (open = !open)}
		aria-label={open ? 'Close chat' : 'Open chat'}
		aria-expanded={open}
	>
		{#if showCustomIcon}
			<img
				src={bubble.customIconUrl}
				alt="Chat"
				class="object-contain pointer-events-none"
				style="
					width: {bubble.customIconSize}%;
					height: {bubble.customIconSize}%;
					border-radius: {bubble.customIconBorderRadius}px;
				"
				onerror={() => (iconError = true)}
			/>
		{:else}
			<svg
				class="w-1/2 h-1/2 pointer-events-none"
				style="color: {bubble.colorOfInternalIcons}"
				fill="currentColor"
				viewBox="0 0 24 24"
			>
				<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
			</svg>
		{/if}
	</button>
	</div>
</div>

<style>
	/* Mobile: full-screen chat (industry standard for chat widgets) */
	@media (max-width: 768px) {
		.chat-window-container.is-open {
			position: fixed;
			inset: 0;
			right: 0;
			bottom: 0;
			left: 0;
			top: 0;
			width: 100%;
			height: 100%;
			max-height: 100dvh;
			align-items: stretch;
			justify-content: stretch;
		}
		.chat-window-container.is-open :global(.chat-window) {
			flex: 1;
			min-width: 0;
			min-height: 0;
		}
	}
</style>
