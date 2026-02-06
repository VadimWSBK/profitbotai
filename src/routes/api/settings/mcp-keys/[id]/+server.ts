import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * DELETE /api/settings/mcp-keys/[id] – delete an MCP API key
 */
export const DELETE: RequestHandler = async (event) => {
	if (!event.locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const keyId = event.params.id;
	if (!keyId) {
		return json({ error: 'Missing key id' }, { status: 400 });
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

		const { error } = await supabase
			.from('mcp_api_keys')
			.delete()
			.eq('id', keyId)
			.eq('workspace_id', profile.workspace_id);

		if (error) {
			console.error('Error deleting MCP key:', error);
			return json({ error: error.message }, { status: 500 });
		}

		return json({ success: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to delete MCP key';
		console.error('DELETE /api/settings/mcp-keys/[id]:', e);
		return json({ error: msg }, { status: 500 });
	}
};
