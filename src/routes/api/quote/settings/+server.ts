import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

export type QuoteSettingsPayload = {
	company?: { name?: string; address?: string; phone?: string; email?: string };
	bank_details?: { name?: string; accountName?: string; bsb?: string; accountNumber?: string };
	line_items?: { desc: string; price: number; fixed: boolean; total?: number }[];
	deposit_percent?: number;
	tax_percent?: number;
	valid_days?: number;
	logo_url?: string | null;
	barcode_url?: string | null;
	barcode_title?: string | null;
	logo_size?: number | null;
	qr_size?: number | null;
	currency?: string;
};

/**
 * GET /api/quote/settings – load current user's quote template.
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const supabase = getSupabaseClient(event);
	const { data, error } = await supabase
		.from('quote_settings')
		.select('*')
		.eq('user_id', event.locals.user.id)
		.maybeSingle();
	if (error) {
		console.error('quote_settings GET:', error);
		return json({ error: error.message }, { status: 500 });
	}
	if (!data) {
		return json({
			company: {},
			bank_details: {},
			line_items: [],
			deposit_percent: 40,
			tax_percent: 10,
			valid_days: 30,
			logo_url: null,
			barcode_url: null,
			barcode_title: 'Call Us or Visit Website',
			logo_size: 80,
			qr_size: 80,
			currency: 'USD'
		});
	}
	return json({
		company: data.company ?? {},
		bank_details: data.bank_details ?? {},
		line_items: data.line_items ?? [],
		deposit_percent: Number(data.deposit_percent) ?? 40,
		tax_percent: Number(data.tax_percent) ?? 10,
		valid_days: Number(data.valid_days) ?? 30,
		logo_url: data.logo_url,
		barcode_url: data.barcode_url,
		barcode_title: data.barcode_title ?? 'Call Us or Visit Website',
		logo_size: data.logo_size != null ? Math.min(120, Number(data.logo_size)) : 80,
		qr_size: data.qr_size != null ? Number(data.qr_size) : 80,
		currency: data.currency ?? 'USD'
	});
};

/**
 * PUT /api/quote/settings – upsert current user's quote template.
 */
export const PUT: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	let body: QuoteSettingsPayload;
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const supabase = getSupabaseClient(event);
	const userId = event.locals.user.id;

	const logoSize = Math.max(20, Math.min(120, Number(body.logo_size) || 80));
	const qrSize = Math.max(20, Math.min(300, Number(body.qr_size) || 80));

	const row = {
		user_id: userId,
		company: body.company ?? {},
		bank_details: body.bank_details ?? {},
		line_items: body.line_items ?? [],
		deposit_percent: Math.max(0, Math.min(100, Number(body.deposit_percent) ?? 40)),
		tax_percent: Math.max(0, Math.min(100, Number(body.tax_percent) ?? 10)),
		valid_days: Math.max(1, Math.min(365, Number(body.valid_days) ?? 30)),
		logo_url: body.logo_url ?? null,
		barcode_url: body.barcode_url ?? null,
		barcode_title: typeof body.barcode_title === 'string' ? body.barcode_title : 'Call Us or Visit Website',
		logo_size: logoSize,
		qr_size: qrSize,
		currency: typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim() : 'USD'
	};

	const { error } = await supabase.from('quote_settings').upsert(row, {
		onConflict: 'user_id',
		ignoreDuplicates: false
	});
	if (error) {
		console.error('quote_settings PUT:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json({ ok: true });
};
