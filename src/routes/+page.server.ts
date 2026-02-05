import type { PageServerLoad } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/** Parse a currency string (e.g. "$1,234.56", "1234.56") to a number */
function parseAmount(val: unknown): number {
	if (val == null || val === '') return 0;
	const s = String(val).replaceAll(/[^0-9.-]/g, '');
	const n = Number.parseFloat(s);
	return Number.isFinite(n) ? n : 0;
}

export type TopSpender = {
	id: string;
	name: string | null;
	email: string | null;
	totalSpend: number;
	orderCount: number;
	quoteCount: number;
};

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return { topSpenders: [], totalMessagesSent: 0, quotesSent: 0, totalQuotedAmount: 0 };
	}

	const supabase = getSupabaseClient(event);

	// Get conversation IDs for user's widgets (RLS filters)
	const { data: convs } = await supabase.from('widget_conversations').select('id');
	const convIds = (convs ?? []).map((c: { id: string }) => c.id);

	let totalMessagesSent = 0;
	if (convIds.length > 0) {
		const { count } = await supabase
			.from('widget_conversation_messages')
			.select('*', { count: 'exact', head: true })
			.in('conversation_id', convIds)
			.in('role', ['assistant', 'human_agent']);
		totalMessagesSent = count ?? 0;
	}

	const { data: rows, error } = await supabase
		.from('contacts')
		.select('id, name, email, pdf_quotes, shopify_orders')
		.limit(2000);

	if (error) {
		console.error('[dashboard] top spenders:', error);
		return { topSpenders: [], totalMessagesSent, quotesSent: 0, totalQuotedAmount: 0 };
	}

	const rawRows = rows ?? [];

	let quotesSent = 0;
	let totalQuotedAmount = 0;

	// Aggregate spend per contact (we treat each contact as a customer; same email may appear multiple times across widgets)
	const byContact: Map<string, { contact: { id: string; name: string | null; email: string | null }; spend: number; orders: number; quotes: number }> = new Map();

	for (const r of rawRows) {
		const id = r.id as string;
		const name = (r.name as string | null) ?? null;
		const email = (r.email as string | null) ?? null;

		let spend = 0;
		let orders = 0;
		let quotes = 0;

		// Shopify orders
		const shopifyOrders = Array.isArray(r.shopify_orders) ? r.shopify_orders : [];
		for (const o of shopifyOrders) {
			const total = typeof o === 'object' && o !== null && 'total_price' in o ? (o as { total_price?: unknown }).total_price : null;
			spend += parseAmount(total);
			orders += 1;
		}

		// PDF quotes
		const pdfQuotes = Array.isArray(r.pdf_quotes) ? r.pdf_quotes : [];
		for (const q of pdfQuotes) {
			const total = typeof q === 'object' && q !== null && 'total' in q ? (q as { total?: unknown }).total : null;
			spend += parseAmount(total);
			quotes += 1;
			totalQuotedAmount += parseAmount(total);
		}
		quotesSent += pdfQuotes.length;

		// Aggregate by email when present (same customer may have multiple contacts)
		const key = (email && typeof email === 'string' ? email.trim().toLowerCase() : null) || id;
		const existing = byContact.get(key);
		if (existing) {
			existing.spend += spend;
			existing.orders += orders;
			existing.quotes += quotes;
			// Prefer contact with name if current has one
			if (name && !existing.contact.name) existing.contact.name = name;
		} else {
			byContact.set(key, {
				contact: { id, name, email },
				spend,
				orders,
				quotes
			});
		}
	}

	const topSpenders: TopSpender[] = Array.from(byContact.values())
		.filter((x) => x.spend > 0)
		.sort((a, b) => b.spend - a.spend)
		.slice(0, 10)
		.map((x) => ({
			id: x.contact.id,
			name: x.contact.name,
			email: x.contact.email,
			totalSpend: x.spend,
			orderCount: x.orders,
			quoteCount: x.quotes
		}));

	return {
		topSpenders,
		totalMessagesSent,
		quotesSent,
		totalQuotedAmount
	};
};
