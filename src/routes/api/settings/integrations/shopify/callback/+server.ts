import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/settings/integrations/shopify/callback?code=...&shop=...&state=...
 * Shopify redirects here after the user authorizes. Exchange code for access token and store.
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) {
		redirect(302, '/login?next=/integrations');
	}

	const code = event.url.searchParams.get('code');
	const shop = event.url.searchParams.get('shop')?.trim().toLowerCase();
	const state = event.url.searchParams.get('state');

	const storedState = event.cookies.get('shopify_oauth_state');
	const storedShop = event.cookies.get('shopify_oauth_shop');

	// Clear cookies immediately
	event.cookies.delete('shopify_oauth_state', { path: '/' });
	event.cookies.delete('shopify_oauth_shop', { path: '/' });

	if (!code || !shop || !state || state !== storedState || shop !== storedShop) {
		redirect(302, '/integrations?error=shopify_oauth_failed');
	}

	const clientId = env.SHOPIFY_CLIENT_ID?.trim();
	const clientSecret = env.SHOPIFY_CLIENT_SECRET?.trim();
	if (!clientId || !clientSecret) {
		redirect(302, '/integrations?error=shopify_not_configured');
	}

	const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;

	// Exchange code for access token
	const tokenUrl = `https://${shopDomain}/admin/oauth/access_token`;
	const res = await fetch(tokenUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			client_id: clientId,
			client_secret: clientSecret,
			code
		})
	});

	if (!res.ok) {
		const text = await res.text();
		console.error('Shopify OAuth token exchange failed:', res.status, text);
		redirect(302, '/integrations?error=shopify_token_exchange_failed');
	}

	const data = (await res.json()) as { access_token?: string };
	const accessToken = data.access_token?.trim();
	if (!accessToken) {
		redirect(302, '/integrations?error=shopify_no_token');
	}

	const supabase = getSupabaseClient(event);
	
	// Get user's workspace_id
	const { data: profile } = await supabase
		.from('profiles')
		.select('workspace_id')
		.eq('user_id', event.locals.user.id)
		.single();

	if (!profile?.workspace_id) {
		redirect(302, '/integrations?error=workspace_not_found');
	}

	const { error } = await supabase.from('user_integrations').upsert(
		{
			user_id: event.locals.user.id,
			integration_type: 'shopify',
			config: {
				accessToken,
				shopDomain,
				apiVersion: '2024-04'
			},
			workspace_id: profile.workspace_id,
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'user_id,integration_type' }
	);

	if (error) {
		console.error('Shopify integration save error:', error);
		redirect(302, '/integrations?error=shopify_save_failed');
	}

	redirect(302, '/integrations?shopify=connected');
};
