import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';

export const load: PageServerLoad = async ({ fetch }) => {
	const res = await fetch('/api/widgets');
	const data = await res.json().catch(() => ({}));
	const widgets = Array.isArray(data.widgets) ? data.widgets : [];
	return {
		widgets,
		supabaseUrl: env.SUPABASE_URL ?? '',
		supabaseAnonKey: env.SUPABASE_ANON_KEY ?? ''
	};
};
