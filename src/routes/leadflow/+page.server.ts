import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	const res = await fetch('/api/widgets');
	const data = await res.json().catch(() => ({}));
	const widgets = Array.isArray(data.widgets) ? data.widgets : [];
	return { widgets };
};
