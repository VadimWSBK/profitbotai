/**
 * Send quote PDF link via the widget owner's mailing integration (Resend or future providers).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getResendConfigForUser, sendEmailWithResend } from '$lib/resend.server';

export interface SendQuoteEmailOptions {
	toEmail: string;
	quoteDownloadUrl: string;
	customerName?: string | null;
	/** When provided, the PDF is attached to the email. */
	pdfBuffer?: Buffer;
}

/**
 * Get the widget owner's mailing integration config (Resend, etc.).
 * Returns null if no mailing integration is connected.
 */
export async function getMailingIntegrationForUser(
	supabase: SupabaseClient,
	userId: string
): Promise<{ type: 'resend'; apiKey: string; fromEmail?: string } | null> {
	const resend = await getResendConfigForUser(supabase, userId);
	if (resend) return { type: 'resend', apiKey: resend.apiKey, fromEmail: resend.fromEmail };
	return null;
}

/**
 * Send the quote link email using the widget owner's mailing integration.
 * Uses Resend when connected; from address comes from quote_settings.company.email.
 */
export async function sendQuoteEmail(
	supabase: SupabaseClient,
	userId: string,
	opts: SendQuoteEmailOptions
): Promise<{ sent: boolean; error?: string }> {
	const integration = await getMailingIntegrationForUser(supabase, userId);
	if (!integration) {
		return { sent: false, error: 'No mailing integration connected' };
	}

	const { toEmail, quoteDownloadUrl, customerName, pdfBuffer } = opts;
	const to = toEmail.trim().toLowerCase();
	if (!to) {
		return { sent: false, error: 'Missing recipient email' };
	}
	const hasAttachment = Boolean(pdfBuffer && pdfBuffer.length > 0);

	// From address: Resend requires an email on your verified domain when sending to customers.
	// Prefer integration.fromEmail (set in Settings → Integrations → Resend), then quote_settings.company.email.
	const { data: quoteSettings } = await supabase
		.from('quote_settings')
		.select('company')
		.eq('user_id', userId)
		.maybeSingle();
	const company = (quoteSettings?.company as { name?: string; email?: string } | null) ?? {};
	const fromName = typeof company.name === 'string' && company.name.trim()
		? company.name.trim()
		: 'Quote';
	let fromEmail: string;
	if (integration.type === 'resend' && integration.fromEmail) {
		fromEmail = integration.fromEmail;
	} else {
		const companyEmail = typeof company.email === 'string' && company.email.trim() ? company.email.trim() : '';
		fromEmail = companyEmail || 'onboarding@resend.dev';
	}
	let from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

	const greeting = customerName?.trim() ? `Hi ${customerName.trim()},` : 'Hi,';
	const subject = 'Your quote is ready';
	const bodyCopy = hasAttachment
		? 'Your quote PDF is attached to this email. You can also download it using the link below:'
		: 'Your quote is ready. Click the link below to download your PDF:';
	const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p>${greeting}</p>
  <p>${bodyCopy}</p>
  <p><a href="${escapeHtml(quoteDownloadUrl)}" style="color: #b45309; font-weight: 600;">Download your quote</a></p>
  <p>This link will expire in 1 hour. If you have any questions, just reply to this email.</p>
  <p style="color: #6b7280; font-size: 14px;">— ${escapeHtml(fromName)}</p>
</body>
</html>`;

	if (integration.type === 'resend') {
		const result = await sendEmailWithResend(integration.apiKey, {
			from,
			to,
			subject,
			html,
			replyTo: fromEmail === 'onboarding@resend.dev' ? undefined : fromEmail,
			attachments: hasAttachment ? [{ filename: 'quote.pdf', content: pdfBuffer! }] : undefined
		});
		if (result.ok) return { sent: true };
		// Resend only allows sending to other recipients when "from" is an email on a verified domain.
		const needsVerifiedDomain =
			/only send testing emails to your own|verify a domain|change the .*from.*address to an email using this domain/i.test(
				result.error ?? ''
			);
		if (needsVerifiedDomain) {
			return {
				sent: false,
				error:
					'To send quote emails to customers, set the "From email" in Settings → Integrations → Resend to an address on your verified domain (e.g. quotes@rs.netzerocoating.com).'
			};
		}
		return { sent: false, error: result.error };
	}

	return { sent: false, error: 'Unsupported mailing integration' };
}

function escapeHtml(s: string): string {
	return s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
