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
 * GET /api/email/accounts/[id] – fetch single email account.
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	const supabase = getSupabaseClient(event);
	const { data, error } = await supabase
		.from('email_accounts')
		.select(SELECT_FIELDS)
		.eq('id', id)
		.eq('user_id', event.locals.user.id)
		.single();
	if (error) {
		if (error.code === 'PGRST116') return json({ error: 'Account not found' }, { status: 404 });
		console.error('GET /api/email/accounts/[id]:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json(stripPasswords(data as Record<string, unknown>));
};

/**
 * PUT /api/email/accounts/[id] – update email account.
 * If smtp_config or imap_config is provided without a password, preserves the existing password.
 */
export const PUT: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	let body: Record<string, unknown>;
	try {
		body = await event.request.json().catch(() => ({}));
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const supabase = getSupabaseClient(event);

	// Fetch existing record to merge passwords if needed
	const { data: existing, error: fetchError } = await supabase
		.from('email_accounts')
		.select('smtp_config, imap_config')
		.eq('id', id)
		.eq('user_id', event.locals.user.id)
		.single();
	if (fetchError) {
		if (fetchError.code === 'PGRST116') return json({ error: 'Account not found' }, { status: 404 });
		console.error('PUT /api/email/accounts/[id] fetch:', fetchError);
		return json({ error: fetchError.message }, { status: 500 });
	}

	const updates: Record<string, unknown> = {};

	if (typeof body?.email_address === 'string') updates.email_address = body.email_address.trim();
	if (typeof body?.display_name === 'string') updates.display_name = body.display_name.trim();
	if (body?.reply_to !== undefined) {
		updates.reply_to = typeof body.reply_to === 'string' && body.reply_to.trim() ? body.reply_to.trim() : null;
	}
	if (typeof body?.provider_type === 'string' && ['google', 'microsoft', 'smtp'].includes(body.provider_type)) {
		updates.provider_type = body.provider_type;
	}
	if (typeof body?.status === 'string' && ['active', 'paused', 'error'].includes(body.status)) {
		updates.status = body.status;
	}

	// Merge SMTP config: preserve existing password if not provided
	if (body?.smtp_config && typeof body.smtp_config === 'object') {
		const newSmtp = body.smtp_config as Record<string, unknown>;
		const existingSmtp = (existing?.smtp_config as Record<string, unknown>) ?? {};
		updates.smtp_config = {
			...existingSmtp,
			...newSmtp,
			password: newSmtp.password || existingSmtp.password || ''
		};
	}

	// Merge IMAP config: preserve existing password if not provided
	if (body?.imap_config && typeof body.imap_config === 'object') {
		const newImap = body.imap_config as Record<string, unknown>;
		const existingImap = (existing?.imap_config as Record<string, unknown>) ?? {};
		updates.imap_config = {
			...existingImap,
			...newImap,
			password: newImap.password || existingImap.password || ''
		};
	}

	if (body?.daily_send_limit !== undefined) {
		updates.daily_send_limit = Math.max(1, Math.min(1000, Number(body.daily_send_limit) || 30));
	}
	if (body?.warmup_enabled !== undefined) {
		updates.warmup_enabled = body.warmup_enabled === true;
	}
	if (body?.daily_warmup_limit !== undefined) {
		updates.daily_warmup_limit = Math.max(0, Math.min(100, Number(body.daily_warmup_limit) || 10));
	}
	if (typeof body?.signature_html === 'string') {
		updates.signature_html = body.signature_html;
	}

	if (Object.keys(updates).length === 0) {
		return json({ error: 'No fields to update' }, { status: 400 });
	}

	const { data, error } = await supabase
		.from('email_accounts')
		.update(updates)
		.eq('id', id)
		.eq('user_id', event.locals.user.id)
		.select(SELECT_FIELDS)
		.single();

	if (error) {
		if (error.code === 'PGRST116') return json({ error: 'Account not found' }, { status: 404 });
		console.error('PUT /api/email/accounts/[id]:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json({ account: stripPasswords(data as Record<string, unknown>) });
};

/**
 * DELETE /api/email/accounts/[id]
 */
export const DELETE: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const id = event.params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	const supabase = getSupabaseClient(event);
	const { error } = await supabase
		.from('email_accounts')
		.delete()
		.eq('id', id)
		.eq('user_id', event.locals.user.id);
	if (error) {
		if (error.code === 'PGRST116') return json({ error: 'Account not found' }, { status: 404 });
		console.error('DELETE /api/email/accounts/[id]:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return new Response(null, { status: 204 });
};
