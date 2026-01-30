import { getSupabaseClient } from '$lib/supabase.server';
import type { Handle } from '@sveltejs/kit';

const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/signup', '/auth/logout'];
const EMBED_PREFIX = '/embed';
const API_EVENTS_PATH = '/api/widgets/events';

function isPublicPath(pathname: string): boolean {
	if (pathname.startsWith(EMBED_PREFIX)) return true;
	// Allow anonymous POST so embed script can send widget events
	if (pathname === API_EVENTS_PATH) return true;
	return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export const handle: Handle = async ({ event, resolve }) => {
	const supabase = getSupabaseClient(event);
	const {
		data: { session }
	} = await supabase.auth.getSession();

	event.locals.user = session?.user ?? null;
	event.locals.role = null;

	if (session?.user) {
		const { data: profile } = await supabase
			.from('profiles')
			.select('role')
			.eq('user_id', session.user.id)
			.single();
		event.locals.role = (profile?.role as 'admin' | 'user') ?? null;
	}

	// Require auth for non-public routes (except embed and static)
	if (!isPublicPath(event.url.pathname)) {
		if (!event.locals.user) {
			return Response.redirect(new URL('/login', event.url.origin), 302);
		}
	}

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name.toLowerCase() === 'content-range';
		}
	});
};
