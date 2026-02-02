/**
 * POST /api/webhooks/resend
 * Resend webhook for email events (sent, delivered, opened, bounced, failed, received).
 * Configure in Resend Dashboard → Webhooks with URL: https://yourdomain.com/api/webhooks/resend
 * Enable email.received for inbound email tracking.
 * Set RESEND_WEBHOOK_SECRET in env (from webhook signing secret in Resend).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Resend } from 'resend';
import { getSupabaseAdmin } from '$lib/supabase.server';
import { updateContactEmailStatus, storeContactEmail } from '$lib/contact-email.server';
import { getResendConfigForUser, getReceivedEmail } from '$lib/resend.server';
import { extractEmailFromAddress } from '$lib/sync-received-emails.server';
import { env } from '$env/dynamic/private';

const WEBHOOK_SECRET = env.RESEND_WEBHOOK_SECRET ?? '';

function stripHtml(html: string): string {
	return html.replaceAll(/<[^>]*>/g, ' ').replaceAll(/\s+/g, ' ').trim();
}

const EVENT_STATUS_MAP: Record<string, 'sent' | 'delivered' | 'opened' | 'bounced' | 'failed'> = {
	'email.sent': 'sent',
	'email.delivered': 'delivered',
	'email.opened': 'opened',
	'email.bounced': 'bounced',
	'email.failed': 'failed'
};

export const POST: RequestHandler = async (event) => {
	const rawBody = await event.request.text();
	const id = event.request.headers.get('svix-id');
	const timestamp = event.request.headers.get('svix-timestamp');
	const signature = event.request.headers.get('svix-signature');

	if (!WEBHOOK_SECRET) {
		console.error('[webhooks/resend] RESEND_WEBHOOK_SECRET not configured');
		return json({ error: 'Webhook not configured' }, { status: 500 });
	}

	if (!id || !timestamp || !signature) {
		return json({ error: 'Missing webhook headers' }, { status: 400 });
	}

	let payload: {
		type?: string;
		data?: {
			email_id?: string;
			created_at?: string;
			from?: string;
			to?: string[];
			subject?: string;
		};
	};
	try {
		const resend = new Resend();
		const verified = resend.webhooks.verify({
			payload: rawBody,
			headers: { id, timestamp, signature },
			webhookSecret: WEBHOOK_SECRET
		});
		payload = verified as typeof payload;
	} catch (e) {
		console.error('[webhooks/resend] Verify failed:', e);
		return json({ error: 'Invalid webhook signature' }, { status: 400 });
	}

	const eventType = payload?.type;
	const emailId = payload?.data?.email_id;
	const createdAt = payload?.data?.created_at;
	const admin = getSupabaseAdmin();

	// Handle email.received – store inbound email and link to contact
	if (eventType === 'email.received' && emailId) {
		const toAddresses = payload?.data?.to ?? [];
		const fromRaw = payload?.data?.from ?? '';

		const toNormalized = new Set(
			toAddresses.map((a) => extractEmailFromAddress(a)).filter(Boolean)
		);

		// Find user whose Resend fromEmail matches one of the "to" addresses
		const { data: integrations } = await admin
			.from('user_integrations')
			.select('user_id, config')
			.eq('integration_type', 'resend');

		let matchedUserId: string | null = null;
		for (const row of integrations ?? []) {
			const config = row.config as { fromEmail?: string } | null;
			const fromEmail = config?.fromEmail?.trim().toLowerCase();
			if (fromEmail && toNormalized.has(fromEmail)) {
				matchedUserId = row.user_id;
				break;
			}
		}

		if (matchedUserId) {
			const senderEmail = extractEmailFromAddress(fromRaw);
			if (senderEmail) {
				const resendConfig = await getResendConfigForUser(admin, matchedUserId);
				if (resendConfig) {
					const full = await getReceivedEmail(resendConfig.apiKey, emailId);
					if (full.ok && full.id) {
						// Find contact by sender email for this user's widgets
						const { data: widgets } = await admin
							.from('widgets')
							.select('id')
							.eq('created_by', matchedUserId);
						const widgetIds = (widgets ?? []).map((w: { id: string }) => w.id);

						if (widgetIds.length > 0) {
							const { data: contactRow } = await admin
								.from('contacts')
								.select('id, conversation_id')
								.in('widget_id', widgetIds)
								.ilike('email', senderEmail)
								.limit(1)
								.maybeSingle();

							if (contactRow) {
								const bodyPreview = full.text ?? (full.html ? stripHtml(full.html) : null) ?? '';
								const toEmail = Array.isArray(full.to) && full.to.length > 0 ? full.to[0] : '';
								await storeContactEmail(admin, {
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
							}
						}
					}
				}
			}
		}
		return json({ received: true });
	}

	// Handle outbound status updates (sent, delivered, opened, bounced, failed)
	const status = eventType ? EVENT_STATUS_MAP[eventType] : null;
	if (!status || !emailId) {
		return json({ received: true });
	}

	const ok = await updateContactEmailStatus(admin, emailId, status, createdAt ?? undefined);
	if (!ok) {
		console.warn('[webhooks/resend] No contact_email found for provider_message_id:', emailId);
	}

	return json({ received: true });
};
