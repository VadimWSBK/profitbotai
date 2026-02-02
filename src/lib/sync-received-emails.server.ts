/**
 * Sync received emails from Resend into contact_emails.
 * Matches by sender email to existing contacts and stores inbound emails.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getResendConfigForUser, getReceivedEmail, listReceivedEmails } from '$lib/resend.server';
import { storeContactEmail } from '$lib/contact-email.server';

const EMAIL_ANGLE_RE = /<([^>]+)>/;

/** Extract plain email from "Name <email@example.com>" or "email@example.com". */
export function extractEmailFromAddress(addr: string): string {
	const s = (addr ?? '').trim();
	const m = EMAIL_ANGLE_RE.exec(s);
	if (m) return m[1].trim().toLowerCase();
	return s.toLowerCase();
}

/** Extract display name from "Name <email@example.com>" (returns "Name"); "email@example.com" returns "". */
export function extractNameFromAddress(addr: string): string {
	const s = (addr ?? '').trim();
	const idx = s.indexOf('<');
	if (idx <= 0) return '';
	let name = s.slice(0, idx).trim();
	if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).trim();
	return name || '';
}

function stripHtml(html: string): string {
	return html.replaceAll(/<[^>]*>/g, ' ').replaceAll(/\s+/g, ' ').trim();
}

/**
 * Sync received emails for a user from Resend into contact_emails.
 * Only stores emails when we can match the sender to an existing contact.
 */
export async function syncReceivedEmailsForUser(
	supabase: SupabaseClient,
	userId: string
): Promise<{ synced: number; skipped: number; error?: string }> {
	const resend = await getResendConfigForUser(supabase, userId);
	if (!resend) {
		return { synced: 0, skipped: 0, error: 'Resend not connected' };
	}

	const result = await listReceivedEmails(resend.apiKey, { limit: 100 });
	if (result.error) {
		return { synced: 0, skipped: 0, error: result.error };
	}
	const received = result.data ?? [];
	let synced = 0;
	let skipped = 0;

	for (const email of received) {
		// Skip if already stored
		const { data: existing } = await supabase
			.from('contact_emails')
			.select('id')
			.eq('provider_message_id', email.id)
			.eq('direction', 'inbound')
			.maybeSingle();
		if (existing) {
			skipped++;
			continue;
		}

		const senderEmail = extractEmailFromAddress(email.from);
		if (!senderEmail) {
			skipped++;
			continue;
		}

		// Find contact with this email (RLS ensures we only see contacts for user's widgets)
		const { data: contactRow } = await supabase
			.from('contacts')
			.select('id, conversation_id')
			.ilike('email', senderEmail)
			.limit(1)
			.maybeSingle();

		if (!contactRow) {
			skipped++;
			continue;
		}

		const full = await getReceivedEmail(resend.apiKey, email.id);
		if (!full.ok || !full.id) {
			skipped++;
			continue;
		}

		const bodyPreview = full.text ?? (full.html ? stripHtml(full.html) : null) ?? '';
		const toEmail = Array.isArray(full.to) && full.to.length > 0 ? full.to[0] : '';

		const stored = await storeContactEmail(supabase, {
			contactId: contactRow.id,
			conversationId: contactRow.conversation_id ?? null,
			direction: 'inbound',
			subject: full.subject ?? '(no subject)',
			bodyPreview: bodyPreview.slice(0, 500),
			toEmail,
			fromEmail: senderEmail,
			provider: 'resend',
			providerMessageId: full.id,
			status: 'delivered',
			sentAt: full.created_at ?? new Date().toISOString()
		});

		if ('error' in stored) {
			skipped++;
		} else {
			synced++;
		}
	}

	return { synced, skipped };
}
