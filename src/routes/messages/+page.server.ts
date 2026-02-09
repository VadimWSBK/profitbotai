import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';

export const load: PageServerLoad = async ({ fetch }) => {
	const [widgetsRes, llmKeysRes] = await Promise.all([
		fetch('/api/widgets'),
		fetch('/api/settings/llm-keys')
	]);
	const widgetsData = await widgetsRes.json().catch(() => ({}));
	const llmKeysData = await llmKeysRes.json().catch(() => ({}));
	const widgets = Array.isArray(widgetsData.widgets) ? widgetsData.widgets : [];
	const hasLlmKeys = Array.isArray(llmKeysData.providers) && llmKeysData.providers.length > 0;
	return {
		widgets,
		hasLlmKeys,
		supabaseUrl: env.SUPABASE_URL ?? '',
		supabaseAnonKey: env.SUPABASE_ANON_KEY ?? ''
	};
};
