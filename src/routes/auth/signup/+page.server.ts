import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) throw redirect(302, '/');
	return {};
};

export const actions: Actions = {
	signup: async (event) => {
		const formData = await event.request.formData();
		const email = (formData.get('email') as string)?.trim();
		const password = formData.get('password') as string;

		if (!email || !password) {
			return fail(400, { message: 'Email and password are required' });
		}
		if (password.length < 6) {
			return fail(400, { message: 'Password must be at least 6 characters' });
		}

		const supabase = getSupabaseClient(event);
		const { error } = await supabase.auth.signUp({ email, password });

		if (error) {
			return fail(400, { message: error.message });
		}

		// Redirect to login; user may need to confirm email depending on Supabase project settings
		const msg = encodeURIComponent('Check your email to confirm your account.');
		throw redirect(302, `/login?message=${msg}`);
	}
};
