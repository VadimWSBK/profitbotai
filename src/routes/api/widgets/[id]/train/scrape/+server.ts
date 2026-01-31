import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ingestChunks, isTrainBotConfigured } from '$lib/train-bot.server';
import * as cheerio from 'cheerio';

/**
 * POST /api/widgets/[id]/train/scrape – scrape a URL; extract text, chunk, embed, store in widget_documents.
 * Body: { url: string }
 */
export const POST: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	if (!widgetId) return json({ error: 'Missing widget id' }, { status: 400 });
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!isTrainBotConfigured())
		return json({ error: 'Train Bot is not configured. Set OPENAI_API_KEY or GEMINI_API_KEY in .env.' }, { status: 503 });

	let body: { url?: string };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const rawUrl = body?.url;
	if (typeof rawUrl !== 'string' || !rawUrl.trim()) return json({ error: 'Missing or invalid url' }, { status: 400 });

	let url: URL;
	try {
		url = new URL(rawUrl.trim());
	} catch {
		return json({ error: 'Invalid URL' }, { status: 400 });
	}
	if (!['http:', 'https:'].includes(url.protocol)) return json({ error: 'URL must be http or https' }, { status: 400 });

	try {
		const res = await fetch(url.toString(), {
			headers: { 'User-Agent': 'ProfitBot-TrainBot/1.0 (https://profitbot.ai)' },
			redirect: 'follow'
		});
		if (!res.ok) return json({ error: `Failed to fetch: ${res.status}` }, { status: 400 });
		const html = await res.text();
		const $ = cheerio.load(html);
		$('script, style, nav, header, footer, aside, form').remove();
		const text = $('body').text().replaceAll(/\s+/g, ' ').trim();
		if (!text.length) return json({ error: 'No text could be extracted from the page' }, { status: 400 });

		const result = await ingestChunks(widgetId, text, {
			source: 'url',
			widget_id: widgetId,
			url: url.toString()
		});
		if (result.error) return json({ error: result.error }, { status: 500 });
		return json({ ok: true, chunks: result.chunks });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Scrape failed';
		console.error('POST /api/widgets/[id]/train/scrape:', e);
		return json({ error: msg }, { status: 500 });
	}
};
