import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/supabase.server';

/**
 * PATCH /api/widgets/[id]/contacts
 * Body: { conversationId: string, name?: string, email?: string, phone?: string, address?: string, roof_size_sqm?: number }
 * Updates contact fields. Call from n8n or when extracting user info from the conversation.
 */
export const PATCH: RequestHandler = async (event) => {
	const widgetId = event.params.id;
	if (!widgetId) return json({ error: 'Missing widget id' }, { status: 400 });

	let body: {
		conversationId?: string;
		name?: string;
		email?: string;
		phone?: string;
		address?: string;
		roof_size_sqm?: number;
	};
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() : '';
	if (!conversationId) return json({ error: 'Missing conversationId' }, { status: 400 });

	const updates: Record<string, string | number> = {};
	if (typeof body?.name === 'string') updates.name = body.name.trim();
	if (typeof body?.email === 'string') updates.email = body.email.trim();
	if (typeof body?.phone === 'string') updates.phone = body.phone.trim();
	if (typeof body?.address === 'string') updates.address = body.address.trim();
	if (typeof body?.roof_size_sqm === 'number' && body.roof_size_sqm >= 0) updates.roof_size_sqm = body.roof_size_sqm;
	if (Object.keys(updates).length === 0) {
		return json({ error: 'No fields to update (name, email, phone, address, roof_size_sqm)' }, { status: 400 });
	}

	try {
		const supabase = getSupabase();
		const { error } = await supabase
			.from('contacts')
			.update(updates)
			.eq('conversation_id', conversationId)
			.eq('widget_id', widgetId);
		if (error) {
			console.error('contacts update:', error);
			return json({ error: error.message }, { status: 500 });
		}
		return json({ success: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to update contact';
		console.error('PATCH /api/widgets/[id]/contacts:', e);
		return json({ error: msg }, { status: 500 });
	}
};
