import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { isTrainBotConfigured } from '$lib/train-bot.server';

/**
 * GET /api/widgets/[id]/train – Train Bot status and document count for this widget.
 */
export const GET: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	if (!widgetId) return json({ error: 'Missing widget id' }, { status: 400 });
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const supabase = getSupabaseClient(event);
		const { count, error } = await supabase
			.from('widget_documents')
			.select('*', { count: 'exact', head: true })
			.eq('widget_id', widgetId);
		if (error) {
			// Table might not exist yet (migration not run)
			return json({ configured: isTrainBotConfigured(), documentCount: 0 });
		}
		return json({ configured: isTrainBotConfigured(), documentCount: count ?? 0 });
	} catch {
		return json({ configured: isTrainBotConfigured(), documentCount: 0 });
	}
};
