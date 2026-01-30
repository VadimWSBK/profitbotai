/**
 * LLM providers and models for Direct LLM (no n8n).
 * Used in Settings (API keys) and Connect tab (model selection).
 */

export const LLM_PROVIDERS = [
	{ id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
	{ id: 'anthropic', name: 'Anthropic', models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'] },
	{ id: 'google', name: 'Google (Gemini)', models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'] }
] as const;

export type LlmProviderId = (typeof LLM_PROVIDERS)[number]['id'];

export function getProvider(id: string) {
	return LLM_PROVIDERS.find((p) => p.id === id);
}

export function getModels(providerId: string): string[] {
	return getProvider(providerId)?.models ?? [];
}
