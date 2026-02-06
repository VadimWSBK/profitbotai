import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * GET /api/auth/user – get current user info
 */
export const GET: RequestHandler = async (event) => {
	return json({ user: event.locals.user });
};
