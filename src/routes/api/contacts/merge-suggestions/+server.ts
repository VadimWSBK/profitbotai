import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';
import { parseEmailsFromDb } from '$lib/contact-email-jsonb';
import { parsePhonesFromDb } from '$lib/contact-phone-jsonb';
import { chatWithLlm } from '$lib/chat-llm.server';

type ContactRow = {
	id: string;
	name: string | null;
	email: unknown;
	phone: unknown;
	tags: unknown;
	widget_id: string | null;
	city: string | null;
	state: string | null;
	country: string | null;
	created_at: string;
	widgets: { name: string } | { name: string }[] | null;
};

type SuggestionContact = {
	id: string;
	name: string | null;
	emails: string[];
	phones: string[];
	tags: string[];
	widgetName: string | null;
	createdAt: string;
};

type MergeGroup = {
	reason: string;
	confidence: 'high' | 'medium';
	contacts: SuggestionContact[];
};

// ── Union-Find for transitive grouping ──────────────────────────────
class UnionFind {
	private parent: Map<string, string> = new Map();

	find(x: string): string {
		if (!this.parent.has(x)) this.parent.set(x, x);
		let root = x;
		while (this.parent.get(root) !== root) root = this.parent.get(root)!;
		// Path compression
		let curr = x;
		while (curr !== root) {
			const next = this.parent.get(curr)!;
			this.parent.set(curr, root);
			curr = next;
		}
		return root;
	}

	union(a: string, b: string) {
		const ra = this.find(a);
		const rb = this.find(b);
		if (ra !== rb) this.parent.set(ra, rb);
	}

	groups(): Map<string, string[]> {
		const result = new Map<string, string[]>();
		for (const key of this.parent.keys()) {
			const root = this.find(key);
			if (!result.has(root)) result.set(root, []);
			result.get(root)!.push(key);
		}
		return result;
	}
}

function toSuggestionContact(row: ContactRow): SuggestionContact {
	const widgetName = (() => {
		if (!row.widgets) return null;
		return Array.isArray(row.widgets)
			? row.widgets[0]?.name ?? null
			: (row.widgets as { name: string }).name ?? null;
	})();
	const rawTags = row.tags;
	const tags: string[] = Array.isArray(rawTags)
		? (rawTags as unknown[]).filter((t): t is string => typeof t === 'string')
		: [];
	return {
		id: row.id,
		name: row.name ?? null,
		emails: parseEmailsFromDb(row.email),
		phones: parsePhonesFromDb(row.phone),
		tags,
		widgetName,
		createdAt: row.created_at
	};
}

/**
 * GET /api/contacts/merge-suggestions
 * Returns groups of contacts that are likely duplicates.
 * Phase 1: deterministic matching (shared email/phone).
 * Phase 2: LLM-based fuzzy matching (name similarity, etc.) if LLM is configured.
 */
export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const supabase = getSupabaseClient(event);

	// Fetch all contacts for the user's widgets
	const { data: rows, error } = await supabase
		.from('contacts')
		.select('id, name, email, phone, tags, widget_id, city, state, country, created_at, widgets(name)')
		.order('created_at', { ascending: true });

	if (error) {
		console.error('GET /api/contacts/merge-suggestions:', error);
		return json({ error: error.message }, { status: 500 });
	}

	const contacts = (rows ?? []) as ContactRow[];
	if (contacts.length < 2) {
		return json({ groups: [], llmUsed: false });
	}

	const contactMap = new Map<string, ContactRow>();
	for (const c of contacts) contactMap.set(c.id, c);

	// ── Phase 1: Deterministic matching (shared email or phone) ─────
	const uf = new UnionFind();
	const emailToIds = new Map<string, string[]>();
	const phoneToIds = new Map<string, string[]>();

	for (const c of contacts) {
		const emails = parseEmailsFromDb(c.email);
		for (const e of emails) {
			const lower = e.toLowerCase();
			if (!emailToIds.has(lower)) emailToIds.set(lower, []);
			emailToIds.get(lower)!.push(c.id);
		}
		const phones = parsePhonesFromDb(c.phone);
		for (const p of phones) {
			if (!phoneToIds.has(p)) phoneToIds.set(p, []);
			phoneToIds.get(p)!.push(c.id);
		}
	}

	// Build shared-email reasons
	const sharedReasons = new Map<string, string[]>();
	for (const [email, ids] of emailToIds) {
		if (ids.length > 1) {
			for (let i = 1; i < ids.length; i++) {
				uf.union(ids[0], ids[i]);
			}
			const root = uf.find(ids[0]);
			if (!sharedReasons.has(root)) sharedReasons.set(root, []);
			sharedReasons.get(root)!.push(`Shared email: ${email}`);
		}
	}
	for (const [phone, ids] of phoneToIds) {
		if (ids.length > 1) {
			for (let i = 1; i < ids.length; i++) {
				uf.union(ids[0], ids[i]);
			}
			const root = uf.find(ids[0]);
			if (!sharedReasons.has(root)) sharedReasons.set(root, []);
			sharedReasons.get(root)!.push(`Shared phone: ${phone}`);
		}
	}

	const deterministicGroups: MergeGroup[] = [];
	const groupedIds = new Set<string>();
	const ufGroups = uf.groups();

	for (const [, memberIds] of ufGroups) {
		if (memberIds.length < 2) continue;
		const root = uf.find(memberIds[0]);
		const reasons = sharedReasons.get(root) ?? [];
		const uniqueReasons = [...new Set(reasons)];
		deterministicGroups.push({
			reason: uniqueReasons.join('; '),
			confidence: 'high',
			contacts: memberIds
				.map((id) => contactMap.get(id))
				.filter((c): c is ContactRow => c != null)
				.map(toSuggestionContact)
		});
		for (const id of memberIds) groupedIds.add(id);
	}

	// ── Phase 2: LLM-based fuzzy matching ───────────────────────────
	let llmUsed = false;
	const llmGroups: MergeGroup[] = [];

	// Only attempt LLM if there are ungrouped contacts to analyze
	const ungrouped = contacts.filter((c) => !groupedIds.has(c.id));
	if (ungrouped.length >= 2) {
		// Resolve LLM config: get user's first widget with direct backend, then fetch API key
		const { data: widgetRows } = await supabase
			.from('widgets')
			.select('id, config')
			.limit(10);

		let llmProvider = '';
		let llmModel = '';
		for (const w of widgetRows ?? []) {
			const cfg = (w.config ?? {}) as Record<string, unknown>;
			if (cfg.llmProvider && typeof cfg.llmProvider === 'string' && cfg.llmProvider.trim()) {
				llmProvider = cfg.llmProvider as string;
				llmModel = (cfg.llmModel as string) ?? '';
				break;
			}
		}

		if (llmProvider) {
			// Fetch API key from user_llm_keys
			const { data: keyRow } = await supabase
				.from('user_llm_keys')
				.select('api_key')
				.eq('user_id', user.id)
				.eq('provider', llmProvider)
				.single();

			const apiKey = keyRow?.api_key ?? null;
			if (apiKey) {
				// Cap contacts sent to LLM
				const toAnalyze = ungrouped.slice(0, 100);
				const contactSummaries = toAnalyze.map((c, i) => {
					const emails = parseEmailsFromDb(c.email);
					const phones = parsePhonesFromDb(c.phone);
					return `[${i}] id=${c.id} name="${c.name ?? ''}" emails=[${emails.join(',')}] phones=[${phones.join(',')}] city="${c.city ?? ''}" state="${c.state ?? ''}" country="${c.country ?? ''}"`;
				});

				const systemPrompt = `You are a CRM deduplication assistant. Analyze a list of contacts and identify groups that are likely the same person. Look for:
- Very similar names (typos, abbreviations, first-name-only vs full name)
- Same city/location with similar names
- Any pattern suggesting these are the same person

Reply ONLY with a JSON array. Each element: {"ids":["id1","id2"],"reason":"short explanation"}.
If no duplicates found, reply: []
No other text.`;

				const userPrompt = `Contacts to analyze:\n${contactSummaries.join('\n')}`;

				try {
					const raw = await chatWithLlm(llmProvider, llmModel, apiKey, [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: userPrompt }
					]);
					llmUsed = true;

					// Parse LLM response
					const jsonMatch = /\[[\s\S]*\]/.exec(raw);
					if (jsonMatch) {
						const parsed = JSON.parse(jsonMatch[0]) as Array<{
							ids?: string[];
							reason?: string;
						}>;
						for (const group of parsed) {
							if (!Array.isArray(group.ids) || group.ids.length < 2) continue;
							// Validate all IDs exist and aren't already grouped
							const validIds = group.ids.filter(
								(id) => contactMap.has(id) && !groupedIds.has(id)
							);
							if (validIds.length < 2) continue;
							llmGroups.push({
								reason: `AI: ${group.reason ?? 'Similar contacts'}`,
								confidence: 'medium',
								contacts: validIds
									.map((id) => contactMap.get(id))
									.filter((c): c is ContactRow => c != null)
									.map(toSuggestionContact)
							});
							for (const id of validIds) groupedIds.add(id);
						}
					}
				} catch (err) {
					console.error('LLM merge suggestion error:', err);
					// Continue without LLM results
				}
			}
		}
	}

	return json({
		groups: [...deterministicGroups, ...llmGroups],
		llmUsed
	});
};
