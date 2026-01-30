import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

export const GET: RequestHandler = async (event) => {
	const supabase = getSupabaseClient(event);
	await supabase.auth.signOut();
	throw redirect(302, '/login');
};
