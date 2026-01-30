import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
	const id = params.id;
	const [widgetRes, llmKeysRes] = await Promise.all([
		fetch(`/api/widgets/${id}`),
		fetch('/api/settings/llm-keys')
	]);
	if (!widgetRes.ok) {
		const data = await widgetRes.json().catch(() => ({}));
		throw new Error(data.error || 'Widget not found');
	}
	const data = await widgetRes.json();
	const llmKeys = llmKeysRes.ok ? ((await llmKeysRes.json()) as { providers?: string[] }).providers ?? [] : [];
	return { widgetId: id, initial: data, llmKeysAvailable: llmKeys };
};
