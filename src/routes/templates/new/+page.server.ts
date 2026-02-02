import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

export const actions: Actions = {
	default: async (event) => {
		if (!event.locals.user) {
			return { error: 'Unauthorized' };
		}
		const supabase = getSupabaseClient(event);
		const { data, error } = await supabase
			.from('email_templates')
			.insert({
				user_id: event.locals.user.id,
				name: 'Untitled template',
				subject: '',
				body: ''
			})
			.select('id')
			.single();
		if (error) {
			console.error('templates/new:', error);
			return { error: error.message };
		}
		throw redirect(303, `/templates/${data.id}`);
	}
};
