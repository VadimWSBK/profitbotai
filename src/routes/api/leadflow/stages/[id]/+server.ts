import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * PATCH /api/leadflow/stages/:id
 * Update stage name or sort_order. Body: { name?: string, sort_order?: number }
 */
export const PATCH: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = event.params.id;
	let body: { name?: string; sort_order?: number };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const updates: { name?: string; sort_order?: number } = {};
	if (typeof body.name === 'string') updates.name = body.name.trim();
	if (typeof body.sort_order === 'number') updates.sort_order = body.sort_order;
	if (Object.keys(updates).length === 0) return json({ error: 'Provide name or sort_order' }, { status: 400 });

	const supabase = getSupabaseClient(event);
	const { data: row, error } = await supabase
		.from('lead_stages')
		.update(updates)
		.eq('id', id)
		.eq('created_by', user.id)
		.select('id, name, sort_order, created_at')
		.single();

	if (error) {
		console.error('PATCH /api/leadflow/stages/[id]:', error);
		return json({ error: error.message }, { status: 500 });
	}
	if (!row) return json({ error: 'Stage not found' }, { status: 404 });
	return json({
		stage: {
			id: row.id,
			name: row.name,
			sortOrder: row.sort_order,
			createdAt: row.created_at
		}
	});
};

/**
 * DELETE /api/leadflow/stages/:id
 * Delete stage. Leads in this stage are moved to the first remaining stage.
 */
export const DELETE: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = event.params.id;
	const supabase = getSupabaseClient(event);

	// Get first other stage (by sort_order) to reassign leads
	const { data: otherStages } = await supabase
		.from('lead_stages')
		.select('id')
		.eq('created_by', user.id)
		.neq('id', id)
		.order('sort_order', { ascending: true })
		.limit(1);

	const fallbackStageId = otherStages?.[0]?.id;

	if (fallbackStageId) {
		await supabase.from('leads').update({ stage_id: fallbackStageId }).eq('stage_id', id);
	} else {
		// No other stage: delete leads in this stage (contact stays, just removed from pipeline)
		await supabase.from('leads').delete().eq('stage_id', id);
	}

	const { error } = await supabase.from('lead_stages').delete().eq('id', id).eq('created_by', user.id);
	if (error) {
		console.error('DELETE /api/leadflow/stages/[id]:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json({ ok: true });
};
