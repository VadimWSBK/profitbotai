import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient, getSupabaseAdmin } from '$lib/supabase.server';

/**
 * GET /api/settings/mcp-keys – list MCP API keys for current user's workspace
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const supabase = getSupabaseClient(event);

		// Get user's workspace_id
		const { data: profile } = await supabase
			.from('profiles')
			.select('workspace_id')
			.eq('user_id', event.locals.user.id)
			.single();

		if (!profile?.workspace_id) {
			return json({ error: 'Workspace not found' }, { status: 404 });
		}

		const { data: keys, error } = await supabase
			.from('mcp_api_keys')
			.select('id, name, api_key, last_used_at, created_at')
			.eq('workspace_id', profile.workspace_id)
			.order('created_at', { ascending: false });

		if (error) {
			console.error('Error fetching MCP keys:', error);
			return json({ error: error.message }, { status: 500 });
		}

		// Mask API keys for security (show only last 8 chars)
		const maskedKeys = (keys ?? []).map((k) => ({
			id: k.id,
			name: k.name,
			apiKey: k.api_key ? `${k.api_key.substring(0, 15)}...${k.api_key.slice(-8)}` : null,
			fullApiKey: k.api_key, // Include full key only on creation
			lastUsedAt: k.last_used_at,
			createdAt: k.created_at,
		}));

		return json({ keys: maskedKeys });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to fetch MCP keys';
		console.error('GET /api/settings/mcp-keys:', e);
		return json({ error: msg }, { status: 500 });
	}
};

/**
 * POST /api/settings/mcp-keys – create a new MCP API key for current user's workspace
 * Body: { name?: string }
 */
export const POST: RequestHandler = async (event) => {
	if (!event.locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const supabase = getSupabaseClient(event);
		const admin = getSupabaseAdmin();

		// Get user's workspace_id
		const { data: profile } = await supabase
			.from('profiles')
			.select('workspace_id')
			.eq('user_id', event.locals.user.id)
			.single();

		if (!profile?.workspace_id) {
			return json({ error: 'Workspace not found' }, { status: 404 });
		}

		const body = await event.request.json().catch(() => ({}));
		const name = typeof body.name === 'string' ? body.name.trim() : null;

		// Generate API key using the function
		const { data: keyData, error: keyError } = await admin.rpc('generate_mcp_api_key');
		if (keyError || !keyData) {
			throw new Error('Failed to generate API key');
		}
		const apiKey = keyData as string;

		// Insert the key
		const { data, error } = await supabase
			.from('mcp_api_keys')
			.insert({
				workspace_id: profile.workspace_id,
				user_id: event.locals.user.id,
				api_key: apiKey,
				name: name || null,
			})
			.select('id, name, api_key, created_at')
			.single();

		if (error) {
			console.error('Error creating MCP key:', error);
			return json({ error: error.message }, { status: 500 });
		}

		return json(
			{
				key: {
					id: data.id,
					name: data.name,
					apiKey: data.api_key, // Return full key only on creation
					createdAt: data.created_at,
				},
			},
			{ status: 201 }
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to create MCP key';
		console.error('POST /api/settings/mcp-keys:', e);
		return json({ error: msg }, { status: 500 });
	}
};

