import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import nodemailer from 'nodemailer';

/**
 * POST /api/email/accounts/[id]/test – test SMTP connection for the account.
 * Attempts SMTP EHLO/verify. Updates account status and last_connected_at.
 */
export const POST: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });

	const supabase = getSupabaseClient(event);

	// Fetch account with credentials
	const { data: account, error: fetchError } = await supabase
		.from('email_accounts')
		.select('id, smtp_config, imap_config')
		.eq('id', id)
		.eq('user_id', event.locals.user.id)
		.single();

	if (fetchError) {
		if (fetchError.code === 'PGRST116') return json({ error: 'Account not found' }, { status: 404 });
		console.error('POST /api/email/accounts/[id]/test fetch:', fetchError);
		return json({ error: fetchError.message }, { status: 500 });
	}

	const smtp = (account.smtp_config as Record<string, unknown>) ?? {};
	const smtpResult: { success: boolean; error?: string } = { success: false };

	// Test SMTP connection
	try {
		if (!smtp.host || !smtp.username || !smtp.password) {
			smtpResult.error = 'SMTP host, username, and password are required';
		} else {
			const transport = nodemailer.createTransport({
				host: String(smtp.host),
				port: Number(smtp.port) || 587,
				secure: smtp.secure === true,
				auth: {
					user: String(smtp.username),
					pass: String(smtp.password)
				},
				connectionTimeout: 10000,
				greetingTimeout: 10000
			});
			await transport.verify();
			smtpResult.success = true;
			transport.close();
		}
	} catch (e) {
		smtpResult.error = e instanceof Error ? e.message : 'SMTP connection failed';
	}

	// Update account status based on test result
	const now = new Date().toISOString();
	const updateData: Record<string, unknown> = {};
	if (smtpResult.success) {
		updateData.status = 'active';
		updateData.last_error = null;
		updateData.last_connected_at = now;
	} else {
		updateData.status = 'error';
		updateData.last_error = smtpResult.error || 'Connection test failed';
	}

	await supabase
		.from('email_accounts')
		.update(updateData)
		.eq('id', id)
		.eq('user_id', event.locals.user.id);

	return json({ smtp: smtpResult });
};
