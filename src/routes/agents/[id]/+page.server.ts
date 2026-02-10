import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

function getOrigin(url: URL, request: Request): string {
	const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
	const proto = request.headers.get('x-forwarded-proto') ?? url.protocol;
	if (!host) return url.origin;
	const scheme = proto === 'https' || proto === 'http' ? proto : 'https';
	return `${scheme}://${host}`;
}

export const load: PageServerLoad = async ({ locals, url, request }) => {
	if (!locals.user) throw redirect(302, '/login');
	if (locals.role !== 'admin') throw redirect(302, '/');
	return { origin: getOrigin(url, request) };
};
