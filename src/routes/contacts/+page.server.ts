import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	const [widgetsRes, integrationsRes] = await Promise.all([
		fetch('/api/widgets'),
		fetch('/api/settings/integrations')
	]);
	const widgetsData = await widgetsRes.json().catch(() => ({}));
	const integrationsData = await integrationsRes.json().catch(() => ({}));
	const widgets = Array.isArray(widgetsData.widgets) ? widgetsData.widgets : [];
	const shopifyConnected = Array.isArray(integrationsData.connected)
		? integrationsData.connected.includes('shopify')
		: false;
	return { widgets, shopifyConnected };
};
