/**
 * Train Bot: chunk text, generate embeddings (OpenAI), store in Supabase widget_documents.
 * n8n can use the same Supabase project and "Retrieve documents for AI Agent as Tool" for RAG.
 */

import OpenAI from 'openai';
import { getSupabaseAdmin } from '$lib/supabase.server';
import { env } from '$env/dynamic/private';

const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

const EMBEDDING_MODEL = 'text-embedding-3-small';
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

export function isTrainBotConfigured(): boolean {
	return Boolean(env.OPENAI_API_KEY);
}

/** Split text into overlapping chunks for embedding. */
export function chunkText(text: string): string[] {
	const chunks: string[] = [];
	let start = 0;
	const cleaned = text.replaceAll(/\s+/g, ' ').trim();
	if (!cleaned.length) return chunks;
	while (start < cleaned.length) {
		const end = Math.min(start + CHUNK_SIZE, cleaned.length);
		let slice = cleaned.slice(start, end);
		// Prefer breaking at sentence or word boundary
		if (end < cleaned.length) {
			const lastPeriod = slice.lastIndexOf('. ');
			const lastSpace = slice.lastIndexOf(' ');
			let breakAt = slice.length;
			if (lastPeriod >= CHUNK_SIZE / 2) breakAt = lastPeriod + 1;
			else if (lastSpace >= 0) breakAt = lastSpace + 1;
			slice = slice.slice(0, breakAt);
			start += breakAt;
			// Overlap: move start back so next chunk overlaps
			start = Math.max(0, start - CHUNK_OVERLAP);
		} else {
			start = cleaned.length;
		}
		if (slice.trim().length) chunks.push(slice.trim());
	}
	return chunks;
}

/** Get embeddings for multiple texts (batches of 20 to respect rate limits). */
async function getEmbeddings(texts: string[]): Promise<number[][]> {
	if (!openai) throw new Error('OPENAI_API_KEY is not set. Add it in .env to use Train Bot.');
	const batchSize = 20;
	const out: number[][] = [];
	for (let i = 0; i < texts.length; i += batchSize) {
		const batch = texts.slice(i, i + batchSize);
		const res = await openai.embeddings.create({
			model: EMBEDDING_MODEL,
			input: batch
		});
		const order = res.data.toSorted((a, b) => (a.index ?? 0) - (b.index ?? 0));
		for (const item of order) {
			if (item.embedding) out.push(item.embedding);
		}
	}
	return out;
}

export type IngestMetadata = {
	source: 'pdf' | 'url';
	widget_id: string;
	filename?: string;
	url?: string;
};

/** Chunk text, embed, and insert into widget_documents. */
export async function ingestChunks(
	widgetId: string,
	text: string,
	metadata: IngestMetadata
): Promise<{ chunks: number; error?: string }> {
	const chunks = chunkText(text);
	if (chunks.length === 0) return { chunks: 0 };

	const embeddings = await getEmbeddings(chunks);
	const supabase = getSupabaseAdmin();

	const rows = chunks.map((content, i) => ({
		widget_id: widgetId,
		content,
		embedding: embeddings[i] ?? [],
		metadata: { ...metadata, widget_id: widgetId }
	}));

	const { error } = await supabase.from('widget_documents').insert(rows);
	if (error) {
		console.error('widget_documents insert error:', error);
		return { chunks: chunks.length, error: error.message };
	}
	return { chunks: chunks.length };
}
