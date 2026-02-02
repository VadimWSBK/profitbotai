import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
	const id = params.id;
	const res = await fetch(`/api/agents/${id}`);
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(data.error || 'Agent not found');
	}
	const agent = await res.json();
	return { agentId: id, initial: agent };
};
