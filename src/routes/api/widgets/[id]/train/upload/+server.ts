import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEmbeddingKeyForWidget, ingestChunks } from '$lib/train-bot.server';
import { getSupabaseClient } from '$lib/supabase.server';

const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * POST /api/widgets/[id]/train/upload – upload a PDF; extract text, chunk, embed, store in widget_documents.
 */
export const POST: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	if (!widgetId) return json({ error: 'Missing widget id' }, { status: 400 });
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const supabase = getSupabaseClient(event);
	const embeddingKey = await getEmbeddingKeyForWidget(supabase, widgetId);
	if (!embeddingKey)
		return json({ error: 'Train Bot needs an API key. Add Google or OpenAI in Settings → LLM keys, or set GEMINI_API_KEY/OPENAI_API_KEY in .env.' }, { status: 503 });

	const formData = await event.request.formData().catch(() => null);
	if (!formData) return json({ error: 'Invalid form data' }, { status: 400 });

	const file = formData.get('file');
	if (!file || !(file instanceof File)) return json({ error: 'No file provided' }, { status: 400 });
	if (file.type !== 'application/pdf') return json({ error: 'Only PDF files are supported' }, { status: 400 });
	if (file.size > MAX_PDF_SIZE) return json({ error: 'PDF too large (max 10MB)' }, { status: 400 });

	try {
		const buffer = Buffer.from(await file.arrayBuffer());
		const pdfParse = (await import('pdf-parse')).default;
		const { text } = await pdfParse(buffer);
		if (!text?.trim()) return json({ error: 'No text could be extracted from the PDF' }, { status: 400 });

		const result = await ingestChunks(widgetId, text, {
			source: 'pdf',
			widget_id: widgetId,
			filename: file.name
		}, embeddingKey);
		if (result.error) return json({ error: result.error }, { status: 500 });
		return json({ ok: true, chunks: result.chunks });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Upload failed';
		console.error('POST /api/widgets/[id]/train/upload:', e);
		return json({ error: msg }, { status: 500 });
	}
};
