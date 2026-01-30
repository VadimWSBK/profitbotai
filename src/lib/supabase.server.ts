import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';

const supabaseUrl = env.SUPABASE_URL ?? '';
const supabaseAnonKey = env.SUPABASE_ANON_KEY ?? '';
const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/**
 * Server-side Supabase client without auth (e.g. for service/anon operations).
 * Prefer getSupabaseClient(event) in API and load when you need the logged-in user.
 */
export function getSupabase() {
	if (!supabaseUrl || !supabaseAnonKey) {
		throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
	}
	return createClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Server-side Supabase client that uses the request's cookies for auth.
 * Use in hooks.server.ts, +page.server.ts load, and +server.ts handlers
 * so RLS and auth work with the current user's session.
 */
export function getSupabaseClient(event: RequestEvent) {
	if (!supabaseUrl || !supabaseAnonKey) {
		throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
	}
	return createServerClient(supabaseUrl, supabaseAnonKey, {
		cookies: {
			getAll() {
				return event.cookies.getAll();
			},
			setAll(cookiesToSet) {
				try {
					cookiesToSet.forEach(({ name, value, options }) =>
						event.cookies.set(name, value, { path: '/', ...options })
					);
				} catch {
					// Ignore when not in a response context (e.g. during redirect)
				}
			}
		}
	});
}

/** Service-role client for server-only operations (e.g. storage upload). Do not expose to client. */
export function getSupabaseAdmin() {
	if (!supabaseUrl || !supabaseServiceRoleKey) {
		throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
	}
	return createClient(supabaseUrl, supabaseServiceRoleKey);
}

export type WidgetRow = {
	id: string;
	name: string;
	display_mode: 'popup' | 'standalone' | 'embedded';
	config: Record<string, unknown>;
	n8n_webhook_url: string | null;
	created_at: string;
	updated_at: string;
};

export type WidgetEventRow = {
	id: string;
	widget_id: string;
	event_type: string;
	session_id: string | null;
	metadata: Record<string, unknown>;
	created_at: string;
};
