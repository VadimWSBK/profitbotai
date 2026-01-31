/**
 * Vercel AI SDK model factory: maps our provider + model + API key to an AI SDK LanguageModel.
 * Used by the streaming chat route so we can use streamText() and return toUIMessageStreamResponse().
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModelV3 } from '@ai-sdk/provider';

export function getAISdkModel(
	provider: string,
	modelId: string,
	apiKey: string
): LanguageModelV3 {
	const key = apiKey?.trim();
	if (!key) throw new Error('Missing API key');

	const providerLower = provider?.toLowerCase() ?? '';

	if (providerLower === 'openai') {
		const openai = createOpenAI({ apiKey: key });
		return openai(modelId || 'gpt-4o-mini');
	}

	if (providerLower === 'anthropic') {
		const anthropic = createAnthropic({ apiKey: key });
		return anthropic(modelId || 'claude-3-5-sonnet-20241022');
	}

	if (providerLower === 'google') {
		const google = createGoogleGenerativeAI({ apiKey: key });
		return google(modelId || 'gemini-2.5-flash');
	}

	throw new Error(`Unsupported provider: ${provider}`);
}
