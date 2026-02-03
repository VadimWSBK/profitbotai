import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEmbeddingKeyForAgent, ingestChunksForAgent } from '$lib/train-bot.server';

const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * POST /api/agents/[id]/train/upload – upload a PDF; extract text, chunk, embed, store in agent_documents.
 */
export const POST: RequestHandler = async (event) => {
	const agentId = event.params.id;
	if (!agentId) return json({ error: 'Missing agent id' }, { status: 400 });
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const embeddingKey = await getEmbeddingKeyForAgent(agentId);
	if (!embeddingKey)
		return json({ error: 'Train needs an API key. Add Google or OpenAI in Settings → LLM keys, or set GEMINI_API_KEY/OPENAI_API_KEY in .env.' }, { status: 503 });

	const formData = await event.request.formData().catch(() => null);
	if (!formData) return json({ error: 'Invalid form data' }, { status: 400 });

	const file = formData.get('file');
	if (!file || !(file instanceof File)) return json({ error: 'No file provided' }, { status: 400 });
	if (file.type !== 'application/pdf') return json({ error: 'Only PDF files are supported' }, { status: 400 });
	if (file.size > MAX_PDF_SIZE) return json({ error: 'PDF too large (max 10MB)' }, { status: 400 });

	try {
		const buffer = Buffer.from(await file.arrayBuffer());
		const { PDFParse } = await import('pdf-parse');
		const parser = new PDFParse({ data: new Uint8Array(buffer) });
		const parseResult = await parser.getText();
		await parser.destroy();
		const text = parseResult?.text ?? '';
		if (!text?.trim()) return json({ error: 'No text could be extracted from the PDF' }, { status: 400 });

		const ingestResult = await ingestChunksForAgent(agentId, text, {
			source: 'pdf',
			agent_id: agentId,
			filename: file.name
		}, embeddingKey);
		if (ingestResult.error) return json({ error: ingestResult.error }, { status: 500 });
		return json({ ok: true, chunks: ingestResult.chunks });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Upload failed';
		console.error('POST /api/agents/[id]/train/upload:', e);
		return json({ error: msg }, { status: 500 });
	}
};
