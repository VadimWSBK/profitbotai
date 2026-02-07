<script lang="ts">
	import WidgetPreview from '$lib/components/WidgetPreview.svelte';
	import { defaultWidgetConfig, type WidgetConfig } from '$lib/widget-config';

	let { data } = $props();
	const initial = $derived(
		(data?.initial as {
			id: string;
			name: string;
			displayMode: string;
			config: Partial<WidgetConfig>;
			n8nWebhookUrl?: string;
		}) ?? null
	);

	function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
		const out = { ...target };
		for (const key of Object.keys(source) as (keyof T)[]) {
			const s = source[key];
			if (s === undefined) continue;
			if (
				s !== null &&
				typeof s === 'object' &&
				!Array.isArray(s) &&
				typeof target[key] === 'object' &&
				target[key] !== null &&
				!Array.isArray(target[key])
			) {
				(out[key] as T[keyof T]) = deepMerge(
					target[key] as unknown as Record<string, unknown>,
					s as Record<string, unknown>
				) as unknown as T[keyof T];
			} else {
				(out[key] as T[keyof T]) = s as T[keyof T];
			}
		}
		return out;
	}

	const base = JSON.parse(JSON.stringify(defaultWidgetConfig)) as WidgetConfig;
	const config = $derived(
		(initial?.config
			? deepMerge(base as unknown as Record<string, unknown>, {
					...initial.config,
					name: initial.name ?? initial.config.name,
					displayMode: (initial.displayMode ?? initial.config.displayMode) as WidgetConfig['displayMode'],
					n8nWebhookUrl: initial.n8nWebhookUrl ?? initial.config.n8nWebhookUrl ?? ''
				})
			: base) as WidgetConfig
	);
</script>

<svelte:head>
	<title>{config.name}</title>
</svelte:head>

<div class="embed-widget-root" data-embed-page="1">
	<WidgetPreview config={config} widgetId={data.widgetId} />
</div>

<style>
	/* The embed page lives inside a transparent full-viewport iframe.
	   Ensure html/body/wrapper don't add scrollbars or backgrounds.
	   Set pointer-events: none on html/body so clicks pass through to host page. */
	:global(html), :global(body) {
		background: transparent !important;
		background-color: transparent !important;
		overflow: hidden !important;
		margin: 0;
		padding: 0;
		width: 100%;
		height: 100%;
		pointer-events: none !important;
	}
	:global(#svelte-announcer),
	:global([data-embed-page]) {
		background: transparent !important;
		background-color: transparent !important;
		pointer-events: none !important;
	}
	.embed-widget-root {
		width: 100%;
		height: 100%;
		min-height: 0;
		background: transparent !important;
		background-color: transparent !important;
		overflow: visible;
		pointer-events: none !important;
	}
	/* Widget wrapper handles its own pointer-events - don't override it */
	.embed-widget-root :global(.widget-preview-wrapper) {
		pointer-events: none !important;
	}
	/* Ensure interactive elements inside widget are clickable */
	.embed-widget-root :global(.widget-preview-wrapper .bubble-preview),
	.embed-widget-root :global(.widget-preview-wrapper .tooltip-preview),
	.embed-widget-root :global(.widget-preview-wrapper .chat-backdrop),
	.embed-widget-root :global(.widget-preview-wrapper .chat-window-container .chat-window),
	.embed-widget-root :global(.widget-preview-wrapper .chat-window-container *) {
		pointer-events: auto !important;
	}
</style>
