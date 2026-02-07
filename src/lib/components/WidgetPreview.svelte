<script lang="ts">
	import type { WidgetConfig } from '$lib/widget-config';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import { onMount, onDestroy } from 'svelte';
	import { getSessionId } from '$lib/widget-session';
	import ChatWindow from './ChatWindow.svelte';
	import { listenToParent, sendToParent, requestContext, type ShopifyContext } from '$lib/widget-postmessage';

	let { config, widgetId } = $props<{ config: WidgetConfig; widgetId?: string }>();
	let iconError = $state(false);
	let open = $state(false);
	let visitorName = $state<string | null>(null);
	let prefersReducedMotion = $state(false);
	let showTooltip = $state(true);
	let tooltipTimeout: ReturnType<typeof setTimeout> | null = null;
	let shopifyContext = $state<ShopifyContext | null>(null);
	let cleanupPostMessage: (() => void) | null = null;
	let isEmbedded = $state(false);

	function dur(ms: number) { return prefersReducedMotion ? 0 : ms; }

	/** Notify the parent page (Shopify etc.) about chat open/close so it can resize the iframe */
	function notifyParent(type: 'chat-opened' | 'chat-closed') {
		try {
			if (window.parent && window.parent !== window) {
				window.parent.postMessage({ source: 'profitbot-widget', type }, '*');
			}
		} catch { /* cross-origin — safe to ignore */ }
	}

	onMount(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		prefersReducedMotion = mq.matches;
		mq.addEventListener('change', (e) => { prefersReducedMotion = e.matches; });
		// Detect if we're inside an iframe (embedded on external site)
		try { isEmbedded = window.self !== window.top; } catch { isEmbedded = true; }

		// Set up postMessage communication with parent page
		if (browser && widgetId && widgetId !== 'preview') {
			const sessionId = getSessionId(widgetId, browser);

			// Notify parent that widget is ready
			sendToParent({
				type: 'profitbot-ready',
				widgetId,
				sessionId
			});

			// Request context from parent (Shopify)
			requestContext(widgetId, sessionId);

			// Listen for messages from parent
			cleanupPostMessage = listenToParent((message) => {
				if (message.type === 'shopify-context' || message.type === 'shopify-cart-update' || message.type === 'shopify-page-view' || message.type === 'shopify-product-view') {
					shopifyContext = (message.data as ShopifyContext) || null;
				}
			});
		}
	});

	onDestroy(() => {
		if (cleanupPostMessage) {
			cleanupPostMessage();
			cleanupPostMessage = null;
		}
	});

	// Custom open transition: scale + translate + opacity
	function chatWindowIn(node: Element) {
		const d = dur(250);
		return {
			duration: d,
			easing: cubicOut,
			css: (t: number) => `
				opacity: ${t};
				transform: translateY(${(1 - t) * 12}px) scale(${0.95 + t * 0.05});
				transform-origin: bottom right;
			`
		};
	}
	function chatWindowOut(node: Element) {
		const d = dur(180);
		return {
			duration: d,
			easing: cubicOut,
			css: (t: number) => `
				opacity: ${t};
				transform: translateY(${(1 - t) * 8}px) scale(${0.96 + t * 0.04});
				transform-origin: bottom right;
			`
		};
	}

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

	// Notify parent when chat opens/closes (Shopify context events)
	$effect(() => {
		if (!browser || !widgetId || widgetId === 'preview') return;

		const sessionId = getSessionId(widgetId, browser);

		if (open) {
			sendToParent({
				type: 'profitbot-chat-opened',
				widgetId,
				sessionId,
				data: shopifyContext ? { context: shopifyContext } : undefined
			});
		} else {
			sendToParent({
				type: 'profitbot-chat-closed',
				widgetId,
				sessionId
			});
		}
	});

	// Notify parent iframe when chat opens/closes (for mobile resize)
	$effect(() => {
		if (!isEmbedded) return;
		notifyParent(open ? 'chat-opened' : 'chat-closed');
	});

	$effect(() => {
		void config.bubble.customIconUrl;
		iconError = false;
	});

	// Auto-hide tooltip logic
	$effect(() => {
		if (open) {
			showTooltip = false;
			if (tooltipTimeout) {
				clearTimeout(tooltipTimeout);
				tooltipTimeout = null;
			}
			return;
		}

		if (!tooltip.displayTooltip) {
			showTooltip = false;
			if (tooltipTimeout) {
				clearTimeout(tooltipTimeout);
				tooltipTimeout = null;
			}
			return;
		}

		showTooltip = true;

		if (tooltip.autoHideTooltip && tooltip.autoHideDelaySeconds > 0) {
			if (tooltipTimeout) {
				clearTimeout(tooltipTimeout);
			}
			tooltipTimeout = setTimeout(() => {
				showTooltip = false;
				tooltipTimeout = null;
			}, tooltip.autoHideDelaySeconds * 1000);
		}

		return () => {
			if (tooltipTimeout) {
				clearTimeout(tooltipTimeout);
				tooltipTimeout = null;
			}
		};
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
	style="right: {bubble.rightPositionPx}px; bottom: {bubble.bottomPositionPx}px; position: fixed;"
>
	{#if open}
		<!-- Mobile backdrop overlay -->
		<div
			class="chat-backdrop"
			onclick={() => (open = false)}
			in:fade={{ duration: dur(200) }}
			out:fade={{ duration: dur(150) }}
			role="presentation"
		></div>
		<div
			class="chat-window-container absolute flex flex-col items-end gap-2 chat-window-container--desktop"
			class:is-open={open}
			style="right: 0; bottom: {bubble.bubbleSizePx + 12}px; z-index: 1;"
			in:chatWindowIn
			out:chatWindowOut
		>
			<ChatWindow config={config} widgetId={widgetId} shopifyContext={shopifyContext} onClose={() => (open = false)} />
		</div>
	{/if}

	<!-- Tooltip left, bubble right -->
	<div class="flex flex-row items-end gap-2 relative z-10">
		{#if tooltip.displayTooltip && !open && showTooltip}
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
				in:fly={{ y: 4, duration: dur(200), easing: cubicOut }}
				out:fade={{ duration: dur(300), easing: cubicOut }}
			>
				{tooltipMessage}
			</div>
		{/if}
		<button
		type="button"
		class="bubble-preview bubble-attention flex items-center justify-center flex-shrink-0 cursor-pointer hover:opacity-90 transition-all border-0 rounded-none relative z-20"
		class:bubble-open={open}
		style="
			width: {bubble.bubbleSizePx}px;
			height: {bubble.bubbleSizePx}px;
			background-color: {bubble.backgroundColor};
			border-radius: {bubbleRadius};
		"
		onclick={(e) => {
			e.stopPropagation();
			open = !open;
		}}
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
	/* Wrapper: fixed to bottom-right, pointer-events pass through to host page */
	.widget-preview-wrapper {
		position: fixed !important;
		pointer-events: none;
		background: transparent !important;
		background-color: transparent !important;
	}
	/* Only restore pointer-events on interactive elements (button, tooltip, chat window) */
	.widget-preview-wrapper > div {
		pointer-events: auto;
	}
	.bubble-preview,
	.tooltip-preview,
	.chat-backdrop,
	.chat-window-container,
	.chat-window-container * {
		pointer-events: auto !important;
	}

	/* Desktop: chat window positioned above the bubble icon */
	.chat-window-container--desktop {
		position: absolute !important;
		max-height: calc(100vh - 120px);
		overflow: visible;
		background: transparent !important;
		background-color: transparent !important;
		/* Add padding to make shadow visible on all sides */
		padding: 20px;
		margin-left: 20px;
	}

	.chat-window-container--desktop :global(.chat-window) {
		max-height: 600px;
		overflow: hidden;
	}

	/* Mobile backdrop (hidden on desktop) */
	.chat-backdrop {
		display: none;
		pointer-events: auto;
	}

	/* Bubble button with prominent dropshadow */
	.bubble-preview {
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25), 0 4px 8px rgba(0, 0, 0, 0.15);
		pointer-events: auto !important;
		cursor: pointer;
	}

	/* Bubble attention pulse — plays 3 times on load, then stops */
	.bubble-attention {
		animation: bubble-pulse 2s ease-in-out 3;
		transition: transform 0.2s ease-out, box-shadow 0.2s ease-out;
	}
	.bubble-attention:hover {
		transform: scale(1.05);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3), 0 6px 12px rgba(0, 0, 0, 0.2);
	}
	.bubble-attention.bubble-open {
		transform: scale(0.95);
	}
	@keyframes bubble-pulse {
		0%, 100% { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25), 0 4px 8px rgba(0, 0, 0, 0.15), 0 0 0 0 rgba(0, 0, 0, 0.15); }
		50% { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25), 0 4px 8px rgba(0, 0, 0, 0.15), 0 0 0 8px rgba(0, 0, 0, 0); }
	}

	/* Mobile: full-screen chat overlay */
	@media (max-width: 768px) {
		.widget-preview-wrapper {
			z-index: 2147483647 !important;
		}
		.chat-backdrop {
			display: block;
			position: fixed;
			inset: 0;
			background: rgba(0, 0, 0, 0.3);
			z-index: 0;
			-webkit-backdrop-filter: blur(2px);
			backdrop-filter: blur(2px);
		}
		.chat-window-container--desktop.is-open {
			position: fixed !important;
			inset: 0 !important;
			width: 100% !important;
			height: 100% !important;
			max-height: 100dvh !important;
			align-items: stretch !important;
			justify-content: stretch !important;
			padding: 0 !important;
			margin: 0 !important;
			z-index: 1 !important;
		}
		.chat-window-container--desktop.is-open :global(.chat-window) {
			flex: 1;
			width: 100% !important;
			height: 100% !important;
			max-width: 100% !important;
			max-height: 100dvh !important;
			min-width: 0;
			min-height: 0;
			border-radius: 0 !important;
		}
		/* Ensure bubble is always visible when chat is closed */
		.bubble-preview {
			position: relative !important;
			z-index: 9999 !important;
			display: flex !important;
		}
		/* Hide bubble when chat is open on mobile (chat window has close button) */
		.bubble-preview.bubble-open {
			display: none !important;
		}
	}

	/* Reduced-motion support */
	@media (prefers-reduced-motion: reduce) {
		.bubble-attention {
			animation: none;
		}
		.bubble-attention,
		.bubble-attention:hover,
		.bubble-attention.bubble-open {
			transition-duration: 0.01ms !important;
		}
	}
</style>
