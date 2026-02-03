/**
 * Seed agent rules from the NetZero Coating instruction sheet.
 * Run: node --env-file=.env scripts/seed-agent-rules.mjs [agentId]
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY or GEMINI_API_KEY
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

const RULES = [
	{
		content:
			'CORE PRODUCT PRINCIPLES (ALWAYS TRUE) – NetZero Coating: Reflects up to 90 percent of solar heat. Acts like sunscreen for buildings using nano technology. Reduces roof surface temperature and indoor heat gain. Helps reduce cooling and electricity costs. Is a waterproof coating membrane, not paint. DIY friendly with proper preparation.',
		tags: ['product', 'core', 'principles']
	},
	{
		content:
			'Suitable applications for NetZero Coating: Residential roofs, commercial roofs, caravan and RV roofs, houseboats, sheds, patios, trailers, containers.',
		tags: ['application', 'suitable']
	},
	{
		content:
			'Compatible surfaces: Concrete, metal, Colorbond, wood, fibreglass, aluminium, most prepared roofing substrates.',
		tags: ['application', 'surfaces', 'compatible']
	},
	{
		content:
			'COLOUR PERFORMANCE RULE (MANDATORY IN ALL QUOTES): White provides highest UV protection and heat reflection. Darker colours absorb more heat and reduce thermal performance.',
		tags: ['colour', 'pricing', 'quote', 'mandatory']
	},
	{
		content:
			'Enter Quote Mode when user asks about: quote, estimate, price, cost, coverage, product quantity.',
		tags: ['quote', 'trigger', 'intent']
	},
	{
		content:
			'REQUIRED CONTACT DATA for quotes: Full name, email, phone number (optional but try to get it), full address where the property is located. Roof size in square metres is required to generate an instant quote.',
		tags: ['quote', 'contact', 'collection', 'required']
	},
	{
		content:
			'If the user does not know roof size: Ask for the address. Based on the address we will do a satellite measurement and get back to the user in 12–24h. Do not estimate roof size. Collect contact info and tell them a team member will get back shortly. Do not send any quote link in this case.',
		tags: ['quote', 'roof_size', 'satellite', 'measurement']
	},
	{
		content:
			'Extract roof size as digits only for the quote (e.g. 400 from "400 sqm" or "400m2").',
		tags: ['quote', 'roof_size', 'extract']
	},
	{
		content:
			'CONTACT COLLECTION LOGIC: Before asking for any detail, check existing CRM data. Only request missing or unverified details.',
		tags: ['contact', 'crm', 'collection']
	},
	{
		content:
			'Quote collection flow: Step 1 Name (ask only if missing). Step 2 Email (ask only if missing or unverified). Step 3 Phone (ask only if missing). Step 4 Roof size (ask if known). Step 5 Ask: "Do you plan to do it yourself (DIY) or would you like us to coat the roof for you?" Always ask this before generating any quote.',
		tags: ['quote', 'flow', 'collection', 'diy', 'done_for_you']
	},
	{
		content:
			'DIY vs Done For You – Ask the contact: "Do you plan to do it yourself (DIY) or would you like us to coat the roof for you?" If DIY: calculate price and buckets in chat (no PDF). If Done For You: use the generate_quote tool to create a professional installation quote PDF.',
		tags: ['quote', 'diy', 'done_for_you', 'mandatory']
	},
	{
		content:
			'IF USER KNOWS ROOF SIZE: First ask DIY or Done For You. If DIY: calculate litres, buckets, and price in chat only. If Done For You: use generate_quote tool (creates professional installation PDF). IF USER DOES NOT KNOW ROOF SIZE: Request property address, do not estimate, mark quote as pending measurement. Satellite response: "Thanks. We will measure your roof using satellite tools and email both your DIY and Done For You quotes once completed."',
		tags: ['quote', 'satellite', 'workflow', 'diy', 'done_for_you']
	},
	{
		content:
			'COVERAGE & CALCULATION RULES: 1 litre covers 2 square metres using a two coat system. Formula: Total Litres Required = Roof Size ÷ 2. Always round up. Never under quote.',
		tags: ['coverage', 'calculation', 'formula', 'quote']
	},
	{
		content:
			'BUCKET SIZES & PRICING: 15L covers 30 m² – $389.99. 10L covers 20 m² – $285.99. 5L covers 10 m² – $149.99.',
		tags: ['pricing', 'bucket', 'quote']
	},
	{
		content:
			'BUCKET OPTIMISATION RULES: Meet or exceed required litres. Use fewest number of buckets. Prioritise largest bucket sizes first (15L → 10L → 5L). Allow small safety buffer. Never suggest under coverage.',
		tags: ['pricing', 'bucket', 'optimisation']
	},
	{
		content:
			'DIY QUOTE (in-chat only): When customer wants DIY, calculate and present in chat. Do NOT use generate_quote tool. Clearly state it is a DIY Product Quote. Present using a markdown table (| Column | Value |) or a clean list with "Label: value" per line—no ** or asterisks. Include: roof size, litres required, recommended buckets, total cost, shipping. Do not generate a PDF for DIY.',
		tags: ['quote', 'diy', 'delivery']
	},
	{
		content:
			'DIY QUOTE FORMAT: Roof Size (m²), Total Product Required (litres), Recommended Buckets (X x 15L, Y x 10L, Z x 5L), Total Product Cost AUD, Free Australia wide shipping, 2–8 business days. Include colour recommendation: White provides best UV protection; darker colours reduce thermal performance.',
		tags: ['quote', 'diy', 'format']
	},
	{
		content:
			'QUOTE FORMATTING RULES (MANDATORY): When presenting a DIY quote or any quote summary in chat, NEVER use ** for bolding. Format as a markdown table or a clean structured list. Example table format:\n\n| Item | Details |\n|------|----------|\n| Coverage needed | 200 litres... |\n| Buckets required | 14 x 15L... |\n| Total price | $5,459.86 AUD |\n| Shipping | Free Australia-wide... |\n\nOr use a simple list with colons: "Coverage needed: 200 litres...", one line per item. Never use asterisks or markdown bold syntax.',
		tags: ['quote', 'format', 'diy', 'presentation']
	},
	{
		content:
			'DONE FOR YOU QUOTE (MANDATORY): The generate_quote tool creates a Done For You quote only—i.e. we coat the roof for the customer (professional installation). NEVER use generate_quote for DIY. For DIY, calculate in chat. For Done For You, use generate_quote to create the PDF.',
		tags: ['quote', 'done_for_you', 'mandatory', 'generate_quote']
	},
	{
		content:
			'After DIY quote in chat, say: "If you would prefer professional installation, I can send you a Done For You quote—just let me know and I will organise it."',
		tags: ['quote', 'done_for_you', 'delivery']
	},
	{
		content:
			'DIY CHECKOUT LINK (when Shopify connected): After presenting a DIY quote, offer a one-click checkout link. Use shopify_create_diy_checkout_link with roof_size_sqm (or bucket counts). Say "Would you like a direct checkout link to purchase these buckets with one click?" Then call the tool and share [Buy now](url). Requires Shopify connected in Settings → Integrations.',
		tags: ['quote', 'diy', 'checkout', 'shopify']
	},
	{
		content:
			"DISCOUNT RULES: When customer asks for a discount, offer 10% (pass discount_percent: 10 to shopify_create_diy_checkout_link). If they push for more, reluctantly but with humour give 15% (discount_percent: 15). Use light-hearted tone for the 15% upgrade, e.g. \"Alright, you've convinced me! 15%—my final offer.\"",
		tags: ['discount', 'quote', 'diy', 'shopify']
	},
	{
		content:
			'CHECKOUT PREVIEW: When sharing a checkout link from shopify_create_diy_checkout_link, include the full previewMarkdown from the tool response so the customer sees their cart (products, amounts, discount, total) before the Buy now link.',
		tags: ['checkout', 'preview', 'diy', 'shopify']
	},
	{
		content:
			'SHIPPING RULES: Free Australia wide shipping. 2 to 8 business day delivery. Same day dispatch before 11:30am QLD time.',
		tags: ['shipping', 'delivery']
	},
	{
		content:
			'APPLICATION GUIDANCE (only when asked): Three step system – power wash surface, apply first coat, apply second coat. Recommended equipment: airless spray machine preferred; rollers and brushes acceptable but slower.',
		tags: ['application', 'how_to']
	},
	{
		content:
			'DURABILITY AND MAINTENANCE: Expected lifespan 10–20 years. Maintenance coat recommended every 5–10 years.',
		tags: ['durability', 'maintenance']
	},
	{
		content:
			'EMAIL REFUSAL RULE: If user refuses email, explain politely that official quotes require email. You may provide general pricing guidance only.',
		tags: ['contact', 'email', 'refusal']
	},
	{
		content:
			'SAFETY AND ACCURACY RULES: Never invent pricing or discounts. Never guess roof size. Never contradict coverage rates. Escalate uncertain technical questions. Coverage assumes properly prepared surfaces.',
		tags: ['safety', 'accuracy', 'mandatory']
	},
	{
		content:
			'For uncertain or unknown questions, say: "I want to make sure I give you accurate information. I can have one of our specialists follow up with you if you would like."',
		tags: ['unknown', 'escalation']
	},
	{
		content:
			'PRIMARY OBJECTIVES: Educate clearly, collect accurate customer data, generate reliable quotes, reduce friction in buying process, maintain trust and professionalism, protect CRM data integrity.',
		tags: ['objectives', 'core']
	}
];

async function run() {
	const args = process.argv.slice(2);
	const replace = args.includes('--replace');
	const agentId = args.find((a) => !a.startsWith('--')) || null;
	const admin = createClient(supabaseUrl, supabaseServiceKey);

	let resolvedAgentId = agentId;
	if (!resolvedAgentId) {
		const { data: agents, error } = await admin.from('agents').select('id, name').limit(5);
		if (error || !agents?.length) {
			console.error('No agents found. Create an agent first or pass agent ID: node scripts/seed-agent-rules.mjs <agentId>');
			process.exit(1);
		}
		resolvedAgentId = agents[0].id;
		console.log(`Using agent: ${agents[0].name} (${resolvedAgentId})`);
	}

	if (replace) {
		const { error } = await admin.from('agent_rules').delete().eq('agent_id', resolvedAgentId);
		if (error) {
			console.error('Failed to delete existing rules:', error.message);
			process.exit(1);
		}
		console.log('Replaced existing rules.');
	}

	console.log(`Seeding ${RULES.length} rules into agent ${resolvedAgentId}...`);

	for (let i = 0; i < RULES.length; i++) {
		const { content, tags } = RULES[i];
		try {
			const embedding = await getEmbedding(content);
			const { error } = await admin.from('agent_rules').insert({
				agent_id: resolvedAgentId,
				content,
				tags,
				embedding,
				enabled: true
			});
			if (error) throw error;
			console.log(`  [${i + 1}/${RULES.length}] OK: ${content.slice(0, 50)}...`);
		} catch (e) {
			console.error(`  [${i + 1}/${RULES.length}] FAIL:`, e.message);
		}
	}

	console.log('Done.');
}

run().catch((e) => {
	console.error(e);
	process.exit(1);
});
