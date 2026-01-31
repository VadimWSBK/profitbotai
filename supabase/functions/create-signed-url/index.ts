import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key'
};

Deno.serve(async (req) => {
	// Handle CORS preflight
	if (req.method === 'OPTIONS') {
		return new Response('ok', { headers: corsHeaders });
	}

	try {
		// Require POST
		if (req.method !== 'POST') {
			return new Response(
				JSON.stringify({ error: 'Method not allowed' }),
				{ status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
			);
		}

		// Optional: require X-API-Key for server-to-server (e.g. n8n)
		const apiKey = req.headers.get('X-API-Key');
		const expectedKey = Deno.env.get('SIGNED_URL_SECRET');
		if (expectedKey && apiKey !== expectedKey) {
			return new Response(
				JSON.stringify({ error: 'Invalid or missing X-API-Key' }),
				{ status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
			);
		}

		const body = await req.json();
		let filePath = typeof body?.filePath === 'string' ? body.filePath.trim() : '';
		if (!filePath) {
			return new Response(
				JSON.stringify({ error: 'Missing filePath' }),
				{ status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
			);
		}

		// Accept full Key (roof_quotes/path) or path within bucket
		if (filePath.startsWith('roof_quotes/')) {
			filePath = filePath.slice(12);
		}

		const expiresIn = typeof body?.expiresIn === 'number' ? body.expiresIn : 86400;

		const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
		const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
		const supabase = createClient(supabaseUrl, supabaseServiceKey);

		const { data, error } = await supabase.storage
			.from('roof_quotes')
			.createSignedUrl(filePath, expiresIn);

		if (error) {
			console.error('createSignedUrl:', error);
			return new Response(
				JSON.stringify({ error: error.message }),
				{ status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
			);
		}

		return new Response(
			JSON.stringify({ signedUrl: data.signedUrl }),
			{ status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to create signed URL';
		console.error('create-signed-url:', e);
		return new Response(
			JSON.stringify({ error: msg }),
			{ status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
		);
	}
});
