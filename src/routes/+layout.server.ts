import type { LayoutServerLoad } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

export const load: LayoutServerLoad = async (event) => {
	const { user, role } = event.locals;
	let unreadCount = 0;
	if (user) {
		const supabase = getSupabaseClient(event);
		const { data: convs } = await supabase.from('widget_conversations').select('id');
		const convIds = (convs ?? []).map((c: { id: string }) => c.id);
		if (convIds.length > 0) {
			const { count } = await supabase
				.from('widget_conversation_messages')
				.select('*', { count: 'exact', head: true })
				.in('conversation_id', convIds)
				.eq('role', 'user')
				.is('read_at', null);
			unreadCount = count ?? 0;
		}
	}
	return {
		user,
		role,
		unreadCount
	};
};
