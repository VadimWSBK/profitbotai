/**
 * Webhook triggers: when the AI recognises user intent, call the trigger's webhook (e.g. n8n)
 * and use the result in the chat reply.
 */

import type { WebhookTrigger } from '$lib/widget-config';
import { chatWithLlm } from '$lib/chat-llm.server';

export type TriggerResult = {
	triggerId: string;
	triggerName: string;
	/** Text to inject into the LLM context (from webhook JSON result/output/data or raw body). */
	webhookResult: string;
};

/**
 * Classify user message against enabled triggers (one LLM call), then if a trigger matches,
 * POST to its webhook and return the result. Used by the chat endpoint before the main LLM reply.
 */
export async function getTriggerResultIfAny(
	triggers: WebhookTrigger[],
	userMessage: string,
	options: {
		llmProvider: string;
		llmModel: string;
		apiKey: string;
		sessionId: string;
		conversationId: string;
		widgetId: string;
	}
): Promise<TriggerResult | null> {
	const enabled = triggers.filter((t) => t.enabled && t.webhookUrl?.trim() && t.id?.trim());
	if (enabled.length === 0) return null;

	const triggerList = enabled
		.map((t) => `- ${t.id}: ${t.description}`)
		.join('\n');

	const systemPrompt = `You are a classifier. Given the user message and the list of triggers below, respond with ONLY the trigger id (the part before the colon) if the user's intent clearly matches that trigger. Otherwise respond with exactly: none

Triggers:
${triggerList}

Reply with only one word: the trigger id or "none". No explanation.`;

	const messages = [
		{ role: 'system' as const, content: systemPrompt },
		{ role: 'user' as const, content: `User message: ${userMessage}` }
	];

	let raw: string;
	try {
		raw = await chatWithLlm(options.llmProvider, options.llmModel, options.apiKey, messages);
	} catch {
		return null;
	}

	const chosen = raw.trim().toLowerCase().replace(/^trigger[_\s]*id[:\s]*/i, '').trim();
	if (!chosen || chosen === 'none') return null;

	const trigger = enabled.find((t) => t.id.toLowerCase() === chosen);
	if (!trigger) return null;

	const body = {
		message: userMessage,
		sessionId: options.sessionId,
		conversationId: options.conversationId,
		widgetId: options.widgetId,
		triggerId: trigger.id,
		triggerName: trigger.name
	};

	let res: Response;
	try {
		res = await fetch(trigger.webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(30_000)
		});
	} catch (e) {
		console.error('Trigger webhook fetch failed:', e);
		return null;
	}

	const text = await res.text();
	let resultStr: string;
	try {
		const parsed = JSON.parse(text) as Record<string, unknown>;
		// n8n often returns { result: "..." } or { output: "..." }
		if (typeof parsed.result === 'string' && parsed.result) resultStr = parsed.result;
		else if (typeof parsed.output === 'string' && parsed.output) resultStr = parsed.output;
		else if (typeof parsed.data === 'string' && parsed.data) resultStr = parsed.data;
		else resultStr = JSON.stringify(parsed);
	} catch {
		resultStr = text || '';
	}

	return {
		triggerId: trigger.id,
		triggerName: trigger.name,
		webhookResult: resultStr
	};
}
