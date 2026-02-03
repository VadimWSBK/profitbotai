import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { getShopifyConfig, listCustomers, listOrdersForCustomer } from '$lib/shopify.server';
import type { ShopifyOrderSummary } from '$lib/shopify.server';

/**
 * POST /api/contacts/sync-shopify
 * Syncs contacts from the connected Shopify store: fetches all customers and their orders,
 * upserts contacts by email, and stores order summaries on each contact.
 * Requires Shopify integration to be connected.
 */
export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const config = await getShopifyConfig(event);
	if (!config) {
		return json({ error: 'Shopify is not connected. Connect Shopify in Settings → Integrations.' }, { status: 400 });
	}

	const supabase = getSupabaseClient(event);
	let synced = 0;
	let created = 0;
	let updated = 0;
	let pageInfo: string | undefined;

	try {
		do {
			const { customers, nextPageInfo, error: listError } = await listCustomers(config, {
				limit: 250,
				pageInfo
			});
			if (listError) {
				return json({ error: listError, synced, created, updated }, { status: 502 });
			}
			pageInfo = nextPageInfo;

			for (const customer of customers ?? []) {
				const email =
					typeof customer.email === 'string' ? customer.email.trim().toLowerCase() : '';
				if (!email) continue;

				const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() || null;
				const defaultAddr = customer.default_address;
				// Phone: Shopify often stores it on default_address rather than on customer
				let phone: string | null = null;
				if (typeof customer.phone === 'string' && customer.phone.trim()) {
					phone = customer.phone.trim();
				} else if (defaultAddr && typeof defaultAddr.phone === 'string' && defaultAddr.phone.trim()) {
					phone = defaultAddr.phone.trim();
				}
				const addressParts = defaultAddr
					? [defaultAddr.address1, defaultAddr.address2, defaultAddr.city, defaultAddr.province, defaultAddr.country, defaultAddr.zip].filter(Boolean) as string[]
					: [];
				const address = addressParts.length > 0 ? addressParts.join(', ').trim() : null;
				// Split address for street_address, city, state, postcode, country
				const streetAddress =
					defaultAddr && (defaultAddr.address1 || defaultAddr.address2)
						? [defaultAddr.address1, defaultAddr.address2].filter(Boolean).join(', ').trim()
						: null;
				const city = defaultAddr && typeof defaultAddr.city === 'string' && defaultAddr.city.trim() ? defaultAddr.city.trim() : null;
				const state = defaultAddr && typeof defaultAddr.province === 'string' && defaultAddr.province.trim() ? defaultAddr.province.trim() : null;
				const postcode = defaultAddr && typeof defaultAddr.zip === 'string' && defaultAddr.zip.trim() ? defaultAddr.zip.trim() : null;
				const country = defaultAddr && typeof defaultAddr.country === 'string' && defaultAddr.country.trim() ? defaultAddr.country.trim() : null;

				const { orders, error: ordersError } = await listOrdersForCustomer(config, customer.id);
				if (ordersError) {
					console.error(`Shopify sync: failed to get orders for customer ${customer.id}:`, ordersError);
				}
				const orderSummaries: ShopifyOrderSummary[] = (orders ?? []).map((o) => ({
					id: o.id,
					name: o.name,
					email: o.email ?? undefined,
					created_at: o.created_at,
					financial_status: o.financial_status,
					fulfillment_status: o.fulfillment_status,
					cancelled_at: o.cancelled_at,
					cancel_reason: o.cancel_reason,
					total_price: o.total_price,
					currency: o.currency,
					order_status_url: o.order_status_url,
					discount_codes: Array.isArray(o.discount_codes) ? o.discount_codes : undefined
				}));

				const { data: rpcData, error: rpcError } = await supabase.rpc('upsert_contact_by_email', {
					p_email: email,
					p_name: name,
					p_phone: phone,
					p_address: address
				});
				if (rpcError) {
					console.error('Shopify sync: upsert_contact_by_email error:', rpcError);
					continue;
				}
				const result = rpcData as { success?: boolean; action?: string; id?: string } | null;
				if (!result?.success || !result.id) continue;

				if (result.action === 'created') created += 1;
				else if (result.action === 'updated') updated += 1;
				synced += 1;

				// Update shopify_orders and ensure 'shopify' tag is present
				const { data: existing } = await supabase
					.from('contacts')
					.select('tags')
					.eq('id', result.id)
					.single();
				const raw = (existing as { tags?: unknown })?.tags;
				const tags: string[] = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];
				const newTags = tags.includes('shopify') ? tags : [...tags, 'shopify'];

				const updatePayload: Record<string, unknown> = {
					shopify_orders: orderSummaries,
					tags: newTags
				};
				if (phone != null) updatePayload.phone = phone;
				if (streetAddress != null) updatePayload.street_address = streetAddress;
				if (city != null) updatePayload.city = city;
				if (state != null) updatePayload.state = state;
				if (postcode != null) updatePayload.postcode = postcode;
				if (country != null) updatePayload.country = country;
				// Keep legacy address in sync when we have split fields
				if (address != null) updatePayload.address = address;

				const { error: updateError } = await supabase
					.from('contacts')
					.update(updatePayload)
					.eq('id', result.id);
				if (updateError) {
					console.error('Shopify sync: update contact fields error:', updateError);
				}
			}
		} while (pageInfo);

		return json({ synced, created, updated });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Sync failed';
		console.error('POST /api/contacts/sync-shopify:', e);
		return json({ error: msg, synced, created, updated }, { status: 500 });
	}
};
