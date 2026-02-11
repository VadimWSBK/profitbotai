/**
 * Generate text using Gemini explicit context cache.
 * Uses @google/genai directly (not AI SDK) because cachedContent cannot be sent with systemInstruction/tools in the same request.
 * Implements multi-step tool loop: generateContent → execute functionCalls → append functionResponse → repeat.
 */

import { GoogleGenAI } from '@google/genai';
import type { Content } from '@google/genai';
import type { Tool } from 'ai';
import type { AgentToolContextMinimal } from '$lib/agent-tools.server';

export interface GenerateWithCacheParams {
	cacheName: string;
	model: string;
	apiKey: string;
	/** Messages: first user message should include dynamic context (RAG, pricing, contact). */
	messages: { role: 'user' | 'assistant'; content: string }[];
	tools: Record<string, Tool>;
	agentContext: AgentToolContextMinimal;
	maxSteps?: number;
	maxOutputTokens?: number;
}

/**
 * Convert messages to Gemini Content[] format.
 * User messages → { role: 'user', parts: [{ text }] }
 * Assistant messages → { role: 'model', parts: [{ text }] }
 */
function messagesToContents(messages: { role: 'user' | 'assistant'; content: string }[]): Content[] {
	return messages.map((m) => ({
		role: m.role === 'assistant' ? 'model' : 'user',
		parts: [{ text: m.content }]
	}));
}

/**
 * Generate with explicit context cache. Returns final text and tool outputs for quote/DIY extraction.
 */
export async function generateWithCache({
	cacheName,
	model,
	apiKey,
	messages,
	tools,
	agentContext,
	maxSteps = 5,
	maxOutputTokens = 2048
}: GenerateWithCacheParams): Promise<{
	text: string;
	toolResults: Array<{ toolName: string; output: unknown }>;
}> {
	const ai = new GoogleGenAI({ apiKey });
	let contents: Content[] = messagesToContents(messages);
	const toolResults: Array<{ toolName: string; output: unknown }> = [];
	let lastText = '';

	for (let step = 0; step < maxSteps; step++) {
		const response = await ai.models.generateContent({
			model,
			contents,
			config: {
				cachedContent: cacheName,
				maxOutputTokens,
				toolConfig: {
					functionCallingConfig: { mode: 'AUTO' as const }
				}
			}
		});

		const fc = response.functionCalls;
		if (fc && fc.length > 0) {
			// Model wants to call tools. Execute each and append model + user turns.
			const modelParts = fc.map((call) => ({
				functionCall: {
					name: call.name ?? '',
					args: call.args ?? {}
				}
			}));
			contents = [...contents, { role: 'model', parts: modelParts }];

			const functionResponseParts: Array<{ functionResponse: { name: string; response: Record<string, unknown> } }> = [];
			for (const call of fc) {
				const name = call.name ?? '';
				const args = (call.args ?? {}) as Record<string, unknown>;
				const t = tools[name];
				let output: unknown;
				if (t?.execute) {
					try {
						output = await (t.execute as (args: unknown, opts: { experimental_context?: unknown }) => Promise<unknown>)(
							args,
							{ experimental_context: agentContext }
						);
					} catch (e) {
						output = { error: e instanceof Error ? e.message : 'Tool execution failed' };
					}
				} else {
					output = { error: `Unknown tool: ${name}` };
				}
				toolResults.push({ toolName: name, output });
				// Gemini expects response.output or response.error
				const responsePayload: Record<string, unknown> =
					typeof output === 'object' && output !== null
						? (output as Record<string, unknown>)
						: { output };
				if (responsePayload.error !== undefined && responsePayload.error !== null) {
					const errStr =
						typeof responsePayload.error === 'string'
							? responsePayload.error
							: JSON.stringify(responsePayload.error);
					functionResponseParts.push({
						functionResponse: { name, response: { error: errStr } }
					});
				} else {
					functionResponseParts.push({
						functionResponse: { name, response: responsePayload }
					});
				}
			}
			contents = [
				...contents,
				{
					role: 'user',
					parts: functionResponseParts
				}
			];
			continue;
		}

		// No function calls – we have a text response.
		lastText = response.text ?? '';
		break;
	}

	return { text: lastText, toolResults };
}
