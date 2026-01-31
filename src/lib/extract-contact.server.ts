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

	const systemPrompt = `You extract contact information from user messages. Reply with a JSON object containing ONLY the fields the user clearly provided. Use exact keys: name, email, phone, address. Omit any key not provided. Example: {"email":"jane@example.com","phone":"+1 555 123 4567"}. If nothing looks like contact info, reply: {}. No other text.`;

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
		return out;
	} catch {
		return {};
	}
}
