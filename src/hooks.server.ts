import { getSupabaseClient } from '$lib/supabase.server';
import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/signup', '/auth/logout'];
const EMBED_PREFIX = '/embed';
const API_EVENTS_PATH = '/api/widgets/events';

/** Paths that require X-API-Key for server-to-server auth (e.g. n8n) */
const API_KEY_PATHS = ['/api/contacts/signed-url'];
/** Paths that handle their own authentication (MCP) */
const SELF_AUTH_PATHS = ['/api/mcp'];
/** Paths that accept either session or X-API-Key (e.g. quote generate, contacts, send-email from n8n) */
const OPTIONAL_API_KEY_PATHS = [
	'/api/quote/generate',
	'/api/conversations', // send-email: /api/conversations/[id]/send-email
	'/api/widgets' // contacts: /api/widgets/[id]/contacts
];

function isPublicPath(pathname: string, method: string): boolean {
	if (pathname.startsWith(EMBED_PREFIX)) return true;
	if (pathname === API_EVENTS_PATH) return true;
	// Allow anonymous POST for Resend webhooks (authenticated via signature verification)
	if (pathname === '/api/webhooks/resend') return method === 'POST';
	// Allow anonymous GET for widget config (embed loads this to display the chat)
	if (/^\/api\/widgets\/[^/]+$/.test(pathname)) return method === 'GET';
	// Allow anonymous POST for chat (embed widget sends messages)
	if (/^\/api\/widgets\/[^/]+\/chat$/.test(pathname)) return true;
	// Allow anonymous GET for widget messages (embed polls for human agent replies)
	if (/^\/api\/widgets\/[^/]+\/messages$/.test(pathname)) return true;
	// Allow anonymous POST for saving messages (n8n syncs messages to widget_conversation_messages)
	if (/^\/api\/widgets\/[^/]+\/messages\/save$/.test(pathname)) return method === 'POST';
	// Allow anonymous POST for saving messages via conversationId (n8n syncs messages to widget_conversation_messages)
	if (/^\/api\/conversations\/[^/]+\/messages\/save$/.test(pathname)) return method === 'POST';
	// Allow anonymous GET for conversation id (widget sends widgetId + conversationId to n8n)
	if (/^\/api\/widgets\/[^/]+\/conversation$/.test(pathname)) return method === 'GET';
	// Allow anonymous GET only for quote form config (embed form page); PUT/DELETE require auth (form builder save)
	if (/^\/api\/forms\/[^/]+$/.test(pathname)) return method === 'GET';
	// Allow anonymous POST for quote form submit (embed form submission)
	if (/^\/api\/forms\/[^/]+\/submit$/.test(pathname)) return true;
	// Allow anonymous GET for quote download redirect (short link in chat → fresh signed URL)
	if (pathname === '/api/quote/download') return method === 'GET';
	return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export const handle: Handle = async ({ event, resolve }) => {
	const pathname = event.url.pathname;
	const method = event.request.method;

	// For public paths (embed, login, etc.) skip Supabase session to avoid 500s in iframes
	if (isPublicPath(pathname, method)) {
		event.locals.user = null;
		event.locals.role = null;
	} else {
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
	}

	// Allow API key auth for server-to-server (e.g. n8n)
	const apiKey = event.request.headers.get('X-API-Key');
	const expectedKey = env.SIGNED_URL_API_KEY;
	const isApiKeyPath = API_KEY_PATHS.some(
		(p) => event.url.pathname === p || event.url.pathname.startsWith(p + '/')
	);
	const isOptionalApiKeyPath = OPTIONAL_API_KEY_PATHS.some(
		(p) => event.url.pathname === p || event.url.pathname.startsWith(p + '/')
	);
	if (isApiKeyPath) {
		if (expectedKey && apiKey === expectedKey) {
			event.locals.user = { id: 'api-key', email: '' } as typeof event.locals.user;
			event.locals.role = null;
		} else if (expectedKey) {
			return new Response(JSON.stringify({ error: 'Invalid or missing X-API-Key' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	} else if (isOptionalApiKeyPath && expectedKey && apiKey === expectedKey) {
		event.locals.user = { id: 'api-key', email: '' } as typeof event.locals.user;
		event.locals.role = null;
	}

	// Require auth for non-public routes (except embed, static, and self-auth paths like MCP)
	const isSelfAuthPath = SELF_AUTH_PATHS.some(
		(p) => pathname === p || pathname.startsWith(p + '/')
	);
	if (!isPublicPath(event.url.pathname, event.request.method) && !isSelfAuthPath) {
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
