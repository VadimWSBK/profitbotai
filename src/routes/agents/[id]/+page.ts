import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
	const id = params.id;
	const [agentRes, llmKeysRes] = await Promise.all([
		fetch(`/api/agents/${id}`),
		fetch('/api/settings/llm-keys')
	]);
	if (!agentRes.ok) {
		const data = await agentRes.json().catch(() => ({}));
		throw new Error(data.error || 'Agent not found');
	}
	const agent = await agentRes.json();
	const llmKeys = llmKeysRes.ok ? ((await llmKeysRes.json()) as { providers?: string[] }).providers ?? [] : [];
	return { agentId: id, initial: agent, llmKeysAvailable: llmKeys };
};
