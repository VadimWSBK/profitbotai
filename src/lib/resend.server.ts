/**
 * Resend integration helper.
 * Use this to send emails via Resend when the user has connected their API key.
 */

import { getSupabaseClient } from '$lib/supabase.server';
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export interface ResendConfig {
	apiKey: string;
	/** From address when sending (must be an email on your verified Resend domain, e.g. quotes@rs.yourdomain.com) */
	fromEmail?: string;
}

/**
 * Get the user's Resend config (API key) if they have integrated Resend.
 * Returns null if not connected.
 */
export async function getResendConfig(event: RequestEvent): Promise<ResendConfig | null> {
	const user = event.locals.user;
	if (!user || user.id === 'api-key') return null;
	const supabase = getSupabaseClient(event);
	const { data } = await supabase
		.from('user_integrations')
		.select('config')
		.eq('user_id', user.id)
		.eq('integration_type', 'resend')
		.single();
	const config = data?.config as { apiKey?: string; fromEmail?: string } | null;
	const apiKey = config?.apiKey?.trim();
	if (!apiKey) return null;
	const fromEmail = typeof config?.fromEmail === 'string' && config.fromEmail.trim() ? config.fromEmail.trim() : undefined;
	return { apiKey, fromEmail };
}

/**
 * Get Resend config for a user by ID (e.g. widget owner). Use with admin Supabase when no request context.
 */
export async function getResendConfigForUser(
	supabase: SupabaseClient,
	userId: string
): Promise<ResendConfig | null> {
	const { data } = await supabase
		.from('user_integrations')
		.select('config')
		.eq('user_id', userId)
		.eq('integration_type', 'resend')
		.single();
	const config = data?.config as { apiKey?: string; fromEmail?: string } | null;
	const apiKey = config?.apiKey?.trim();
	if (!apiKey) return null;
	const fromEmail = typeof config?.fromEmail === 'string' && config.fromEmail.trim() ? config.fromEmail.trim() : undefined;
	return { apiKey, fromEmail };
}

/**
 * Send an email via Resend API.
 * Optional attachments: array of { filename, content: Buffer }.
 * Returns Resend email id for webhook correlation when successful.
 */
export async function sendEmailWithResend(
	apiKey: string,
	opts: {
		from: string;
		to: string;
		subject: string;
		html: string;
		replyTo?: string;
		attachments?: { filename: string; content: Buffer }[];
	}
): Promise<{ ok: boolean; id?: string; error?: string }> {
	try {
		const resend = new Resend(apiKey);
		const { data, error } = await resend.emails.send({
			from: opts.from,
			to: opts.to,
			subject: opts.subject,
			html: opts.html,
			reply_to: opts.replyTo,
			...(opts.attachments?.length && {
				attachments: opts.attachments.map((a) => ({ filename: a.filename, content: a.content }))
			})
		});
		if (error) return { ok: false, error: error.message };
		if (data?.id) return { ok: true, id: data.id };
		return { ok: false, error: 'No message id returned' };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'Failed to send email' };
	}
}
