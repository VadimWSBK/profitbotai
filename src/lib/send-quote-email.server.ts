/**
 * Send quote PDF link via the widget owner's mailing integration (Resend or future providers).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { storeContactEmail } from '$lib/contact-email.server';
import { getResendConfigForUser, sendEmailWithResend } from '$lib/resend.server';

export interface SendQuoteEmailOptions {
	toEmail: string;
	quoteDownloadUrl: string;
	customerName?: string | null;
	/** When provided, the PDF is attached to the email. */
	pdfBuffer?: Buffer;
	/** When provided (e.g. from workflow Send email node), use instead of default subject/body. */
	customSubject?: string;
	customBody?: string;
	/** When provided, store the email in contact_emails for tracking and unified Messages view. */
	contactId?: string | null;
	/** When provided, link the stored email to a chat conversation. */
	conversationId?: string | null;
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

	const { toEmail, quoteDownloadUrl, customerName, pdfBuffer, customSubject, customBody } = opts;
	const to = toEmail.trim().toLowerCase();
	if (!to) {
		return { sent: false, error: 'Missing recipient email' };
	}
	const hasAttachment = Boolean(pdfBuffer && pdfBuffer.length > 0);

	// From address: Resend requires an email on your verified domain when sending to customers.
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

	// Quote emails are only sent from workflows; require subject and body from the workflow's Send email action (no hardcoded default).
	const hasCustomBody = typeof customBody === 'string' && customBody.trim();
	if (!hasCustomBody) {
		return {
			sent: false,
			error:
				'Configure the email subject and body in your workflow\'s Send email action (or choose a template). Quote emails are no longer sent with a default message.'
		};
	}

	const subject =
		typeof customSubject === 'string' && customSubject.trim() ? customSubject.trim() : 'Your quote';
	// Support [[link text]] → <a href="quoteDownloadUrl">link text</a> for custom link text
	const linkTexts: string[] = [];
	let bodyProcessed = customBody!.trim().replace(/\[\[([^\]]*)\]\]/g, (_, text: string) => {
		linkTexts.push(escapeHtml(text));
		return `\x00L${linkTexts.length - 1}\x00`;
	});
	bodyProcessed = escapeHtml(bodyProcessed).replaceAll(/\n/g, '<br>\n');
	bodyProcessed = linkify(bodyProcessed);
	bodyProcessed = bodyProcessed.replace(/\x00L(\d+)\x00/g, (_, i: string) =>
		`<a href="${escapeHtml(quoteDownloadUrl)}" style="color: #b45309; font-weight: 600;">${linkTexts[Number(i)]}</a>`
	);
	const bodyWithLinks = bodyProcessed;
	const hasLink = bodyWithLinks.includes('href=');
	const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  <div style="white-space: pre-wrap;">${bodyWithLinks}</div>
  ${!hasLink ? `<p><a href="${escapeHtml(quoteDownloadUrl)}" style="color: #b45309; font-weight: 600;">Download your quote</a></p><p style="color: #6b7280; font-size: 14px;">This link will expire in 1 hour.</p>` : ''}
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
		if (result.ok) {
			if (opts.contactId && result.id) {
				const bodyPreview = opts.customBody ?? '';
				await storeContactEmail(supabase, {
					contactId: opts.contactId,
					conversationId: opts.conversationId,
					subject,
					bodyPreview: stripHtml(bodyPreview).slice(0, 500),
					toEmail: to,
					fromEmail,
					provider: 'resend',
					providerMessageId: result.id,
					status: 'sent'
				});
			}
			return { sent: true };
		}
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

export interface SendContactEmailOptions {
	toEmail: string;
	subject: string;
	body: string;
	contactId: string;
	conversationId?: string | null;
	customerName?: string | null;
}

/**
 * Send a generic email to a contact (e.g. from Messages). Stores in contact_emails for tracking.
 */
export async function sendContactEmail(
	supabase: SupabaseClient,
	userId: string,
	opts: SendContactEmailOptions
): Promise<{ sent: boolean; error?: string }> {
	const integration = await getMailingIntegrationForUser(supabase, userId);
	if (!integration) {
		return { sent: false, error: 'No mailing integration connected' };
	}

	const { toEmail, subject, body, contactId, conversationId, customerName } = opts;
	const to = toEmail.trim().toLowerCase();
	if (!to) return { sent: false, error: 'Missing recipient email' };
	if (!subject?.trim()) return { sent: false, error: 'Missing subject' };

	const { data: quoteSettings } = await supabase
		.from('quote_settings')
		.select('company')
		.eq('user_id', userId)
		.maybeSingle();
	const company = (quoteSettings?.company as { name?: string; email?: string } | null) ?? {};
	const fromName = typeof company.name === 'string' && company.name.trim() ? company.name.trim() : 'Support';
	let fromEmail: string;
	if (integration.type === 'resend' && integration.fromEmail) {
		fromEmail = integration.fromEmail;
	} else {
		fromEmail = (typeof company.email === 'string' && company.email.trim() ? company.email.trim() : '') || 'onboarding@resend.dev';
	}
	const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

	const greeting = customerName?.trim() ? `Hi ${customerName.trim()},` : 'Hi,';
	const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p>${escapeHtml(greeting)}</p>
  <div style="white-space: pre-wrap;">${escapeHtml(body).replaceAll(/\n/g, '<br>\n')}</div>
  <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">— ${escapeHtml(fromName)}</p>
</body>
</html>`;

	if (integration.type === 'resend') {
		const result = await sendEmailWithResend(integration.apiKey, {
			from,
			to,
			subject: subject.trim(),
			html,
			replyTo: fromEmail === 'onboarding@resend.dev' ? undefined : fromEmail
		});
		if (result.ok && result.id) {
			await storeContactEmail(supabase, {
				contactId,
				conversationId,
				subject: subject.trim(),
				bodyPreview: body.slice(0, 500),
				toEmail: to,
				fromEmail,
				provider: 'resend',
				providerMessageId: result.id,
				status: 'sent'
			});
			return { sent: true };
		}
		return { sent: false, error: result.error };
	}
	return { sent: false, error: 'Unsupported mailing integration' };
}

function stripHtml(html: string): string {
	return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(s: string): string {
	return s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/** Turn plain http(s) URLs in text into clickable links (text already escaped). */
function linkify(text: string): string {
	return text.replace(
		/(https?:\/\/[^\s<]+)/g,
		(url) => `<a href="${escapeHtml(url)}" style="color: #b45309; font-weight: 600;">${escapeHtml(url)}</a>`
	);
}
