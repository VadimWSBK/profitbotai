/**
 * Resolve roof_quotes storage paths to signed URLs for display.
 * pdf_quotes in DB store paths (e.g. "conv-id/quote_name_ts.pdf"); private bucket requires signed URLs.
 */

import { getSupabaseAdmin } from '$lib/supabase.server';

export type PdfQuoteResolved = { url: string; created_at?: string; total?: string };

/**
 * Resolve pdf_quotes array (paths or { url, created_at?, total? }) to signed URLs for the roof_quotes bucket.
 */
export async function resolvePdfQuotesToSignedUrls(pdf_quotes: unknown): Promise<PdfQuoteResolved[]> {
	const result: PdfQuoteResolved[] = [];
	if (!Array.isArray(pdf_quotes)) return result;
	const admin = getSupabaseAdmin();
	for (const q of pdf_quotes) {
		const stored = typeof q === 'object' && q !== null && 'url' in q ? (q as { url: string }).url : String(q);
		// Path may be stored as "roof_quotes/..." or just "conv-id/file.pdf"
		const pathMatch = /roof_quotes\/(.+)$/.exec(stored);
		const filePath = pathMatch?.[1] ?? stored.trim();
		const created_at =
			typeof q === 'object' && q !== null && 'created_at' in q ? (q as { created_at?: string }).created_at : undefined;
		const total =
			typeof q === 'object' && q !== null && 'total' in q ? (q as { total?: string }).total : undefined;
		if (!filePath || filePath.startsWith('http')) {
			result.push({ url: stored, created_at, total });
			continue;
		}
		const { data } = await admin.storage.from('roof_quotes').createSignedUrl(filePath, 3600);
		if (data?.signedUrl) {
			result.push({ url: data.signedUrl, created_at, total });
		} else {
			result.push({ url: stored, created_at, total });
		}
	}
	return result;
}
