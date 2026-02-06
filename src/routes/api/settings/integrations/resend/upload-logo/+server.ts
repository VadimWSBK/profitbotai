import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';

const BUCKET = 'email-assets';
const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

/**
 * POST /api/settings/integrations/resend/upload-logo – upload email footer logo to Supabase storage.
 * Body: multipart/form-data with field "file".
 * Returns { url: string }. File stored at email-footers/{user_id}/logo.{ext} (upsert).
 * Recommended size: 200x40px or similar aspect ratio, max 2MB.
 */
export const POST: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const formData = await event.request.formData().catch(() => null);
	if (!formData) return json({ error: 'Invalid form data' }, { status: 400 });

	const file = formData.get('file');
	if (!file || !(file instanceof File)) return json({ error: 'No file provided' }, { status: 400 });

	if (file.size > MAX_SIZE) return json({ error: 'File too large (max 2MB)' }, { status: 400 });
	if (!ALLOWED_TYPES.has(file.type))
		return json({ error: 'Invalid type. Use PNG, JPEG, GIF, WebP, or SVG.' }, { status: 400 });

	const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
	const safeExt = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext) ? ext : 'png';
	const path = `email-footers/${event.locals.user.id}/logo.${safeExt}`;

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
			console.error('Logo upload error:', uploadError);
			return json({ error: uploadError.message }, { status: 500 });
		}

		const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
		return json({ url: urlData.publicUrl });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Upload failed';
		console.error('POST /api/settings/integrations/resend/upload-logo:', e);
		return json({ error: msg }, { status: 500 });
	}
};
