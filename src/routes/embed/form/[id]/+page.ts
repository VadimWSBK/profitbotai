import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
	const id = params.id;
	if (!id) throw new Error('Missing form id');
	const res = await fetch(`/api/forms/${id}`);
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(data.error || 'Form not found');
	}
	const form = await res.json();
	return { formId: id, form };
};
