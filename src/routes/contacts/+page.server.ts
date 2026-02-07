import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	const [widgetsRes, integrationsRes, llmKeysRes] = await Promise.all([
		fetch('/api/widgets'),
		fetch('/api/settings/integrations'),
		fetch('/api/settings/llm-keys')
	]);
	const widgetsData = await widgetsRes.json().catch(() => ({}));
	const integrationsData = await integrationsRes.json().catch(() => ({}));
	const llmKeysData = await llmKeysRes.json().catch(() => ({}));
	const widgets = Array.isArray(widgetsData.widgets) ? widgetsData.widgets : [];
	const shopifyConnected = Array.isArray(integrationsData.connected)
		? integrationsData.connected.includes('shopify')
		: false;
	const hasLlmKeys = Array.isArray(llmKeysData.providers) && llmKeysData.providers.length > 0;
	return { widgets, shopifyConnected, hasLlmKeys };
};
