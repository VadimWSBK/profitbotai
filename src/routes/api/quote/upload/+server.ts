import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/supabase.server';

const BUCKET = 'quote_assets';
const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/svg']);

/**
 * POST /api/quote/upload – upload logo or QR code for quote settings.
 * Body: multipart/form-data with "file" and "type" (logo | qr).
 * Returns { url: string } (public URL). Files stored under {userId}/logo.{ext} or {userId}/qr.{ext}.
 */
export const POST: RequestHandler = async (event) => {
	if (!event.locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const formData = await event.request.formData().catch(() => null);
	if (!formData) return json({ error: 'Invalid form data' }, { status: 400 });

	const file = formData.get('file');
	const type = formData.get('type');
	if (!file || !(file instanceof File)) return json({ error: 'No file provided' }, { status: 400 });
	if (type !== 'logo' && type !== 'qr') return json({ error: 'type must be "logo" or "qr"' }, { status: 400 });

	if (file.size > MAX_SIZE) return json({ error: 'File too large (max 2MB)' }, { status: 400 });

	const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
	const safeExt = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext) ? ext : 'png';
	const isSvgByExt = safeExt === 'svg';
	const typeOk = ALLOWED_TYPES.has(file.type) || (isSvgByExt && (!file.type || file.type.startsWith('image/svg')));
	if (!typeOk)
		return json({ error: 'Invalid type. Use PNG, JPEG, GIF, WebP, or SVG.' }, { status: 400 });
	const path = `${event.locals.user.id}/${type}.${safeExt}`;

	try {
		const supabase = getSupabaseAdmin();
		const { data: buckets } = await supabase.storage.listBuckets();
		if (!buckets?.some((b) => b.name === BUCKET)) {
			await supabase.storage.createBucket(BUCKET, { public: true });
		}

		const contentType = file.type || (safeExt === 'svg' ? 'image/svg+xml' : 'image/png');
		const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
			contentType,
			upsert: true
		});

		if (uploadError) {
			console.error('quote_assets upload:', uploadError);
			return json({ error: uploadError.message }, { status: 500 });
		}

		const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
		return json({ url: urlData.publicUrl });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Upload failed';
		console.error('POST /api/quote/upload:', e);
		return json({ error: msg }, { status: 500 });
	}
};
