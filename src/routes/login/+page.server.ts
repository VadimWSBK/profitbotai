import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) throw redirect(302, url.searchParams.get('redirectTo') ?? '/');
	const message = url.searchParams.get('message') ?? null;
	return { message };
};

export const actions: Actions = {
	login: async (event) => {
		const formData = await event.request.formData();
		const email = (formData.get('email') as string)?.trim();
		const password = formData.get('password') as string;

		if (!email || !password) {
			return fail(400, { message: 'Email and password are required' });
		}

		const supabase = getSupabaseClient(event);
		const { error } = await supabase.auth.signInWithPassword({ email, password });

		if (error) {
			return fail(401, { message: error.message });
		}

		throw redirect(302, (event.url.searchParams.get('redirectTo') as string) ?? '/');
	}
};
