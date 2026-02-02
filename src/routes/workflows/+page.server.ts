import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	await parent();
	// Workflow list is loaded client-side from localStorage
	return {};
};
