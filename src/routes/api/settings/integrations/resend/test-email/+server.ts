import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getResendConfig, sendEmailWithResend } from '$lib/resend.server';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/settings/integrations/resend/test-email
 * Body: { toEmail: string }
 * Sends a test email via the current user's Resend integration.
 */
export const POST: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { toEmail?: string };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const toEmail = typeof body?.toEmail === 'string' ? body.toEmail.trim().toLowerCase() : '';
	if (!toEmail) return json({ error: 'Email address is required' }, { status: 400 });
	if (!EMAIL_REGEX.test(toEmail)) return json({ error: 'Invalid email address' }, { status: 400 });

	const config = await getResendConfig(event);
	if (!config) return json({ error: 'Resend is not connected' }, { status: 400 });

	const from = 'ProfitBot <onboarding@resend.dev>';
	const subject = 'ProfitBot – test email';
	const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p>Hi,</p>
  <p>This is a test email from <strong>ProfitBot</strong>. Your Resend integration is working correctly.</p>
  <p>You’ll receive quote PDFs and other transactional emails at this address when visitors request them through your chat widget.</p>
  <p style="color: #6b7280; font-size: 14px;">— ProfitBot</p>
</body>
</html>`;

	const result = await sendEmailWithResend(config.apiKey, {
		from,
		to: toEmail,
		subject,
		html
	});

	if (result.ok) return json({ ok: true });
	return json({ error: result.error ?? 'Failed to send test email' }, { status: 502 });
};
