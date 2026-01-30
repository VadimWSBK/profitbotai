import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

const supabaseUrl = env.SUPABASE_URL ?? '';
const supabaseAnonKey = env.SUPABASE_ANON_KEY ?? '';

/**
 * Server-side Supabase client. Use in +server.ts and +page.server.ts.
 * Set SUPABASE_URL and SUPABASE_ANON_KEY in .env (from Supabase dashboard).
 */
export function getSupabase() {
	if (!supabaseUrl || !supabaseAnonKey) {
		throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
	}
	return createClient(supabaseUrl, supabaseAnonKey);
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
