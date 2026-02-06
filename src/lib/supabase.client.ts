import { createClient } from '@supabase/supabase-js';
import { browser } from '$app/environment';

/**
 * Browser-side Supabase client for realtime subscriptions.
 * Requires supabaseUrl and supabaseAnonKey to be passed (safe to expose - anon key is designed to be public, RLS protects data).
 */
export function getSupabaseBrowserClient(supabaseUrl: string, supabaseAnonKey: string) {
	if (!browser) {
		throw new Error('getSupabaseBrowserClient can only be called in the browser');
	}

	if (!supabaseUrl || !supabaseAnonKey) {
		console.warn('Supabase URL or anon key not available. Realtime subscriptions will not work.');
		return null;
	}

	return createClient(supabaseUrl, supabaseAnonKey);
}
