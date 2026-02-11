# Gemini Context Caching Setup

For multi-turn tool loops (e.g. Chatwoot, widget chat), Gemini context caching can reduce input tokens and cost by avoiding re-sending the same system prompt and tools on every request.

## Option 1: Implicit Caching (Already Enabled)

**No setup required.** Gemini 2.5+ and 3.x models automatically cache context when certain conditions are met.

### How it works

- **Minimum tokens**: Gemini 2.5 Flash needs ~1024 input tokens; Gemini 2.5 Pro needs ~4096.
- **Prefix matching**: The model caches based on prompt prefix. Similar prefixes within a short time window = cache hits.
- **Cost**: You may see cost savings; no guarantees. Check `usage_metadata.cachedContentTokenCount` in responses.

### What we've done

The Chatwoot system prompt is ordered for better implicit cache hits:

1. **Static first** (cached): role, tone, instructions, base behavioral rules
2. **Dynamic last** (per request): RAG rules, product pricing, DIY situational instructions, contact info

See `src/routes/api/webhooks/chatwoot/[agentId]/+server.ts` — `staticParts` vs `dynamicParts`.

### Best practices

- Put large, stable content (system instructions, base rules) at the **beginning** of the prompt.
- Put variable content (user-specific, per-turn) at the **end**.
- Send requests with similar prefixes in a short time window for more cache hits.

---

## Option 2: Explicit Caching (Advanced)

Explicit caching gives **guaranteed cost savings** on cached tokens but requires more setup.

### Requirements

- `@google/genai` (newer SDK) — for cache creation. The project uses `@ai-sdk/google` which supports `providerOptions.google.cachedContent`.
- Google provider (llm_provider = 'google')
- Supported model (e.g. `gemini-2.0-flash-001`, `gemini-1.5-flash-001`)

### API constraints

When using `cachedContent`, the Gemini API expects system instruction and tools to be **in the cache**, not in the generate request. The AI SDK currently always sends system + tools; this may conflict with cached content usage. For full explicit caching you may need to call the Gemini API directly or use `@google/genai` for generation when a cache exists.

### Manual setup (reference)

1. **Install** `@google/genai`:

   ```bash
   npm install @google/genai
   ```

2. **Create a cache** (e.g. in a lib, run once per agent or on config change):

   ```ts
   import { GoogleGenAI } from '@google/genai';

   const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

   const cache = await ai.caches.create({
     model: 'gemini-2.0-flash-001',
     config: {
       systemInstruction: 'Your static system prompt here...',
       tools: [/* tool definitions */],
       ttl: '3600s', // 1 hour
       displayName: `agent-${agentId}`,
     },
   });
   // Store cache.name (e.g. cachedContents/xxx) for later use
   ```

3. **Use the cache** with the AI SDK:

   ```ts
   const result = await generateText({
     model: google('gemini-2.0-flash-001'),
     messages: modelMessages,  // Only messages; system + tools from cache
     providerOptions: {
       google: {
         cachedContent: cache.name,  // e.g. 'cachedContents/xxx'
       },
     },
   });
   ```

### Limitations for Chatwoot

- **System prompt is dynamic**: RAG rules, contact info, and situational DIY instructions change per request. For explicit caching you'd need to:
  - Cache only the static part (role, tone, instructions, base rules).
  - Move dynamic parts into the first user message or a "context" message.
- **Tools per agent**: Each agent can have different `allowed_tools`. You'd need one cache per agent (or per tool-set) and cache invalidation when agent config changes.
- **Cache lifecycle**: Caches expire (TTL). You must create/refresh caches and handle expiry.

### When to use explicit caching

- High volume of Chatwoot messages per agent.
- System prompt (static part) is large (>4k tokens for Pro).
- Willing to refactor: split static vs dynamic, manage cache creation/invalidation.

---

## References

- [Gemini Context Caching](https://ai.google.dev/gemini-api/docs/caching)
- [Gemini Caching API](https://ai.google.dev/api/caching)
- [@google/genai Caches](https://googleapis.github.io/js-genai/release_docs/classes/caches.Caches.html)
- [@ai-sdk/google cachedContent](https://www.npmjs.com/package/@ai-sdk/google) — `providerOptions.google.cachedContent`
