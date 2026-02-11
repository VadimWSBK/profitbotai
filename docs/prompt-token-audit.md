# Prompt & RAG Token Audit

This doc maps where prompt tokens come from and how to reduce them.

## Prompt Sources (Chatwoot)

| Source | Location | Est. tokens | Editable |
|--------|----------|-------------|----------|
| **Role** | `agents.bot_role` (Agent → Train → Role) | 500–3000 | User |
| **Tone** | `agents.bot_tone` | 50–500 | User |
| **Instructions** | `agents.bot_instructions` (Additional instructions) | 50–500 | User |
| **RAG rules** | `agent_rules` (Train → Rules), top 3–5 by similarity | 100–800 | User |
| **Hardcoded Chatwoot rules** | `+server.ts` staticParts | ~400 | Code |
| **Product pricing** | When not DIY | 200–1000 | — |
| **DIY situational** | When DIY flow | 150–350 | Code |
| **Contact block** | Current contact info | 50–150 | — |

**Total typical:** ~1500–6000+ tokens per request. With tool loops, the same system prompt is sent on each step.

---

## Where to Shorten

### 1. Agent config (Role, Tone, Instructions)

**Role** often holds a large block (ROLE, CRM rules, priority order, sales behavior). Consider:

- Move detailed rules to **Train → Rules** (RAG): only relevant rules are retrieved per message.
- Keep Role short: who the bot is in 2–4 sentences.
- Tone: one line (e.g. "Professional, friendly, concise").
- Additional instructions: only rules that always apply; move edge cases to RAG.

**Example trim:**
- Before: 2000+ chars in Role with CRM, priority order, full sales behavior.
- After: "NetZero Coating sales & support assistant. Help with DIY quotes and Done For You installation. Follow rules below." (~100 chars) + put CRM/sales details in RAG rules with tags like `crm`, `sales`.

### 2. RAG rules (Train → Rules)

- **Limit count:** Top 3 rules (Chatwoot + widget). Was 5.
- **Char cap per rule:** 280 chars; longer rules are truncated with "…".
- **Dedupe:** If Role/Instructions restate RAG rules, remove the duplicate.
- **Tags:** Use tags so similar rules can be merged or shortened.

### 3. Hardcoded Chatwoot rules

We consolidated overlapping rules and shortened phrasing. See `staticParts` in the Chatwoot webhook.

---

## Debug: Token estimate by section

With `CHATWOOT_DEBUG=1`, the webhook logs approximate chars per section:

```
[webhooks/chatwoot] promptSections role=2100 tone=80 instructions=50 static=900 rag=450 diy=280 contact=120 total=3980
```

~4 chars ≈ 1 token, so 3980 chars ≈ 995 tokens for system (before messages).

---

## Recommended actions

1. **Review Role** in Agent settings: shorten to identity only; move rules to Train → Rules.
2. **Review RAG rules**: merge similar ones, shorten wording, ensure tags are useful.
3. **Use RAG for variable rules**: CRM, product, pricing, safety rules are good RAG candidates.
4. **Keep Role + Tone + Instructions under ~500 chars combined** for best cost.

---

## Migrating a long Role to Rules

If your Role is >800 chars, split it as follows:

1. **Keep in Role** (2–4 sentences): Who the bot is and its main purpose.
   - Example: "NetZero Coating sales & support assistant. Help with DIY quotes and Done For You installation. Follow the rules below."

2. **Move to Rules** (one rule per topic), with tags:
   - CRM / contact protection → tags: `crm`, `contact`
   - Sales behavior, guiding questions → tags: `sales`, `behavior`
   - Product principles, coverage → tags: `product`, `core`
   - Safety, never invent pricing → tags: `safety`, `accuracy`
   - Tone/formatting details → tags: `tone`, `format`

3. **Copy** each section from Role, paste as a new Rule, add tags, save.

4. **Replace Role** with the compact version (use "Use compact template" in the UI or the example above).

5. **Save** the agent.
