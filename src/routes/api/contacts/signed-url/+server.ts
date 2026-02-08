import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';

/**
 * POST /api/contacts/signed-url
 * Body: { filePath: string, expiresIn?: number }
 * Returns a signed URL for a private file in roof_quotes bucket.
 * Used by chat bot to share quote links with users.
 */
export const POST: RequestHandler = async (event) => {
	let body: { filePath?: string; expiresIn?: number };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	let filePath = typeof body?.filePath === 'string' ? body.filePath.trim() : '';
	if (!filePath) return json({ error: 'Missing filePath' }, { status: 400 });
	// Accept full Key (roof_quotes/path) or path within bucket
	if (filePath.startsWith('roof_quotes/')) filePath = filePath.slice(12);

	const expiresIn = typeof body?.expiresIn === 'number' ? body.expiresIn : 31536000; // 1 year default

	try {
		const supabase = getSupabaseAdmin();
		const { data, error } = await supabase.storage
			.from('roof_quotes')
			.createSignedUrl(filePath, expiresIn);

		if (error) {
			console.error('createSignedUrl:', error);
			return json({ error: error.message }, { status: 500 });
		}
		return json({ signedUrl: data.signedUrl });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to create signed URL';
		console.error('POST /api/contacts/signed-url:', e);
		return json({ error: msg }, { status: 500 });
	}
};
