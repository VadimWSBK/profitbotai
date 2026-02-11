/**
 * Send quote PDF link via the widget owner's mailing integration (Resend or future providers).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { storeContactEmail } from '$lib/contact-email.server';
import { getResendConfigForUser, sendEmailWithResend } from '$lib/resend.server';

export interface EmailFooterConfig {
	logoUrl?: string;
	websiteUrl?: string;
	websiteText?: string;
	phone?: string;
	email?: string;
}

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
	
	// Detect if body contains HTML
	const bodyIsHtml = containsHtml(customBody!);
	const bodyProcessed = processEmailBody(customBody!.trim(), bodyIsHtml, quoteDownloadUrl);
	const hasLink = bodyProcessed.includes('href=');
	
	// Build HTML email - if body is already HTML, wrap it; otherwise use pre-wrap for plain text
	const bodyWrapper = bodyIsHtml 
		? `<div>${bodyProcessed}</div>`
		: `<div style="white-space: pre-wrap;">${bodyProcessed}</div>`;
	
	// Get email footer config from integration
	const { data: integrationData } = await supabase
		.from('user_integrations')
		.select('config')
		.eq('user_id', userId)
		.eq('integration_type', 'resend')
		.maybeSingle();
	const integrationConfig = (integrationData?.config as { emailFooter?: EmailFooterConfig }) ?? {};
	const footerHtml = buildEmailFooter(integrationConfig.emailFooter);
	
	const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  ${bodyWrapper}
  ${!hasLink ? `<p><a href="${escapeHtml(quoteDownloadUrl)}" style="color: #b45309; font-weight: 600;">Download your quote</a></p>` : ''}
  <p style="color: #6b7280; font-size: 14px;">— ${escapeHtml(fromName)}</p>
  ${footerHtml}
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
	
	// Detect if body contains HTML
	const bodyIsHtml = containsHtml(body);
	const bodyProcessed = processEmailBody(body.trim(), bodyIsHtml);
	
	// Build HTML email - if body is already HTML, wrap it; otherwise use pre-wrap for plain text
	const bodyWrapper = bodyIsHtml 
		? `<div>${bodyProcessed}</div>`
		: `<div style="white-space: pre-wrap;">${bodyProcessed}</div>`;
	
	// Get email footer config from integration
	const { data: integrationData } = await supabase
		.from('user_integrations')
		.select('config')
		.eq('user_id', userId)
		.eq('integration_type', 'resend')
		.maybeSingle();
	const integrationConfig = (integrationData?.config as { emailFooter?: EmailFooterConfig }) ?? {};
	const footerHtml = buildEmailFooter(integrationConfig.emailFooter);
	
	const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p>${escapeHtml(greeting)}</p>
  ${bodyWrapper}
  <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">— ${escapeHtml(fromName)}</p>
  ${footerHtml}
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
	return html.replaceAll(/<[^>]*>/g, ' ').replaceAll(/\s+/g, ' ').trim();
}

function escapeHtml(s: string): string {
	return s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/**
 * Check if a string contains HTML tags (basic detection).
 * Looks for common HTML tags like <p>, <div>, <table>, <a>, etc.
 */
function containsHtml(content: string): boolean {
	if (!content || typeof content !== 'string') return false;
	// Check for HTML tags (allowing for whitespace and attributes)
	const htmlTagPattern = /<[a-z][a-z0-9]*(\s[^>]*)?>/i;
	return htmlTagPattern.test(content);
}

/** Turn plain http(s) URLs in text into clickable links (text already escaped). */
function linkify(text: string): string {
	return text.replace(
		/(https?:\/\/[^\s<]+)/g,
		(url) => `<a href="${escapeHtml(url)}" style="color: #b45309; font-weight: 600;">${escapeHtml(url)}</a>`
	);
}

/**
 * Build email footer HTML with logo, website link, phone, and email.
 */
function buildEmailFooter(footer?: EmailFooterConfig | null): string {
	if (!footer) return '';
	
	const hasLogo = footer.logoUrl && footer.logoUrl.trim();
	const hasWebsite = footer.websiteUrl && footer.websiteUrl.trim();
	const hasPhone = footer.phone && footer.phone.trim();
	const hasEmail = footer.email && footer.email.trim();
	
	if (!hasLogo && !hasWebsite && !hasPhone && !hasEmail) return '';
	
	const websiteText = footer.websiteText?.trim() || (hasWebsite ? 'Visit our website' : '');
	const websiteLink = hasWebsite 
		? `<a href="${escapeHtml(footer.websiteUrl!)}" style="color: #b45309; text-decoration: none; font-weight: 600;">${escapeHtml(websiteText)}</a>`
		: '';
	
	const phoneLink = hasPhone 
		? `<a href="tel:${escapeHtml(footer.phone!.replaceAll(/\s+/g, ''))}" style="color: #6b7280; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
				<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
			</svg>
			${escapeHtml(footer.phone!)}
		</a>`
		: '';
	
	const emailLink = hasEmail
		? `<a href="mailto:${escapeHtml(footer.email!)}" style="color: #6b7280; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
				<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
				<polyline points="22,6 12,13 2,6"></polyline>
			</svg>
			${escapeHtml(footer.email!)}
		</a>`
		: '';
	
	const items: string[] = [];
	if (hasLogo) {
		items.push(`<img src="${escapeHtml(footer.logoUrl!)}" alt="" style="max-height: 40px; width: auto; margin-bottom: 8px; display: block;" />`);
	}
	if (websiteLink) items.push(`<div>${websiteLink}</div>`);
	if (phoneLink) items.push(`<div>${phoneLink}</div>`);
	if (emailLink) items.push(`<div>${emailLink}</div>`);
	
	if (items.length === 0) return '';
	
	return `
	<div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
		<div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-start;">
			${items.join('')}
		</div>
	</div>`;
}

/**
 * Process email body: if it contains HTML, use as-is (but still process [[link text]]).
 * If plain text, escape and convert newlines to <br>.
 */
function processEmailBody(body: string, isHtml: boolean, quoteDownloadUrl?: string): string {
	if (isHtml) {
		// HTML content: support [[link text]] syntax for quote links
		if (quoteDownloadUrl) {
			const linkTexts: string[] = [];
			let processed = body.replace(/\[\[([^\]]*)\]\]/g, (_, text: string) => {
				linkTexts.push(text); // Don't escape link text in HTML mode
				return `\x00L${linkTexts.length - 1}\x00`;
			});
			processed = processed.replace(/\x00L(\d+)\x00/g, (_, i: string) =>
				`<a href="${escapeHtml(quoteDownloadUrl)}" style="color: #b45309; font-weight: 600;">${linkTexts[Number(i)]}</a>`
			);
			return processed;
		}
		return body;
	} else {
		// Plain text: escape and convert newlines
		let processed = escapeHtml(body).replaceAll(/\n/g, '<br>\n');
		if (quoteDownloadUrl) {
			// Support [[link text]] syntax
			const linkTexts: string[] = [];
			processed = processed.replace(/\[\[([^\]]*)\]\]/g, (_, text: string) => {
				linkTexts.push(escapeHtml(text));
				return `\x00L${linkTexts.length - 1}\x00`;
			});
			processed = linkify(processed);
			processed = processed.replace(/\x00L(\d+)\x00/g, (_, i: string) =>
				`<a href="${escapeHtml(quoteDownloadUrl)}" style="color: #b45309; font-weight: 600;">${linkTexts[Number(i)]}</a>`
			);
		} else {
			processed = linkify(processed);
		}
		return processed;
	}
}
