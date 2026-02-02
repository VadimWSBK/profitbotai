import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw error(401, 'Unauthorized');
	const id = event.params.id;
	if (!id) throw error(400, 'Missing form id');
	const supabase = getSupabaseClient(event);
	const { data, error: err } = await supabase
		.from('quote_forms')
		.select('id, name, title, steps, colors, success_title, success_message, success_buttons, created_at, updated_at')
		.eq('id', id)
		.eq('user_id', event.locals.user.id)
		.single();
	if (err || !data) throw error(404, 'Form not found');
	const successButtons = (data.success_buttons as { label: string; url: string }[] | null) ?? [];
	return {
		formId: data.id,
		form: {
			name: data.name,
			title: data.title,
			steps: (data.steps as unknown[]) ?? [],
			colors: (data.colors as Record<string, string>) ?? { primary: '#D4AF37' },
			success_title: data.success_title ?? null,
			success_message: data.success_message ?? null,
			success_buttons: Array.isArray(successButtons) ? successButtons : []
		}
	};
};
