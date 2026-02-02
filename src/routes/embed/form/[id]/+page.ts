import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
	const id = params.id;
	if (!id) throw error(400, { message: 'Missing form id' });
	const res = await fetch(`/api/forms/${id}`);
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		const message = (data?.error as string) || 'Form not found';
		let status = res.status;
		if (status >= 500) status = 503;
		throw error(status, { message });
	}
	const form = await res.json();
	return { formId: id, form };
};
