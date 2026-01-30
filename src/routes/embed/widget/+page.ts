import type { PageLoad } from './$types';

export const load: PageLoad = async ({ url, fetch }) => {
	const id = url.searchParams.get('id');
	if (!id) throw new Error('Missing widget id');
	const res = await fetch(`/api/widgets/${id}`);
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(data.error || 'Widget not found');
	}
	const data = await res.json();
	return { widgetId: id, initial: data };
}
