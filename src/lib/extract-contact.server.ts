/**
 * Extract contact info (name, email, phone, address) from user messages.
 * Used by the chat endpoint to automatically update the contacts table.
 */

import { chatWithLlm } from '$lib/chat-llm.server';
import type { LlmTurn } from '$lib/trigger-webhook.server';

export type ExtractedContact = {
	name?: string;
	email?: string;
	phone?: string;
	address?: string;
	/** Roof/project area in square metres (for quote triggers). */
	roofSize?: number;
};

/**
 * Use the LLM to extract any name, email, phone, or address from the user's message.
 * Returns only fields that were clearly provided. Runs quickly with a minimal prompt.
 */
export async function extractContactFromMessage(
	userMessage: string,
	options: {
		llmProvider: string;
		llmModel: string;
		apiKey: string;
		conversationContext?: LlmTurn[];
	}
): Promise<ExtractedContact> {
	const contextStr =
		options.conversationContext && options.conversationContext.length > 0
			? options.conversationContext
					.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
					.join('\n')
			: '';

	const systemPrompt = `You extract contact and project info from user messages. Reply with a JSON object containing ONLY the fields the user clearly provided. Use exact keys: name, email, phone, address, roofSize. roofSize is a number (square metres) when the user gives roof/area size (e.g. "400 sqm", "400m2", "square metre is 400"). Omit any key not provided. Example: {"email":"jane@example.com","roofSize":400}. If nothing relevant, reply: {}. No other text.`;

	const userPrompt =
		contextStr.length > 0
			? `Conversation:\n${contextStr}\n\nLatest user message (extract from here): ${userMessage}`
			: `User message: ${userMessage}`;

	const messages = [
		{ role: 'system' as const, content: systemPrompt },
		{ role: 'user' as const, content: userPrompt }
	];

	let raw: string;
	try {
		raw = await chatWithLlm(
			options.llmProvider,
			options.llmModel,
			options.apiKey,
			messages
		);
	} catch {
		return {};
	}

	// Parse JSON from response (may be wrapped in markdown code block)
	const jsonMatch = /\{[\s\S]*\}/.exec(raw);
	if (!jsonMatch) return {};
	try {
		const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
		const out: ExtractedContact = {};
		if (typeof parsed.name === 'string' && parsed.name.trim())
			out.name = parsed.name.trim();
		if (typeof parsed.email === 'string' && parsed.email.trim())
			out.email = parsed.email.trim().toLowerCase();
		if (typeof parsed.phone === 'string' && parsed.phone.trim())
			out.phone = parsed.phone.trim();
		if (typeof parsed.address === 'string' && parsed.address.trim())
			out.address = parsed.address.trim();
		const roof = parsed.roofSize;
		if (typeof roof === 'number' && roof >= 0) out.roofSize = roof;
		else if (typeof roof === 'string') {
			const trimmed = roof.trim();
			if (/^\d+(\.\d+)?$/.test(trimmed)) out.roofSize = Number.parseFloat(trimmed);
			else {
				// Parse "200 sqm", "200m2", "200 m²", "roof is 200 sqm" etc.
				const numMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:sqm|m2|m²|square\s*metre|sq\.?\s*m\.?)?/i);
				if (numMatch) out.roofSize = Number.parseFloat(numMatch[1]);
			}
		}
		return out;
	} catch {
		return {};
	}
}
