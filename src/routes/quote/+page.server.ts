import type { PageServerLoad } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) return { settings: null };
	const supabase = getSupabaseClient(event);
	const { data } = await supabase
		.from('quote_settings')
		.select('company, bank_details, line_items, deposit_percent, tax_percent, valid_days, logo_url, barcode_url, barcode_title, logo_size, qr_size, currency')
		.eq('user_id', event.locals.user.id)
		.maybeSingle();
	if (!data) {
		return {
			settings: {
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
			}
		};
	}
	return {
		settings: {
			company: data.company ?? {},
			bank_details: data.bank_details ?? {},
			line_items: data.line_items ?? [],
			deposit_percent: Number(data.deposit_percent) || 40,
			tax_percent: Number(data.tax_percent) || 10,
			valid_days: Number(data.valid_days) || 30,
			logo_url: data.logo_url,
			barcode_url: data.barcode_url,
			barcode_title: data.barcode_title ?? 'Call Us or Visit Website',
			logo_size: data.logo_size == null ? 60 : Math.min(80, Number(data.logo_size)),
			qr_size: data.qr_size == null ? 80 : Number(data.qr_size),
			currency: data.currency ?? 'USD'
		}
	};
};
