/**
 * Update John agent's quote formatting rules: no **, use table or clean list.
 * Run: node --env-file=.env scripts/update-john-quote-rules.mjs
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY?.trim();
const geminiKey = process.env.GEMINI_API_KEY?.trim();

if (!supabaseUrl || !supabaseServiceKey) {
	console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
	process.exit(1);
}
if (!openaiKey && !geminiKey) {
	console.error('Missing OPENAI_API_KEY or GEMINI_API_KEY for embeddings');
	process.exit(1);
}

const EMBED_DIM = 1536;
async function getEmbedding(text) {
	if (openaiKey) {
		const res = await fetch('https://api.openai.com/v1/embeddings', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
			body: JSON.stringify({ model: 'text-embedding-3-small', input: text })
		});
		const data = await res.json();
		if (data.error) throw new Error(data.error.message);
		return data.data[0].embedding;
	}
	if (geminiKey) {
		const res = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					content: { parts: [{ text }] },
					output_dimensionality: EMBED_DIM,
					task_type: 'RETRIEVAL_DOCUMENT'
				})
			}
		);
		const data = await res.json();
		const values = data?.embedding?.values;
		if (!values || values.length !== EMBED_DIM) throw new Error('Gemini embedding failed');
		const norm = Math.sqrt(values.reduce((s, x) => s + x * x, 0));
		return norm > 0 ? values.map((x) => x / norm) : values;
	}
	throw new Error('No embedding key');
}

const JOHN_AGENT_ID = '7969ffd0-a340-4757-94db-ab54633fd48a';

const UPDATES = [
	{
		id: '4b36ec7a-b30b-4682-8887-cd5c4478899d',
		content:
			'DIY QUOTE (in-chat only): When customer wants DIY, calculate and present in chat. Do NOT use generate_quote tool. Clearly state it is a DIY Product Quote. Present using a markdown table (| Column | Value |) or a clean list with "Label: value" per line—no ** or asterisks. Include: roof size, litres required, recommended buckets, total cost, shipping. Do not generate a PDF for DIY.',
		tags: ['quote', 'diy', 'delivery']
	},
	{
		id: '9ff88b59-dd5a-4e4c-b302-232c1fbf4322',
		content:
			'DIY QUOTE FORMAT: Roof Size (m²), Total Product Required (litres), Recommended Buckets (X x 15L, Y x 10L, Z x 5L), Total Product Cost AUD, Free Australia wide shipping, 2–8 business days. Include colour recommendation: White provides best UV protection; darker colours reduce thermal performance. Use a markdown table or "Label: value" list—never use ** for bolding.',
		tags: ['quote', 'diy', 'format']
	}
];

const NEW_RULES = [
	{
		content:
			"QUOTE FORMATTING RULES (MANDATORY): When presenting a DIY quote or any quote summary in chat, NEVER use ** for bolding. Format as a markdown table or a clean structured list. Example table format:\n\n| Item | Details |\n|------|----------|\n| Coverage needed | 200 litres... |\n| Buckets required | 14 x 15L... |\n| Total price | $5,459.86 AUD |\n| Shipping | Free Australia-wide... |\n\nOr use a simple list with colons: \"Coverage needed: 200 litres...\", one line per item. Never use asterisks or markdown bold syntax.",
		tags: ['quote', 'format', 'diy', 'presentation']
	},
	{
		content:
			'DIY CHECKOUT LINK (MANDATORY when Shopify connected): After presenting a DIY quote, ALWAYS offer a one-click checkout link. Use the shopify_create_diy_checkout_link tool with roof_size_sqm (or the bucket counts you calculated). Say something like "Would you like a direct checkout link to purchase these buckets with one click?" or "I can send you a link to buy these products now." Then call the tool and share the link as [Buy now](url). Requires Shopify to be connected in Settings → Integrations.',
		tags: ['quote', 'diy', 'checkout', 'shopify']
	},
	{
		content:
			'DISCOUNT RULES: When the customer asks for a discount, offer 10% by passing discount_percent: 10 to shopify_create_diy_checkout_link. Say you are happy to give them 10% off and include it in their checkout link. If they push for more ("can you do better?", "any more discount?", "15%?"), reluctantly but with good humour give 15%—pass discount_percent: 15. Use a light-hearted tone, e.g. "Alright, you have convinced me! Let me see what I can do... 15% it is, but don\'t tell my boss!" or "You drive a hard bargain! 15%—my final offer."',
		tags: ['discount', 'quote', 'diy', 'shopify']
	},
	{
		content:
			'CHECKOUT PREVIEW (MANDATORY): When sharing a checkout link from shopify_create_diy_checkout_link, you MUST include the full preview from the tool response. The tool returns previewMarkdown—copy it exactly into your reply. This shows the customer a preview of their cart: product table with quantities and prices, subtotal, discount (if any), total, and the Buy now link. Never share only the link; always show the preview first.',
		tags: ['checkout', 'preview', 'diy', 'shopify']
	}
];

async function run() {
	const admin = createClient(supabaseUrl, supabaseServiceKey);

	console.log('Updating John agent quote formatting rules...');

	for (const u of UPDATES) {
		try {
			const embedding = await getEmbedding(u.content);
			const { error } = await admin
				.from('agent_rules')
				.update({
					content: u.content,
					tags: u.tags,
					embedding,
					updated_at: new Date().toISOString()
				})
				.eq('id', u.id)
				.eq('agent_id', JOHN_AGENT_ID);
			if (error) throw error;
			console.log(`  Updated rule ${u.id.slice(0, 8)}...`);
		} catch (e) {
			console.error(`  Failed to update ${u.id}:`, e.message);
		}
	}

	for (const r of NEW_RULES) {
		try {
			const embedding = await getEmbedding(r.content);
			const { error } = await admin.from('agent_rules').insert({
				agent_id: JOHN_AGENT_ID,
				content: r.content,
				tags: r.tags,
				embedding,
				enabled: true
			});
			if (error) throw error;
			console.log(`  Added rule: ${r.content.slice(0, 50)}...`);
		} catch (e) {
			console.error('  Failed to add rule:', e.message);
		}
	}

	console.log('Done.');
}

run().catch((e) => {
	console.error(e);
	process.exit(1);
});
