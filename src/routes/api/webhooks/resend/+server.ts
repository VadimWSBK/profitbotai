/**
 * POST /api/webhooks/resend
 * Resend webhook for email events (sent, delivered, opened, bounced, failed).
 * Configure in Resend Dashboard → Webhooks with URL: https://yourdomain.com/api/webhooks/resend
 * Set RESEND_WEBHOOK_SECRET in env (from webhook signing secret in Resend).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Resend } from 'resend';
import { getSupabaseAdmin } from '$lib/supabase.server';
import { updateContactEmailStatus } from '$lib/contact-email.server';
import { env } from '$env/dynamic/private';

const WEBHOOK_SECRET = env.RESEND_WEBHOOK_SECRET ?? '';

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

	let payload: { type?: string; data?: { email_id?: string; created_at?: string } };
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

	const status = eventType ? EVENT_STATUS_MAP[eventType] : null;
	if (!status || !emailId) {
		return json({ received: true });
	}

	const admin = getSupabaseAdmin();
	const ok = await updateContactEmailStatus(admin, emailId, status, createdAt ?? undefined);
	if (!ok) {
		console.warn('[webhooks/resend] No contact_email found for provider_message_id:', emailId);
	}

	return json({ received: true });
};
