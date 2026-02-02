import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw error(401, 'Unauthorized');
	const id = event.params.id;
	if (!id) throw error(400, 'Missing template id');
	const supabase = getSupabaseClient(event);
	const { data, error: err } = await supabase
		.from('email_templates')
		.select('id, name, subject, body, created_at, updated_at')
		.eq('id', id)
		.eq('user_id', event.locals.user.id)
		.single();
	if (err || !data) throw error(404, 'Template not found');
	return {
		templateId: data.id,
		template: {
			name: data.name,
			subject: data.subject ?? '',
			body: data.body ?? ''
		}
	};
};
