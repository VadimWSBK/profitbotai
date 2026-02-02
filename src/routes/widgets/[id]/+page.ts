import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
	const id = params.id;
	const [widgetRes, llmKeysRes, agentsRes] = await Promise.all([
		fetch(`/api/widgets/${id}`),
		fetch('/api/settings/llm-keys'),
		fetch('/api/agents')
	]);
	if (!widgetRes.ok) {
		const data = await widgetRes.json().catch(() => ({}));
		throw new Error(data.error || 'Widget not found');
	}
	const data = await widgetRes.json();
	const llmKeys = llmKeysRes.ok ? ((await llmKeysRes.json()) as { providers?: string[] }).providers ?? [] : [];
	const agents = agentsRes.ok ? ((await agentsRes.json()) as { agents?: { id: string; name: string }[] }).agents ?? [] : [];
	return { widgetId: id, initial: data, llmKeysAvailable: llmKeys, agents };
};
