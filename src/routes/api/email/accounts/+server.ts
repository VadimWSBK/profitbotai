import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/** Strip password fields from SMTP/IMAP config before returning to client. */
function stripPasswords(account: Record<string, unknown>) {
	const smtp = (account.smtp_config as Record<string, unknown>) ?? {};
	const imap = (account.imap_config as Record<string, unknown>) ?? {};
	return {
		...account,
		smtp_config: { host: smtp.host, port: smtp.port, username: smtp.username, secure: smtp.secure },
		imap_config: { host: imap.host, port: imap.port, username: imap.username, secure: imap.secure }
	};
}

const SELECT_FIELDS =
	'id, email_address, display_name, reply_to, provider_type, status, smtp_config, imap_config, daily_send_limit, warmup_enabled, daily_warmup_limit, signature_html, last_error, last_connected_at, created_at, updated_at';

/**
 * GET /api/email/accounts – list all email accounts for the current user.
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const supabase = getSupabaseClient(event);
	const { data, error } = await supabase
		.from('email_accounts')
		.select(SELECT_FIELDS)
		.eq('user_id', event.locals.user.id)
		.order('created_at', { ascending: false });
	if (error) {
		console.error('GET /api/email/accounts:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json({ accounts: (data ?? []).map(stripPasswords) });
};

/**
 * POST /api/email/accounts – create a new email account.
 */
export const POST: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	let body: Record<string, unknown>;
	try {
		body = await event.request.json().catch(() => ({}));
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const emailAddress = typeof body?.email_address === 'string' ? body.email_address.trim() : '';
	if (!emailAddress) {
		return json({ error: 'email_address is required' }, { status: 400 });
	}

	const providerType = typeof body?.provider_type === 'string' && ['google', 'microsoft', 'smtp'].includes(body.provider_type)
		? body.provider_type
		: 'smtp';

	const smtpConfig = (body?.smtp_config && typeof body.smtp_config === 'object') ? body.smtp_config : {};
	const imapConfig = (body?.imap_config && typeof body.imap_config === 'object') ? body.imap_config : {};

	const supabase = getSupabaseClient(event);
	const { data, error } = await supabase
		.from('email_accounts')
		.insert({
			user_id: event.locals.user.id,
			email_address: emailAddress,
			display_name: typeof body?.display_name === 'string' ? body.display_name.trim() : '',
			reply_to: typeof body?.reply_to === 'string' && body.reply_to.trim() ? body.reply_to.trim() : null,
			provider_type: providerType,
			smtp_config: smtpConfig,
			imap_config: imapConfig,
			daily_send_limit: Math.max(1, Math.min(1000, Number(body?.daily_send_limit) || 30)),
			warmup_enabled: body?.warmup_enabled === true,
			daily_warmup_limit: Math.max(0, Math.min(100, Number(body?.daily_warmup_limit) || 10)),
			signature_html: typeof body?.signature_html === 'string' ? body.signature_html : ''
		})
		.select(SELECT_FIELDS)
		.single();

	if (error) {
		console.error('POST /api/email/accounts:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json({ account: stripPasswords(data as Record<string, unknown>) });
};
