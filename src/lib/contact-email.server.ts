/**
 * Store and track contact emails. Used when sending via Resend and for webhook status updates.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type EmailStatus = 'pending' | 'sent' | 'delivered' | 'opened' | 'bounced' | 'failed';

export interface StoreContactEmailParams {
	contactId: string;
	conversationId?: string | null;
	direction?: 'outbound' | 'inbound';
	subject: string;
	bodyPreview?: string | null;
	toEmail: string;
	fromEmail?: string | null;
	provider?: string;
	providerMessageId?: string | null;
	status?: EmailStatus;
	sentAt?: string | null;
}

/**
 * Insert a contact email record. Use after successfully sending via Resend.
 */
export async function storeContactEmail(
	supabase: SupabaseClient,
	params: StoreContactEmailParams
): Promise<{ id: string } | { error: string }> {
	const {
		contactId,
		conversationId,
		direction = 'outbound',
		subject,
		bodyPreview,
		toEmail,
		fromEmail,
		provider = 'resend',
		providerMessageId,
		status = 'sent',
		sentAt = new Date().toISOString()
	} = params;

	const bodyPreviewTruncated =
		typeof bodyPreview === 'string' && bodyPreview.length > 0
			? bodyPreview.slice(0, 2000)
			: null;

	const { data, error } = await supabase
		.from('contact_emails')
		.insert({
			contact_id: contactId,
			conversation_id: conversationId ?? null,
			direction,
			subject: subject || '(no subject)',
			body_preview: bodyPreviewTruncated,
			to_email: toEmail,
			from_email: fromEmail ?? null,
			provider,
			provider_message_id: providerMessageId ?? null,
			status,
			sent_at: status === 'sent' || status === 'delivered' || status === 'opened' ? sentAt : null
		})
		.select('id')
		.single();

	if (error) return { error: error.message };
	return { id: data.id };
}

/**
 * Update contact email status from Resend webhook (delivered, opened, bounced, failed).
 */
export async function updateContactEmailStatus(
	supabase: SupabaseClient,
	providerMessageId: string,
	status: EmailStatus,
	timestamp?: string
): Promise<boolean> {
	const updates: Record<string, unknown> = { status };
	if (status === 'delivered' && timestamp) updates.delivered_at = timestamp;
	if (status === 'opened' && timestamp) updates.opened_at = timestamp;

	const { error } = await supabase
		.from('contact_emails')
		.update(updates)
		.eq('provider_message_id', providerMessageId);

	return !error;
}
