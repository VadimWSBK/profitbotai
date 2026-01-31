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

export type LlmTurn = { role: 'user' | 'assistant'; content: string };

export type TriggerContact = {
	name?: string | null;
	email?: string | null;
	phone?: string | null;
	address?: string | null;
};

export type TriggerExtracted = {
	roofSize?: number;
};

/**
 * Classify user message against enabled triggers (one LLM call), then if a trigger matches,
 * POST to its webhook and return the result. Used by the chat endpoint before the main LLM reply.
 * Pass conversationContext so multi-turn flows are recognized (e.g. user provides email+roof size
 * after bot asked for them — the current message alone may not match, but with context it does).
 * Pass contact and extracted so the webhook receives structured customer/project data for quote flows.
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
		/** Recent conversation turns before this message — helps classify multi-turn intents (e.g. quote flow). */
		conversationContext?: LlmTurn[];
		/** Merged contact (from DB + extracted) — included in webhook as customer/project for quote workflows. */
		contact?: TriggerContact | null;
		/** Extracted roof size etc. — included in webhook project.roofSize. */
		extracted?: TriggerExtracted | null;
	}
): Promise<TriggerResult | null> {
	const enabled = triggers.filter((t) => t.enabled && t.webhookUrl?.trim() && t.id?.trim());
	if (enabled.length === 0) return null;

	const triggerList = enabled
		.map((t) => `- ${t.id}: ${t.description}`)
		.join('\n');

	const systemPrompt = `You are a classifier. Given the conversation so far and the user's latest message, respond with ONLY the trigger id (the part before the colon) if the user's intent clearly matches that trigger — including when they are completing a multi-turn flow (e.g. providing email and roof size after being asked for a quote). Otherwise respond with exactly: none

Triggers:
${triggerList}

Reply with only one word: the trigger id or "none". No explanation.`;

	const contextLines =
		options.conversationContext && options.conversationContext.length > 0
			? options.conversationContext
					.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
					.join('\n')
			: '';
	const userPrompt =
		contextLines.length > 0
			? `Conversation so far:\n${contextLines}\n\nUser's latest message: ${userMessage}`
			: `User message: ${userMessage}`;

	const messages = [
		{ role: 'system' as const, content: systemPrompt },
		{ role: 'user' as const, content: userPrompt }
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

	// Build webhook body. Include customer + project for n8n quote workflows (matches
	// Shopify-style: customer.name/email/phone, project.roofSize/fullAddress). Also
	// provide a `body` object so n8n code using $('...').json.body gets the structure.
	const customer =
		options.contact &&
		(options.contact.name || options.contact.email || options.contact.phone)
			? {
					name: options.contact.name ?? undefined,
					email: options.contact.email ?? undefined,
					phone: options.contact.phone ?? undefined
				}
			: undefined;

	const project =
		options.extracted?.roofSize != null || options.contact?.address
			? {
					roofSize: options.extracted?.roofSize ?? undefined,
					fullAddress: options.contact?.address ?? undefined
				}
			: undefined;

	const bodyPayload: Record<string, unknown> = {
		message: userMessage,
		sessionId: options.sessionId,
		conversationId: options.conversationId,
		widgetId: options.widgetId,
		triggerId: trigger.id,
		triggerName: trigger.name
	};
	if (customer) bodyPayload.customer = customer;
	if (project) bodyPayload.project = project;
	// Body sub-object for n8n workflows that read $input.json.body (e.g. Shopify-style)
	if (customer || project) {
		bodyPayload.body = { customer: customer ?? {}, project: project ?? {} };
	}
	const body = bodyPayload;

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
