import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

export const actions: Actions = {
	default: async (event) => {
		if (!event.locals.user) {
			return { error: 'Unauthorized' };
		}
		const supabase = getSupabaseClient(event);
		const { data, error } = await supabase
			.from('quote_forms')
			.insert({
				user_id: event.locals.user.id,
				name: 'Quote form',
				title: 'Get Your Quote',
				steps: [
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
				],
				colors: { primary: '#D4AF37' }
			})
			.select('id')
			.single();
		if (error) {
			console.error('forms/new:', error);
			return { error: error.message };
		}
		throw redirect(303, `/forms/${data.id}`);
	}
};
