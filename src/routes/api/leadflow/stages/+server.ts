import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

const DEFAULT_STAGES = [
	{ name: 'New lead', sort_order: 0 },
	{ name: 'Requested quote', sort_order: 1 },
	{ name: 'Quote sent', sort_order: 2 },
	{ name: 'Won', sort_order: 3 },
	{ name: 'Lost', sort_order: 4 }
];

/**
 * GET /api/leadflow/stages
 * List pipeline stages for the current user. Creates default stages if none exist.
 */
export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const supabase = getSupabaseClient(event);
	const { data: stages, error: listError } = await supabase
		.from('lead_stages')
		.select('id, name, sort_order, created_at')
		.eq('created_by', user.id)
		.order('sort_order', { ascending: true });

	if (listError) {
		console.error('GET /api/leadflow/stages:', listError);
		return json({ error: listError.message, stages: [] }, { status: 500 });
	}

	// If no stages, create defaults
	if (!stages || stages.length === 0) {
		const toInsert = DEFAULT_STAGES.map((s) => ({ name: s.name, sort_order: s.sort_order, created_by: user.id }));
		const { data: inserted, error: insertError } = await supabase
			.from('lead_stages')
			.insert(toInsert)
			.select('id, name, sort_order, created_at');
		if (insertError) {
			console.error('POST /api/leadflow/stages (defaults):', insertError);
			return json({ error: insertError.message, stages: [] }, { status: 500 });
		}
		const normalized = (inserted ?? []).map((r) => ({
			id: r.id,
			name: r.name,
			sortOrder: r.sort_order,
			createdAt: r.created_at
		}));
		return json({ stages: normalized });
	}

	const normalized = stages.map((r) => ({
		id: r.id,
		name: r.name,
		sortOrder: r.sort_order,
		createdAt: r.created_at
	}));
	return json({ stages: normalized });
};

/**
 * POST /api/leadflow/stages
 * Create a new stage. Body: { name: string, sort_order?: number }
 */
export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { name?: string; sort_order?: number };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return json({ error: 'name is required' }, { status: 400 });

	const sortOrder = typeof body.sort_order === 'number' ? body.sort_order : 999;

	const supabase = getSupabaseClient(event);
	const { data: row, error } = await supabase
		.from('lead_stages')
		.insert({ name, sort_order: sortOrder, created_by: user.id })
		.select('id, name, sort_order, created_at')
		.single();

	if (error) {
		console.error('POST /api/leadflow/stages:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json({
		stage: {
			id: row.id,
			name: row.name,
			sortOrder: row.sort_order,
			createdAt: row.created_at
		}
	});
};
