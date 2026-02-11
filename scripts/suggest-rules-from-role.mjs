/**
 * Suggest RAG rules extracted from an agent's long Role.
 * Outputs rule content + suggested tags for manual copy-paste into Train → Rules.
 * Run: node --env-file=.env scripts/suggest-rules-from-role.mjs <agentId>
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
	console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
	process.exit(1);
}

const agentId = process.argv[2]?.trim();
if (!agentId) {
	console.error('Usage: node scripts/suggest-rules-from-role.mjs <agentId>');
	process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/** Split role text into sections by common header patterns (ALL CAPS lines or "Tone:"). */
function extractSections(text) {
	const sections = [];
	const lines = text.split('\n');
	let current = { header: null, content: [] };

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// Section header: line is mostly ALL CAPS, or starts with "Tone:"
		const looksLikeHeader =
			/^Tone:\s*.{0,50}$/.test(line) ||
			(/^[A-Z][A-Z0-9\s&\-\()]+$/.test(line.trim()) && line.trim().length > 15);

		if (looksLikeHeader && current.content.length > 0) {
			const content = current.content.join('\n').trim();
			if (content.length > 30) sections.push({ header: current.header, content });
			current = { header: line.trim(), content: [] };
		} else if (looksLikeHeader) {
			current = { header: line.trim(), content: [] };
		} else {
			current.content.push(line);
		}
	}
	const content = current.content.join('\n').trim();
	if (content.length > 30) sections.push({ header: current.header, content });

	return sections;
}

/** Suggest tags from header or content. */
function suggestTags(header, content) {
	const lower = (header || '').toLowerCase() + ' ' + (content || '').toLowerCase();
	const tags = [];
	if (/\bcrm\b|contact|data protection|never ask again|verification\b/.test(lower)) tags.push('crm', 'contact');
	if (/\bsales\b|guiding question|buying intent|recommend\b/.test(lower)) tags.push('sales', 'behavior');
	if (/\bproduct\b|principle|coverage|reflect|membrane\b/.test(lower)) tags.push('product', 'core');
	if (/\bsafety\b|accuracy|never invent|never guess|escalate\b/.test(lower)) tags.push('safety', 'accuracy');
	if (/\btone\b|format|bullet|length|style\b/.test(lower)) tags.push('tone', 'format');
	if (tags.length === 0) tags.push('general');
	return [...new Set(tags)];
}

async function main() {
	const { data: agent, error } = await supabase
		.from('agents')
		.select('id, name, bot_role')
		.eq('id', agentId)
		.single();

	if (error || !agent) {
		console.error('Agent not found:', agentId, error?.message);
		process.exit(1);
	}

	const role = (agent.bot_role || '').trim();
	if (role.length < 500) {
		console.log('Role is already short enough:', role.length, 'chars.');
		console.log('No suggested extraction needed.');
		process.exit(0);
	}

	console.log('Agent:', agent.name || agentId);
	console.log('Role length:', role.length, 'chars (~' + Math.ceil(role.length / 4) + ' tokens)');
	console.log('');
	console.log('--- Suggested RAG rules (copy each to Train → Rules) ---');
	console.log('');

	const sections = extractSections(role);
	if (sections.length === 0) {
		// Fallback: split by double newline
		const chunks = role.split(/\n\s*\n/).filter((c) => c.trim().length > 50);
		for (const chunk of chunks) {
			const trimmed = chunk.trim().slice(0, 400);
			const tags = suggestTags(null, trimmed);
			console.log('Content:', trimmed + (chunk.length > 400 ? '…' : ''));
			console.log('Tags:', tags.join(', '));
			console.log('---');
		}
	} else {
		for (const s of sections) {
			const content = s.content.slice(0, 400) + (s.content.length > 400 ? '…' : '');
			const tags = suggestTags(s.header, s.content);
			if (s.header) console.log('Section:', s.header);
			console.log('Content:', content);
			console.log('Tags:', tags.join(', '));
			console.log('---');
		}
	}

	console.log('');
	console.log('Compact Role replacement (after adding rules above):');
	console.log('You are a knowledgeable sales and support assistant. Help with DIY quotes and Done For You installation. Follow the rules above.');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
