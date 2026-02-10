/**
 * GET /api/checkout/redirect?message_id=...
 * Records that the user clicked "GO TO CHECKOUT" for this message, then redirects to the stored Shopify checkout URL.
 * Use this URL in the widget so we can track clicks and later measure conversion.
 */
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';

export const GET: RequestHandler = async (event) => {
	const messageId = event.url.searchParams.get('message_id')?.trim();
	if (!messageId) {
		return new Response('Missing message_id', { status: 400 });
	}
	try {
		const admin = getSupabaseAdmin();
		const { data: preview, error: fetchErr } = await admin
			.from('widget_checkout_previews')
			.select('checkout_url, checkout_clicked_at')
			.eq('message_id', messageId)
			.maybeSingle();
		if (fetchErr || !preview?.checkout_url) {
			return new Response('Checkout link not found or expired', { status: 404 });
		}
		const targetUrl = preview.checkout_url.trim();
		if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
			return new Response('Invalid checkout URL', { status: 400 });
		}
		// Record click (idempotent: only set if not already set)
		if (!preview.checkout_clicked_at) {
			await admin
				.from('widget_checkout_previews')
				.update({ checkout_clicked_at: new Date().toISOString() })
				.eq('message_id', messageId);
		}
		redirect(302, targetUrl);
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && e.status === 302) throw e;
		console.error('GET /api/checkout/redirect:', e);
		return new Response('Failed to redirect', { status: 500 });
	}
};
