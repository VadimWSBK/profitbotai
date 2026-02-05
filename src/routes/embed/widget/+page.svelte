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

<div class="embed-widget-root min-h-[900px] w-full bg-transparent overflow-visible">
	<WidgetPreview config={config} widgetId={data.widgetId} />
</div>
