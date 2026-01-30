/**
 * Direct LLM chat: call OpenAI, Anthropic, or Google with user's API key.
 * Used by POST /api/widgets/[id]/chat when chatBackend is 'direct'.
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function chatWithLlm(
	provider: string,
	model: string,
	apiKey: string,
	messages: ChatMessage[]
): Promise<string> {
	const trimmedKey = apiKey?.trim();
	if (!trimmedKey) throw new Error('Missing API key');

	if (provider === 'openai') {
		const openai = new OpenAI({ apiKey: trimmedKey });
		const res = await openai.chat.completions.create({
			model: model || 'gpt-4o-mini',
			messages: messages.map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
			max_tokens: 1024
		});
		const text = res.choices[0]?.message?.content;
		if (text == null) throw new Error('Empty OpenAI response');
		return text;
	}

	if (provider === 'anthropic') {
		const anthropic = new Anthropic({ apiKey: trimmedKey });
		const system = messages.find((m) => m.role === 'system')?.content ?? '';
		const chatMessages = messages.filter((m) => m.role !== 'system');
		const res = await anthropic.messages.create({
			model: model || 'claude-3-5-sonnet-20241022',
			max_tokens: 1024,
			system,
			messages: chatMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
		});
		const block = res.content.find((b) => b.type === 'text');
		if (!block || block.type !== 'text') throw new Error('Empty Anthropic response');
		return block.text;
	}

	if (provider === 'google') {
		const genAI = new GoogleGenerativeAI(trimmedKey);
		const systemPart = messages.find((m) => m.role === 'system')?.content;
		const nonSystem = messages.filter((m) => m.role !== 'system');
		// Use startChat with history so the model gets proper multi-turn context (user/assistant turns)
		const history = nonSystem.slice(0, -1).map((m) => ({
			role: m.role === 'assistant' ? 'model' : 'user',
			parts: [{ text: m.content }]
		}));
		const lastMessage = nonSystem.at(-1);
		const genModel = genAI.getGenerativeModel({
			model: model || 'gemini-2.5-flash',
			systemInstruction: systemPart || undefined
		});
		const chat = genModel.startChat({ history });
		const result = await chat.sendMessage(lastMessage?.content ?? '');
		const text = result.response.text();
		if (!text) throw new Error('Empty Google response');
		return text;
	}

	throw new Error(`Unsupported provider: ${provider}`);
}
