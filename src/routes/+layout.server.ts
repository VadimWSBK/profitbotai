import type { LayoutServerLoad } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

export const load: LayoutServerLoad = async (event) => {
	const { user, role } = event.locals;
	let unreadCount = 0;
	let avatarUrl = '';
	let displayName = '';
	if (user) {
		const supabase = getSupabaseClient(event);
		const [convsResult, profileResult] = await Promise.all([
			supabase.from('widget_conversations').select('id'),
			user.id === 'api-key'
				? Promise.resolve({ data: null, error: null })
				: supabase.from('profiles').select('avatar_url, display_name').eq('user_id', user.id).single()
		]);
		const convs = convsResult.data ?? [];
		const convIds = convs.map((c: { id: string }) => c.id);
		if (convIds.length > 0) {
			const { count } = await supabase
				.from('widget_conversation_messages')
				.select('*', { count: 'exact', head: true })
				.in('conversation_id', convIds)
				.eq('role', 'user')
				.is('read_at', null);
			unreadCount = count ?? 0;
		}
		const profile = profileResult.data as { avatar_url?: string; display_name?: string } | null;
		avatarUrl = profile?.avatar_url ?? '';
		displayName = profile?.display_name ?? '';
	}
	return {
		user,
		role,
		unreadCount,
		avatarUrl,
		displayName
	};
};
