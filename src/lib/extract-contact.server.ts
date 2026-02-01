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

/** Regex-only extraction when LLM fails or as fallback for missing fields. */
function extractFromRegex(message: string): Partial<ExtractedContact> {
	const out: Partial<ExtractedContact> = {};
	// Email: standard pattern (e.g. user@domain.com)
	const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
	if (emailMatch) out.email = emailMatch[0].toLowerCase();
	// Roof size: "200 sqm", "400m2", "roof is 200", etc.
	const roofMatch =
		message.match(/(\d+(?:\.\d+)?)\s*(?:sqm|m2|m²|square\s*metre[s]?|sq\.?\s*metre[s]?|sq\.?\s*m\.?)/i) ??
		message.match(/roof\s*(?:is|size)?\s*:?\s*(\d+(?:\.\d+)?)/i);
	if (roofMatch) {
		const n = Number.parseFloat(roofMatch[1]);
		if (n >= 0) out.roofSize = n;
	}
	// Name: "my name is X", "I'm X", "name is X", "call me X" (single word or "First Last")
	const namePatterns = [
		/(?:my\s+name\s+is|i['']m|name\s+is|call\s+me|i\s+am)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
		/^(?:hi|hey|hello)[,\s]+([a-zA-Z]+)\b/i,
		/\b([A-Z][a-z]+)\s+(?:here|writing|asking)/i
	];
	for (const re of namePatterns) {
		const m = message.match(re);
		if (m?.[1]?.trim() && (m[1].length > 1 || /[a-zA-Z]/.test(m[1]))) {
			out.name = m[1].trim();
			break;
		}
	}
	return out;
}

/**
 * Use the LLM to extract any name, email, phone, or address from the user's message.
 * Returns only fields that were clearly provided. Runs quickly with a minimal prompt.
 * Falls back to regex extraction when LLM fails or misses obvious fields (e.g. email, roof size).
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
		// LLM failed: use regex fallback so quote flow can still work (email, roof size, name)
		return extractFromRegex(userMessage);
	}

	// Parse JSON from response (may be wrapped in markdown code block)
	const jsonMatch = /\{[\s\S]*\}/.exec(raw);
	let parsed: Record<string, unknown> = {};
	if (jsonMatch) {
		try {
			parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
		} catch {
			// ignore
		}
	}

	const regexFallback = extractFromRegex(userMessage);

	try {
		const out: ExtractedContact = {};
		if (typeof parsed.name === 'string' && parsed.name.trim())
			out.name = parsed.name.trim();
		else if (regexFallback.name) out.name = regexFallback.name;

		if (typeof parsed.email === 'string' && parsed.email.trim())
			out.email = parsed.email.trim().toLowerCase();
		else if (regexFallback.email) out.email = regexFallback.email;

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
				const numMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:sqm|m2|m²|square\s*metre|sq\.?\s*m\.?)?/i);
				if (numMatch) out.roofSize = Number.parseFloat(numMatch[1]);
			}
		}
		if (out.roofSize == null && regexFallback.roofSize != null && regexFallback.roofSize >= 0)
			out.roofSize = regexFallback.roofSize;

		return out;
	} catch {
		return regexFallback;
	}
}
