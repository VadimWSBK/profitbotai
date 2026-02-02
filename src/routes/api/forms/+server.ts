import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/forms – list current user's quote forms.
 * POST /api/forms – create a new quote form.
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const supabase = getSupabaseClient(event);
	const { data, error } = await supabase
		.from('quote_forms')
		.select('id, name, title, steps, colors, created_at, updated_at')
		.eq('user_id', event.locals.user.id)
		.order('created_at', { ascending: false });
	if (error) {
		console.error('GET /api/forms:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json({ forms: data ?? [] });
};

const DEFAULT_STEPS = [
	{
		title: 'Contact information',
		description: 'Please provide your contact information to receive your instant quote.',
		fields: [
			{ key: 'name', label: 'Full Name', required: true, placeholder: 'Enter your full name' },
			{ key: 'email', label: 'Email Address', required: true, placeholder: 'Enter your email' },
			{ key: 'phone', label: 'Phone Number (Optional)', required: false, placeholder: 'e.g., 0400 123 456' }
		]
	},
	{
		title: 'Property location',
		description: 'Please provide the location of your property.',
		fields: [
			{ key: 'street_address', label: 'Street Address', required: true, placeholder: 'Enter street address' },
			{ key: 'post_code', label: 'Post Code', required: true, placeholder: 'Enter post code' },
			{ key: 'city', label: 'City', required: true, placeholder: 'Enter city' },
			{ key: 'state', label: 'State/Territory', required: true, placeholder: 'Select State/Territory', type: 'select' }
		]
	}
];

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	let body: { name?: string; title?: string; steps?: unknown[]; colors?: Record<string, string> };
	try {
		body = await event.request.json().catch(() => ({}));
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const supabase = getSupabaseClient(event);
	const name = typeof body?.name === 'string' ? body.name.trim() || 'Quote form' : 'Quote form';
	const title = typeof body?.title === 'string' ? body.title.trim() || 'Get Your Quote' : 'Get Your Quote';
	const steps = Array.isArray(body?.steps) ? body.steps : DEFAULT_STEPS;
	const colors =
		body?.colors && typeof body.colors === 'object' && body.colors !== null
			? body.colors
			: { primary: '#D4AF37' };

	const { data, error } = await supabase
		.from('quote_forms')
		.insert({
			user_id: event.locals.user.id,
			name,
			title,
			steps,
			colors
		})
		.select('id, name, title, steps, colors, created_at, updated_at')
		.single();

	if (error) {
		console.error('POST /api/forms:', error);
		return json({ error: error.message }, { status: 500 });
	}
	return json({ form: data });
};
