import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';

const BUCKET = 'widget-assets';
const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

/**
 * POST /api/widgets/upload – upload an icon when creating a new widget (no widget id yet).
 * Body: multipart/form-data with field "file".
 * Returns { url: string } (public URL). Files stored under draft/{userId}/{uuid}.ext
 */
export const POST: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (event.locals.role !== 'admin') return json({ error: 'Forbidden' }, { status: 403 });

	const formData = await event.request.formData().catch(() => null);
	if (!formData) return json({ error: 'Invalid form data' }, { status: 400 });

	const file = formData.get('file');
	if (!file || !(file instanceof File)) return json({ error: 'No file provided' }, { status: 400 });

	if (file.size > MAX_SIZE) return json({ error: 'File too large (max 2MB)' }, { status: 400 });
	if (!ALLOWED_TYPES.includes(file.type))
		return json({ error: 'Invalid type. Use PNG, JPEG, GIF, WebP, or SVG.' }, { status: 400 });

	const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
	const safeExt = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext) ? ext : 'png';
	const path = `draft/${event.locals.user.id}/${crypto.randomUUID()}.${safeExt}`;

	try {
		const supabase = getSupabaseAdmin();
		const { data: buckets } = await supabase.storage.listBuckets();
		if (!buckets?.some((b) => b.name === BUCKET)) {
			await supabase.storage.createBucket(BUCKET, { public: true });
		}

		const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
			contentType: file.type,
			upsert: false
		});

		if (uploadError) {
			console.error('Upload error:', uploadError);
			return json({ error: uploadError.message }, { status: 500 });
		}

		const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
		return json({ url: urlData.publicUrl });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Upload failed';
		console.error('POST /api/widgets/upload:', e);
		return json({ error: msg }, { status: 500 });
	}
};
