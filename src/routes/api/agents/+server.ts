import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

type AgentListItem = {
	id: string;
	name: string;
	description: string;
	createdAt: string;
};

function formatDate(iso: string): string {
	const d = new Date(iso);
	const day = d.getDate();
	let suffix = 'th';
	if (day === 1 || day === 21 || day === 31) suffix = 'st';
	else if (day === 2 || day === 22) suffix = 'nd';
	else if (day === 3 || day === 23) suffix = 'rd';
	return `${day}${suffix} ${d.toLocaleString('en-GB', { month: 'short', year: 'numeric' })}`;
}

function rowToListItem(row: {
	id: string;
	name: string;
	description: string | null;
	created_at: string;
}): AgentListItem {
	return {
		id: row.id,
		name: row.name,
		description: row.description ?? '',
		createdAt: formatDate(row.created_at)
	};
}

/**
 * GET /api/agents – list agents (admin only; RLS enforces).
 */
export const GET: RequestHandler = async (event) => {
	try {
		const supabase = getSupabaseClient(event);
		const { data, error } = await supabase
			.from('agents')
			.select('id, name, description, created_at')
			.order('updated_at', { ascending: false });

		if (error) {
			console.error('Supabase agents list error:', error);
			return json({ agents: [], error: error.message }, { status: 500 });
		}

		const agents: AgentListItem[] = (data ?? []).map(rowToListItem);
		return json({ agents });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to list agents';
		console.error('GET /api/agents:', e);
		return json({ agents: [], error: msg }, { status: 500 });
	}
};

/**
 * POST /api/agents – create an agent (admin only; RLS enforces).
 * Body: { name?, description?, system_prompt? }
 */
export const POST: RequestHandler = async (event) => {
	try {
		if (!event.locals.user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}
		const supabase = getSupabaseClient(event);
		const body = await event.request.json().catch(() => ({}));
		const name = typeof body.name === 'string' ? body.name : 'My Agent';
		const description = typeof body.description === 'string' ? body.description : '';
		const system_prompt = typeof body.system_prompt === 'string' ? body.system_prompt : '';

		const { data, error } = await supabase
			.from('agents')
			.insert({
				name,
				description,
				system_prompt,
				created_by: event.locals.user.id
			})
			.select('id, name, description, created_at')
			.single();

		if (error) {
			console.error('Supabase agent create error:', error);
			return json({ error: error.message }, { status: 500 });
		}

		return json({ agent: rowToListItem(data) }, { status: 201 });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to create agent';
		console.error('POST /api/agents:', e);
		return json({ error: msg }, { status: 500 });
	}
};
