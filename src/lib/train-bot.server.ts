/**
 * Train Bot: chunk text, generate embeddings (OpenAI or Gemini), store in Supabase widget_documents.
 * n8n can use the same Supabase project and "Retrieve documents for AI Agent as Tool" for RAG.
 * PDF text extraction uses pdf-parse v2 (PDFParse + getText); web scraping uses fetch + cheerio.
 *
 * Embedding API key (priority): env OPENAI_API_KEY/GEMINI_API_KEY → widget owner's LLM key from Settings.
 * Uses the same key source as the chatbot, so if chat works with your Gemini key, Train Bot will too.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { getSupabaseAdmin } from '$lib/supabase.server';
import { env } from '$env/dynamic/private';


const EMBEDDING_MODEL = 'text-embedding-3-small';
const GEMINI_EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIMENSION = 3072; // Supabase vector(3072); matches n8n gemini-embedding-001 default (no index due to pgvector 2000-dim limit)
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

export type EmbeddingKey = { provider: 'openai' | 'google'; key: string };

/**
 * Resolve embedding API key: env vars first, then widget owner's stored LLM key (Settings → LLM keys).
 * Uses the same key as the chatbot, so if chat works, Train Bot will too.
 */
export async function getEmbeddingKeyForWidget(
	supabase: SupabaseClient,
	widgetId: string
): Promise<EmbeddingKey | null> {
	if (env.OPENAI_API_KEY?.trim()) return { provider: 'openai', key: env.OPENAI_API_KEY.trim() };
	if (env.GEMINI_API_KEY?.trim()) return { provider: 'google', key: env.GEMINI_API_KEY.trim() };
	const { data: googleKey } = await supabase.rpc('get_owner_llm_key_for_chat', {
		p_widget_id: widgetId,
		p_provider: 'google'
	});
	if (googleKey?.trim()) return { provider: 'google', key: googleKey.trim() };
	const { data: openaiKey } = await supabase.rpc('get_owner_llm_key_for_chat', {
		p_widget_id: widgetId,
		p_provider: 'openai'
	});
	if (openaiKey?.trim()) return { provider: 'openai', key: openaiKey.trim() };
	return null;
}

export async function isTrainBotConfigured(supabase: SupabaseClient, widgetId: string): Promise<boolean> {
	if (env.OPENAI_API_KEY || env.GEMINI_API_KEY) return true;
	const key = await getEmbeddingKeyForWidget(supabase, widgetId);
	return key != null;
}

/**
 * Resolve embedding API key for an agent: env vars first, then agent owner's (created_by) LLM key.
 */
export async function getEmbeddingKeyForAgent(agentId: string): Promise<EmbeddingKey | null> {
	if (env.OPENAI_API_KEY?.trim()) return { provider: 'openai', key: env.OPENAI_API_KEY.trim() };
	if (env.GEMINI_API_KEY?.trim()) return { provider: 'google', key: env.GEMINI_API_KEY.trim() };
	const admin = getSupabaseAdmin();
	const { data: agent, error: agentErr } = await admin.from('agents').select('created_by').eq('id', agentId).single();
	if (agentErr || !agent?.created_by) return null;
	const { data: keys } = await admin.from('user_llm_keys').select('provider, api_key').eq('user_id', agent.created_by).in('provider', ['google', 'openai']);
	if (!keys?.length) return null;
	const google = keys.find((k) => k.provider === 'google');
	if (google?.api_key?.trim()) return { provider: 'google', key: google.api_key.trim() };
	const openai = keys.find((k) => k.provider === 'openai');
	if (openai?.api_key?.trim()) return { provider: 'openai', key: openai.api_key.trim() };
	return null;
}

export async function isAgentTrainConfigured(agentId: string): Promise<boolean> {
	if (env.OPENAI_API_KEY || env.GEMINI_API_KEY) return true;
	const key = await getEmbeddingKeyForAgent(agentId);
	return key != null;
}

export type AgentIngestMetadata = {
	source: 'pdf' | 'url';
	agent_id: string;
	filename?: string;
	url?: string;
};

/** Chunk text, embed, and insert into agent_documents. */
export async function ingestChunksForAgent(
	agentId: string,
	text: string,
	metadata: AgentIngestMetadata,
	embeddingKey: EmbeddingKey
): Promise<{ chunks: number; error?: string }> {
	const chunks = chunkText(text);
	if (chunks.length === 0) return { chunks: 0 };

	const embeddings = await getEmbeddings(chunks, embeddingKey);
	const supabase = getSupabaseAdmin();

	const rows = chunks.map((content, i) => ({
		agent_id: agentId,
		content,
		embedding: embeddings[i] ?? [],
		metadata: { ...metadata, agent_id: agentId }
	}));

	const { error } = await supabase.from('agent_documents').insert(rows);
	if (error) {
		console.error('agent_documents insert error:', error);
		return { chunks: chunks.length, error: error.message };
	}
	return { chunks: chunks.length };
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

/** Get embeddings via OpenAI (text-embedding-3-small, 768 dims to match Supabase). */
async function getEmbeddingsOpenAI(texts: string[], apiKey: string): Promise<number[][]> {
	const client = new OpenAI({ apiKey });
	const batchSize = 20;
	const out: number[][] = [];
	for (let i = 0; i < texts.length; i += batchSize) {
		const batch = texts.slice(i, i + batchSize);
		const res = await client.embeddings.create({
			model: EMBEDDING_MODEL,
			input: batch,
			dimensions: EMBED_DIMENSION
		});
		const order = res.data.toSorted((a, b) => (a.index ?? 0) - (b.index ?? 0));
		for (const item of order) {
			if (item.embedding) out.push(item.embedding);
		}
	}
	return out;
}

/** Get embeddings via Gemini API (gemini-embedding-001, 3072 dims default, RETRIEVAL_DOCUMENT, normalized). */
async function getEmbeddingsGemini(texts: string[], apiKey: string): Promise<number[][]> {
	const batchSize = 20;
	const out: number[][] = [];
	const base = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent`;
	for (let i = 0; i < texts.length; i += batchSize) {
		const batch = texts.slice(i, i + batchSize);
		// Gemini REST embedContent accepts one content per request; batch with multiple requests
		const promises = batch.map((text) =>
			fetch(`${base}?key=${encodeURIComponent(apiKey)}`, {
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
			const values = data?.embedding?.values ?? [];
			if (values.length !== EMBED_DIMENSION)
				throw new Error('Gemini embedding missing or wrong dimension');
			out.push(normalizeL2(values));
		}
	}
	return out;
}

/** Get embeddings using the given key. Exported for agent rules RAG. */
export async function getEmbeddings(texts: string[], embeddingKey: EmbeddingKey): Promise<number[][]> {
	if (embeddingKey.provider === 'openai') return getEmbeddingsOpenAI(texts, embeddingKey.key);
	return getEmbeddingsGemini(texts, embeddingKey.key);
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
	metadata: IngestMetadata,
	embeddingKey: EmbeddingKey
): Promise<{ chunks: number; error?: string }> {
	const chunks = chunkText(text);
	if (chunks.length === 0) return { chunks: 0 };

	const embeddings = await getEmbeddings(chunks, embeddingKey);
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
