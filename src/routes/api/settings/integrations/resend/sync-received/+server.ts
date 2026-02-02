import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { syncReceivedEmailsForUser } from '$lib/sync-received-emails.server';

/**
 * POST /api/settings/integrations/resend/sync-received
 * Syncs received emails from Resend into contact_emails for the current user.
 * Only stores emails when the sender matches an existing contact.
 */
export const POST: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const supabase = getSupabaseClient(event);
	const result = await syncReceivedEmailsForUser(supabase, event.locals.user.id);

	if (result.error) {
		return json({ error: result.error, synced: result.synced, skipped: result.skipped }, { status: 502 });
	}

	return json({ ok: true, synced: result.synced, skipped: result.skipped });
};
