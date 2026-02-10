import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

const DEFAULTS = {
	default_daily_send_limit: 30,
	min_delay_minutes: 3,
	random_delay_minutes: 5,
	bounce_threshold_pct: 5.0,
	spam_complaint_threshold_pct: 2.0
};

/**
 * GET /api/email/settings – load global outreach settings (or defaults).
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const supabase = getSupabaseClient(event);
	const { data, error } = await supabase
		.from('email_outreach_settings')
		.select('*')
		.eq('user_id', event.locals.user.id)
		.maybeSingle();
	if (error) {
		console.error('GET /api/email/settings:', error);
		return json({ error: error.message }, { status: 500 });
	}
	if (!data) {
		return json(DEFAULTS);
	}
	return json({
		default_daily_send_limit: Number(data.default_daily_send_limit) || DEFAULTS.default_daily_send_limit,
		min_delay_minutes: Number(data.min_delay_minutes) || DEFAULTS.min_delay_minutes,
		random_delay_minutes: Number(data.random_delay_minutes) || DEFAULTS.random_delay_minutes,
		bounce_threshold_pct: Number(data.bounce_threshold_pct) || DEFAULTS.bounce_threshold_pct,
		spam_complaint_threshold_pct: Number(data.spam_complaint_threshold_pct) || DEFAULTS.spam_complaint_threshold_pct
	});
};

/**
 * PUT /api/email/settings – upsert global outreach settings.
 */
export const PUT: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	let body: Record<string, unknown>;
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const supabase = getSupabaseClient(event);
	const userId = event.locals.user.id;

	const row = {
		user_id: userId,
		default_daily_send_limit: Math.max(1, Math.min(1000, Number(body.default_daily_send_limit) || DEFAULTS.default_daily_send_limit)),
		min_delay_minutes: Math.max(0, Math.min(60, Number(body.min_delay_minutes) || DEFAULTS.min_delay_minutes)),
		random_delay_minutes: Math.max(0, Math.min(60, Number(body.random_delay_minutes) || DEFAULTS.random_delay_minutes)),
		bounce_threshold_pct: Math.max(0, Math.min(100, Number(body.bounce_threshold_pct) || DEFAULTS.bounce_threshold_pct)),
		spam_complaint_threshold_pct: Math.max(0, Math.min(100, Number(body.spam_complaint_threshold_pct) || DEFAULTS.spam_complaint_threshold_pct))
	};

	const { error } = await supabase.from('email_outreach_settings').upsert(row, {
		onConflict: 'user_id',
		ignoreDuplicates: false
	});
	if (error) {
		console.error('PUT /api/email/settings:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json({ ok: true });
};
