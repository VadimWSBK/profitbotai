/**
 * Train Bot: chunk text, generate embeddings (OpenAI or Gemini), store in Supabase widget_documents.
 * n8n can use the same Supabase project and "Retrieve documents for AI Agent as Tool" for RAG.
 * PDF text extraction uses pdf-parse; web scraping uses fetch + cheerio. Either OPENAI_API_KEY or
 * GEMINI_API_KEY enables Train Bot (embeddings). Gemini uses output_dimensionality 1536 to match
 * the existing Supabase vector(1536) column.
 */

import OpenAI from 'openai';
import { getSupabaseAdmin } from '$lib/supabase.server';
import { env } from '$env/dynamic/private';

const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

const EMBEDDING_MODEL = 'text-embedding-3-small';
const GEMINI_EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIMENSION = 1536; // Supabase widget_documents.embedding vector(1536)
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

export function isTrainBotConfigured(): boolean {
	return Boolean(env.OPENAI_API_KEY || env.GEMINI_API_KEY);
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

/** L2-normalize a vector (required for Gemini 1536/768 for cosine similarity). */
function normalizeL2(vec: number[]): number[] {
	const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
	if (norm === 0) return vec;
	return vec.map((x) => x / norm);
}

/** Get embeddings via OpenAI (text-embedding-3-small, 1536 dims). */
async function getEmbeddingsOpenAI(texts: string[]): Promise<number[][]> {
	if (!openai) throw new Error('OPENAI_API_KEY is not set.');
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

/** Get embeddings via Gemini API (gemini-embedding-001, 1536 dims, RETRIEVAL_DOCUMENT, normalized). */
async function getEmbeddingsGemini(texts: string[]): Promise<number[][]> {
	const key = env.GEMINI_API_KEY;
	if (!key) throw new Error('GEMINI_API_KEY is not set.');
	const batchSize = 20;
	const out: number[][] = [];
	const base = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent`;
	for (let i = 0; i < texts.length; i += batchSize) {
		const batch = texts.slice(i, i + batchSize);
		// Gemini REST embedContent accepts one content per request; batch with multiple requests
		const promises = batch.map((text) =>
			fetch(`${base}?key=${encodeURIComponent(key)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					content: { parts: [{ text }] },
					output_dimensionality: EMBED_DIMENSION,
					task_type: 'RETRIEVAL_DOCUMENT'
				})
			})
		);
		const responses = await Promise.all(promises);
		for (const res of responses) {
			if (!res.ok) {
				const err = await res.text();
				throw new Error(`Gemini embed failed: ${res.status} ${err}`);
			}
			const data = (await res.json()) as { embedding?: { values?: number[] } };
			const values = data?.embedding?.values;
			if (!values || values.length !== EMBED_DIMENSION)
				throw new Error('Gemini embedding missing or wrong dimension');
			out.push(normalizeL2(values));
		}
	}
	return out;
}

/** Get embeddings (OpenAI if OPENAI_API_KEY set, else Gemini if GEMINI_API_KEY set). */
async function getEmbeddings(texts: string[]): Promise<number[][]> {
	if (env.OPENAI_API_KEY) return getEmbeddingsOpenAI(texts);
	if (env.GEMINI_API_KEY) return getEmbeddingsGemini(texts);
	throw new Error('Add OPENAI_API_KEY or GEMINI_API_KEY to .env to enable Train Bot.');
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
