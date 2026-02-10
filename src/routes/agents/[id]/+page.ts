import { browser } from '$app/environment';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch, data }) => {
	const id = params.id;
	// Prefer origin from server (correct on Vercel via x-forwarded-* headers); fallback in client
	const baseOrigin = (data as { origin?: string } | undefined)?.origin;
	const [agentRes, llmKeysRes] = await Promise.all([
		fetch(`/api/agents/${id}`),
		fetch('/api/settings/llm-keys')
	]);
	if (!agentRes.ok) {
		const errData = await agentRes.json().catch(() => ({}));
		throw new Error((errData as { error?: string }).error || 'Agent not found');
	}
	const agent = await agentRes.json();
	const llmKeys = llmKeysRes.ok ? ((await llmKeysRes.json()) as { providers?: string[] }).providers ?? [] : [];
	const origin = baseOrigin ?? (browser ? globalThis.window.location.origin : '');
	return { agentId: id, initial: agent, llmKeysAvailable: llmKeys, origin };
};
