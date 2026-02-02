import type { PageServerLoad } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) return { forms: [] };
	const supabase = getSupabaseClient(event);
	const { data } = await supabase
		.from('quote_forms')
		.select('id, name, title, steps, colors, created_at, updated_at')
		.eq('user_id', event.locals.user.id)
		.order('created_at', { ascending: false });
	return { forms: data ?? [] };
};
