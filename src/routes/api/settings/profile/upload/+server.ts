import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';

const BUCKET = 'avatars';
const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * POST /api/settings/profile/upload – upload profile picture to Supabase storage.
 * Body: multipart/form-data with field "file".
 * Returns { url: string }. File stored at avatars/{user_id}/avatar.{ext} (upsert).
 */
export const POST: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const formData = await event.request.formData().catch(() => null);
	if (!formData) return json({ error: 'Invalid form data' }, { status: 400 });

	const file = formData.get('file');
	if (!file || !(file instanceof File)) return json({ error: 'No file provided' }, { status: 400 });

	if (file.size > MAX_SIZE) return json({ error: 'File too large (max 2MB)' }, { status: 400 });
	if (!ALLOWED_TYPES.has(file.type))
		return json({ error: 'Invalid type. Use PNG, JPEG, GIF, or WebP.' }, { status: 400 });

	const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
	const safeExt = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? ext : 'png';
	const path = `${event.locals.user.id}/avatar.${safeExt}`;

	try {
		const supabase = getSupabaseAdmin();
		const { data: buckets } = await supabase.storage.listBuckets();
		if (!buckets?.some((b) => b.name === BUCKET)) {
			await supabase.storage.createBucket(BUCKET, { public: true });
		}

		const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
			contentType: file.type,
			upsert: true
		});

		if (uploadError) {
			console.error('Profile upload error:', uploadError);
			return json({ error: uploadError.message }, { status: 500 });
		}

		const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
		return json({ url: urlData.publicUrl });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Upload failed';
		console.error('POST /api/settings/profile/upload:', e);
		return json({ error: msg }, { status: 500 });
	}
};
