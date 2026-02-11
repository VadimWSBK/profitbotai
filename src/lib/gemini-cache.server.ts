/**
 * Gemini explicit context caching: create and manage cached content for Chatwoot chatbot.
 * Cache holds static system instruction + tools. Dynamic content (RAG, pricing, contact) goes in the first user message.
 *
 * Constraints: when using cachedContent, you cannot send systemInstruction or tools in the generate request—they must be in the cache.
 */

import { GoogleGenAI } from '@google/genai';
import type { Tool } from 'ai';
import { asSchema } from '@ai-sdk/provider-utils';
import { z } from 'zod';

/** TTL for cached content: 1 hour. Caches auto-expire; we recreate when needed. */
const CACHE_TTL = '3600s';

/** In-memory cache of agentId -> cache name. Avoids recreating caches on every request. */
const agentCacheNames = new Map<
	string,
	{ name: string; expiresAt: number; staticHash: string }
>();
const CACHE_REUSE_MINUTES = 50; // Refresh before 1h TTL

type FunctionDeclaration = {
	name: string;
	description: string;
	parameters?: unknown;
	parametersJsonSchema?: unknown;
};

/** Check if value looks like a Zod schema */
function isZodSchema(v: unknown): boolean {
	return v != null && typeof v === 'object' && ('_zod' in v || 'def' in v);
}

/**
 * Convert AI SDK tools to Gemini functionDeclarations.
 * Uses asSchema jsonSchema when available; falls back to z.toJSONSchema for zod.
 */
async function toolsToGeminiFunctionDeclarationsAsync(
	tools: Record<string, Tool>,
	allowedNames?: string[]
): Promise<FunctionDeclaration[]> {
	const names = allowedNames ?? Object.keys(tools);
	const decls: FunctionDeclaration[] = [];
	for (const name of names) {
		const t = tools[name];
		if (!t || typeof t !== 'object') continue;
		const inputSchema = (t as { inputSchema?: unknown }).inputSchema;
		let paramsSchema: unknown;
		if (isZodSchema(inputSchema)) {
			try {
				paramsSchema = z.toJSONSchema(inputSchema, { target: 'openapi-3.0' });
			} catch {
				paramsSchema = { type: 'object', properties: {} };
			}
		} else {
			const schema = asSchema(inputSchema);
			const jsonSchema = schema.jsonSchema;
			const resolved = await Promise.resolve(jsonSchema);
			paramsSchema = resolved ?? { type: 'object', properties: {} };
		}
		decls.push({
			name,
			description: (t as { description?: string }).description ?? '',
			parametersJsonSchema: paramsSchema ?? { type: 'object', properties: {} }
		});
	}
	return decls;
}

export interface GetOrCreateAgentCacheParams {
	agentId: string;
	model: string;
	apiKey: string;
	/** Static system prompt: role, tone, instructions, hardcoded rules (no RAG, pricing, contact) */
	staticSystemPrompt: string;
	tools: Record<string, Tool>;
	allowedToolNames: string[];
}

/**
 * Get or create a Gemini cached content for an agent.
 * Returns cache name (e.g. cachedContents/xxx) or null on failure.
 */
export async function getOrCreateAgentCache({
	agentId,
	model,
	apiKey,
	staticSystemPrompt,
	tools,
	allowedToolNames
}: GetOrCreateAgentCacheParams): Promise<string | null> {
	const sortedNames = [...allowedToolNames].sort((a, b) => a.localeCompare(b));
	const staticHash = `${staticSystemPrompt.length}:${sortedNames.join(',')}`;
	const now = Date.now();
	const cached = agentCacheNames.get(agentId);
	if (cached?.staticHash === staticHash && cached.expiresAt > now) {
		return cached.name;
	}

	try {
		const ai = new GoogleGenAI({ apiKey });
		const functionDeclarations = await toolsToGeminiFunctionDeclarationsAsync(
			tools,
			allowedToolNames
		);
		if (functionDeclarations.length === 0) {
			return null;
		}

		const created = await ai.caches.create({
			model,
			config: {
				systemInstruction: { parts: [{ text: staticSystemPrompt }] },
				tools: [{ functionDeclarations }],
				ttl: CACHE_TTL,
				displayName: `profitbot-agent-${agentId}`
			}
		});

		const name = typeof created === 'object' && created?.name ? String(created.name) : null;
		if (!name) return null;

		agentCacheNames.set(agentId, {
			name,
			expiresAt: now + CACHE_REUSE_MINUTES * 60 * 1000,
			staticHash
		});
		return name;
	} catch (e) {
		console.error('[gemini-cache] create failed:', e);
		return null;
	}
}
