import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const SHOPIFY_SCOPES = 'read_orders,write_orders,write_draft_orders';

/**
 * GET /api/settings/integrations/shopify/connect?shop=your-store.myshopify.com
 * Redirects the user to Shopify OAuth authorization.
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const clientId = env.SHOPIFY_CLIENT_ID?.trim();
	const clientSecret = env.SHOPIFY_CLIENT_SECRET?.trim();
	if (!clientId || !clientSecret) {
		return new Response(
			JSON.stringify({ error: 'Shopify integration is not configured. Contact support.' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}

	const shop = event.url.searchParams.get('shop')?.trim().toLowerCase();
	if (!shop) {
		redirect(302, '/integrations?error=shop_required');
	}

	// Normalize shop domain: allow "store" or "store.myshopify.com"
	const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
	if (!shopDomain.match(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/)) {
		redirect(302, '/integrations?error=invalid_shop');
	}

	const state = crypto.randomUUID();
	const redirectUri = `${event.url.origin}/api/settings/integrations/shopify/callback`;
	const authUrl = `https://${shopDomain}/admin/oauth/authorize?` + new URLSearchParams({
		client_id: clientId,
		scope: SHOPIFY_SCOPES,
		redirect_uri: redirectUri,
		state
	});

	// Store state + shop in cookies for callback verification (expires in 10 min)
	event.cookies.set('shopify_oauth_state', state, {
		path: '/',
		httpOnly: true,
		secure: event.url.protocol === 'https:',
		sameSite: 'lax',
		maxAge: 600
	});
	event.cookies.set('shopify_oauth_shop', shopDomain, {
		path: '/',
		httpOnly: true,
		secure: event.url.protocol === 'https:',
		sameSite: 'lax',
		maxAge: 600
	});

	redirect(302, authUrl);
};
