<script lang="ts">
	import { page } from '$app/stores';

	const widgetId = $derived($page.url.searchParams.get('widget_id') ?? '');

	type EventRow = { id: string; widgetId: string; eventType: string; sessionId: string | null; metadata: Record<string, unknown>; createdAt: string };
	let events = $state<EventRow[]>([]);
	let loading = $state(true);
	let error = $state('');

	$effect(() => {
		const id = $page.url.searchParams.get('widget_id') ?? '';
		let cancelled = false;
		loading = true;
		error = '';
		const url = id ? `/api/analytics?widget_id=${encodeURIComponent(id)}` : '/api/analytics';
		fetch(url)
			.then((r) => r.json())
			.then((data: { events?: EventRow[]; error?: string }) => {
				if (cancelled) return;
				if (data.error) error = data.error;
				else if (Array.isArray(data.events)) events = data.events;
			})
			.catch((e) => {
				if (!cancelled) error = e instanceof Error ? e.message : 'Failed to load';
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});
</script>

<h1 class="text-2xl font-bold text-gray-900">Analytics</h1>
<p class="text-gray-500 mt-1">Widget events and usage. Filter by widget via <code class="text-sm bg-gray-100 px-1 rounded">?widget_id=...</code></p>

{#if widgetId}
	<p class="mt-2 text-sm text-amber-700">Showing events for widget <code class="bg-amber-50 px-1 rounded">{widgetId}</code>. <a href="/analytics" class="underline">Show all</a></p>
{/if}

{#if error}
	<p class="mt-4 text-red-600">{error}</p>
{/if}

{#if loading}
	<p class="mt-4 text-gray-500">Loading…</p>
{:else}
	<div class="mt-6 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-gray-200 bg-gray-50">
					<th class="text-left py-3 px-4 font-medium text-gray-600">Time</th>
					<th class="text-left py-3 px-4 font-medium text-gray-600">Event</th>
					<th class="text-left py-3 px-4 font-medium text-gray-600">Widget ID</th>
					<th class="text-left py-3 px-4 font-medium text-gray-600">Session</th>
				</tr>
			</thead>
			<tbody>
				{#each events as ev (ev.id)}
					<tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
						<td class="py-2 px-4 text-gray-600">{new Date(ev.createdAt).toLocaleString()}</td>
						<td class="py-2 px-4 font-medium">{ev.eventType}</td>
						<td class="py-2 px-4 font-mono text-xs truncate max-w-[180px]" title={ev.widgetId}>{ev.widgetId}</td>
						<td class="py-2 px-4 text-gray-500">{ev.sessionId ?? '—'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if events.length === 0 && !error}
			<p class="py-8 text-center text-gray-500">No events yet. Events are recorded when you use the widget or call POST /api/widgets/events.</p>
		{/if}
	</div>
{/if}
