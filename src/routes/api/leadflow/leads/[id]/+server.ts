import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * PATCH /api/leadflow/leads/:id
 * Move lead to another stage. Body: { stage_id: string }
 */
export const PATCH: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = event.params.id;
	let body: { stage_id?: string };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const stageId = body.stage_id;
	if (!stageId) return json({ error: 'stage_id is required' }, { status: 400 });

	const supabase = getSupabaseClient(event);
	const { data: stage } = await supabase
		.from('lead_stages')
		.select('id')
		.eq('id', stageId)
		.eq('created_by', user.id)
		.single();
	if (!stage) return json({ error: 'Stage not found' }, { status: 404 });

	const { data: row, error } = await supabase
		.from('leads')
		.update({ stage_id: stageId })
		.eq('id', id)
		.select('id, contact_id, stage_id, created_at, updated_at')
		.single();

	if (error) {
		console.error('PATCH /api/leadflow/leads/[id]:', error);
		return json({ error: error.message }, { status: 500 });
	}
	if (!row) return json({ error: 'Lead not found' }, { status: 404 });
	return json({
		lead: {
			id: row.id,
			contactId: row.contact_id,
			stageId: row.stage_id,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}
	});
};
