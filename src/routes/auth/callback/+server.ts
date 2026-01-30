import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * Supabase redirects here after OAuth or email confirmation.
 * Exchanges code for session and redirects to dashboard.
 */
export const GET: RequestHandler = async (event) => {
	const supabase = getSupabaseClient(event);
	const code = event.url.searchParams.get('code');
	const next = event.url.searchParams.get('next') ?? '/';

	if (code) {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) {
			throw redirect(302, next);
		}
	}

	// No code or exchange failed: go to login
	throw redirect(302, '/login');
};
