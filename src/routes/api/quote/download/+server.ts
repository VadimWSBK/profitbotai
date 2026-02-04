/**
 * GET /api/quote/download?path=...
 * Redirects to a fresh signed URL for a roof_quotes file. Use this short link in chat
 * so the long signed URL is not truncated (which causes "signature verification failed").
 * path = fileName from quote generate (e.g. "conv-id/quote_Customer_20260204195252.pdf").
 */

import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';

const BUCKET = 'roof_quotes';

export const GET: RequestHandler = async (event) => {
	const path = event.url.searchParams.get('path')?.trim();
	if (!path) {
		return new Response('Missing path', { status: 400 });
	}
	// Prevent path traversal; allow only paths like "uuid/quote_*.pdf"
	if (path.includes('..') || !/^[a-f0-9-]+\/quote_[^/]+\.pdf$/i.test(path)) {
		return new Response('Invalid path', { status: 400 });
	}

	try {
		const admin = getSupabaseAdmin();
		const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600);
		if (error || !data?.signedUrl) {
			console.error('quote/download createSignedUrl:', error);
			return new Response('Quote not found or expired', { status: 404 });
		}
		redirect(302, data.signedUrl);
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && e.status === 302) throw e;
		console.error('GET /api/quote/download:', e);
		return new Response('Failed to generate download link', { status: 500 });
	}
};
