import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callN8nWebhook } from '$lib/n8n';
import { env } from '$env/dynamic/private';

type Widget = { id: string; name: string; tags: string[]; createdAt: string };

/**
 * GET /api/widgets – list widgets.
 * If N8N_BASE_URL is set, fetches from n8n webhook /webhook/widgets.
 * Otherwise returns sample data.
 */
export const GET: RequestHandler = async () => {
	const baseUrl = env.N8N_BASE_URL;
	const apiKey = env.N8N_API_KEY ?? '';
	if (baseUrl) {
		try {
			const data = await callN8nWebhook<{ widgets: Widget[] }>(
				baseUrl,
				apiKey,
				'/webhook/widgets'
			);
			return json(data);
		} catch (e) {
			console.error('n8n widgets fetch failed:', e);
			return json(
				{ widgets: getSampleWidgets(), _fallback: true },
				{ status: 200 }
			);
		}
	}
	return json({ widgets: getSampleWidgets() });
};

function getSampleWidgets(): Widget[] {
	return [
		{
			id: '1',
			name: 'NetZero Coating',
			tags: ['Standalone', 'Popup'],
			createdAt: '30th Jan, 2026'
		}
	];
}
