import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/leadflow/leads?widget_id=
 * List all leads with contact and stage. Contacts without a lead are not included
 * (frontend can create leads for them when they're dropped into a stage).
 */
export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const widgetId = event.url.searchParams.get('widget_id') ?? undefined;
	const supabase = getSupabaseClient(event);

	let leadsQuery = supabase
		.from('leads')
		.select(
			`
			id,
			contact_id,
			stage_id,
			created_at,
			updated_at,
			contacts(
				id,
				conversation_id,
				widget_id,
				name,
				email,
				phone,
				address,
				created_at,
				updated_at,
				widgets(name)
			)
		`
		)
		.order('updated_at', { ascending: false });

	const { data: leadRows, error } = await leadsQuery;
	if (error) {
		console.error('GET /api/leadflow/leads:', error);
		return json({ error: error.message, leads: [] }, { status: 500 });
	}

	let leads = (leadRows ?? []).map((r: Record<string, unknown>) => {
		const c = r.contacts as Record<string, unknown> | Record<string, unknown>[] | null;
		const contact = Array.isArray(c) ? c[0] : c;
		const widgets = contact?.widgets as { name: string } | { name: string }[] | null;
		let widgetName: string | null = null;
		if (widgets) {
			widgetName = Array.isArray(widgets) ? widgets[0]?.name ?? null : (widgets as { name: string }).name ?? null;
		}
		return {
			id: r.id,
			contactId: r.contact_id,
			stageId: r.stage_id,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
			contact: contact
				? {
						id: contact.id,
						conversationId: contact.conversation_id,
						widgetId: contact.widget_id,
						widgetName,
						name: contact.name ?? null,
						email: contact.email ?? null,
						phone: contact.phone ?? null,
						address: contact.address ?? null,
						createdAt: contact.created_at,
						updatedAt: contact.updated_at
					}
				: null
		};
	});

	if (widgetId) {
		leads = leads.filter((l) => l.contact?.widgetId === widgetId);
	}

	return json({ leads });
};

/**
 * POST /api/leadflow/leads
 * Create a lead for a contact (put in a stage). Body: { contact_id: string, stage_id: string }
 */
export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { contact_id?: string; stage_id?: string };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const contactId = body.contact_id;
	const stageId = body.stage_id;
	if (!contactId || !stageId) return json({ error: 'contact_id and stage_id are required' }, { status: 400 });

	const supabase = getSupabaseClient(event);
	// Verify stage belongs to user
	const { data: stage } = await supabase
		.from('lead_stages')
		.select('id')
		.eq('id', stageId)
		.eq('created_by', user.id)
		.single();
	if (!stage) return json({ error: 'Stage not found' }, { status: 404 });

	const { data: row, error } = await supabase
		.from('leads')
		.insert({ contact_id: contactId, stage_id: stageId })
		.select('id, contact_id, stage_id, created_at, updated_at')
		.single();

	if (error) {
		if (error.code === '23505') return json({ error: 'Lead already exists for this contact' }, { status: 409 });
		console.error('POST /api/leadflow/leads:', error);
		return json({ error: error.message }, { status: 500 });
	}
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
