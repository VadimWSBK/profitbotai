/**
 * n8n API client – connect your dashboard to n8n workflows.
 *
 * Use from SvelteKit server routes (+server.ts, +page.server.ts) with env from $env/static/private:
 *   import { N8N_BASE_URL, N8N_API_KEY } from '$env/static/private';
 *   const data = await callN8nWebhook(N8N_BASE_URL, N8N_API_KEY, '/webhook/widgets');
 */

export async function callN8nWebhook<T = unknown>(
	baseUrl: string,
	apiKey: string,
	path: string,
	options: RequestInit = {}
): Promise<T> {
	if (!baseUrl) {
		throw new Error('N8N_BASE_URL is not set');
	}
	const base = baseUrl.replace(/\/$/, '');
	const pathNorm = path.startsWith('/') ? path : `/${path}`;
	const url = `${base}${pathNorm}`;
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...(options.headers as Record<string, string>)
	};
	if (apiKey) {
		headers['X-N8N-API-KEY'] = apiKey;
	}
	const res = await fetch(url, { ...options, headers });
	if (!res.ok) {
		throw new Error(`n8n request failed: ${res.status} ${res.statusText}`);
	}
	return res.json() as Promise<T>;
}
