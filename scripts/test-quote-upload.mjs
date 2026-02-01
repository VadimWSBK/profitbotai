/**
 * Test script: create a quote PDF, upload to roof_quotes bucket, get signed URL.
 * Run: node --env-file=.env scripts/test-quote-upload.mjs
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and a widget in the DB.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
	console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env scripts/test-quote-upload.mjs');
	process.exit(1);
}

async function run() {
	const admin = createClient(supabaseUrl, supabaseServiceKey);

	// 1. Get a widget and conversation (or create minimal test data)
	const { data: widget, error: widgetErr } = await admin
		.from('widgets')
		.select('id, created_by')
		.limit(1)
		.maybeSingle();

	if (widgetErr || !widget) {
		console.error('No widget found. Create a widget in the dashboard first.');
		process.exit(1);
	}

	const widgetId = widget.id;
	const ownerId = widget.created_by;

	// Get or create a conversation
	const sessionId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	const { data: conv, error: convErr } = await admin
		.from('widget_conversations')
		.insert({ widget_id: widgetId, session_id: sessionId, is_ai_active: true })
		.select('id')
		.single();

	let conversationId = conv?.id;
	if (convErr || !conversationId) {
		const { data: existing } = await admin
			.from('widget_conversations')
			.select('id')
			.eq('widget_id', widgetId)
			.limit(1)
			.maybeSingle();
		conversationId = existing?.id;
	}
	if (!conversationId) {
		console.error('Could not get or create conversation:', convErr);
		process.exit(1);
	}

	console.log('Using widget:', widgetId, 'conversation:', conversationId);

	// 2. Generate PDF
	const pdfmake = (await import('pdfmake')).default;
	const fontsDir = path.join(projectRoot, 'node_modules', 'pdfmake', 'fonts');
	const fonts = {
		Roboto: {
			normal: path.join(fontsDir, 'Roboto', 'Roboto-Regular.ttf'),
			bold: path.join(fontsDir, 'Roboto', 'Roboto-Medium.ttf'),
			italics: path.join(fontsDir, 'Roboto', 'Roboto-Italic.ttf'),
			bolditalics: path.join(fontsDir, 'Roboto', 'Roboto-MediumItalic.ttf')
		}
	};
	pdfmake.setFonts(fonts);

	const docDefinition = {
		pageSize: 'A4',
		pageMargins: [36, 36],
		content: [
			{ text: 'Test Quote PDF', style: 'header' },
			{ text: 'Quote upload test', fontSize: 10, margin: [0, 8, 0, 0] },
			{ text: '\nCustomer: Test User', fontSize: 10 },
			{ text: 'Email: test@example.com', fontSize: 10 },
			{ text: 'Roof: 200 m²', fontSize: 10 },
			{ text: '\nSubtotal: $10,000.00', fontSize: 10 },
			{ text: 'GST (10%): $1,000.00', fontSize: 10 },
			{ text: 'Total: $11,000.00', fontSize: 12, bold: true, margin: [0, 4, 0, 0] },
			{ text: '\nThank you for your interest!', fontSize: 9, margin: [0, 16, 0, 0] }
		],
		styles: { header: { fontSize: 18, bold: true, color: '#2e7d32' } }
	};

	const pdfDoc = pdfmake.createPdf(docDefinition);
	const pdfBuffer = Buffer.from(await pdfDoc.getBuffer());
	console.log('✓ PDF generated (' + pdfBuffer.length + ' bytes)');

	// 3. Ensure bucket exists and upload
	const BUCKET = 'roof_quotes';
	const { data: buckets } = await admin.storage.listBuckets();
	if (!buckets?.some((b) => b.name === BUCKET)) {
		const { error: createErr } = await admin.storage.createBucket(BUCKET, { public: false });
		if (createErr) {
			console.error('Failed to create bucket:', createErr);
			process.exit(1);
		}
		console.log('✓ Created bucket:', BUCKET);
	}

	const customerName = 'Test_User';
	const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
	const fileName = `${conversationId}/quote_${customerName}_${ts}.pdf`;

	const { error: uploadErr } = await admin.storage.from(BUCKET).upload(fileName, pdfBuffer, {
		contentType: 'application/pdf',
		upsert: true,
		metadata: { conversation_id: conversationId, widget_id: widgetId }
	});

	if (uploadErr) {
		console.error('Upload failed:', uploadErr);
		process.exit(1);
	}
	console.log('✓ Uploaded to bucket:', fileName);

	// 4. Create signed URL
	const { data: signed, error: signedErr } = await admin.storage.from(BUCKET).createSignedUrl(fileName, 3600);
	if (signedErr || !signed?.signedUrl) {
		console.error('Signed URL failed:', signedErr);
		process.exit(1);
	}
	console.log('✓ Signed URL:', signed.signedUrl);

	// 5. Verify URL returns PDF
	const res = await fetch(signed.signedUrl);
	if (!res.ok) {
		console.error('URL verification failed: HTTP', res.status);
		process.exit(1);
	}
	const ct = res.headers.get('content-type') ?? '';
	if (!ct.includes('application/pdf')) {
		console.error('URL did not return PDF, got:', ct);
		process.exit(1);
	}
	const blob = await res.arrayBuffer();
	console.log('✓ URL verified: fetched', blob.byteLength, 'bytes, content-type:', ct);

	// 6. Append to contact
	const { error: appendErr } = await admin.rpc('append_pdf_quote_to_contact', {
		p_conversation_id: conversationId,
		p_widget_id: widgetId,
		p_pdf_url: fileName
	});
	if (appendErr) {
		console.warn('append_pdf_quote_to_contact:', appendErr);
	} else {
		console.log('✓ Appended quote to contact');
	}

	console.log('\n✅ All tests passed: quote created, stored in bucket, URL obtained and verified.');
}

run().catch((e) => {
	console.error('Test failed:', e);
	process.exit(1);
});
