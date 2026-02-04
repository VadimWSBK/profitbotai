# n8n setup: Vector Store & app tools

## 1. Supabase Vector Store (match_documents)

The **PGRST202 Could not find the function public.match_documents** error is fixed.

- **Migration**: `20260204110000_match_documents_rpc.sql` adds `public.match_documents(filter, match_count, query_embedding)`.
- **Table**: It queries `widget_documents` (content, embedding, metadata). Use **Table Name** = `widget_documents` in n8n.
- **Query name**: In the Supabase Vector Store node options, set **Query Name** to `match_documents` (this is the default).
- **Embedding**: Use the same dimensionality as your table (1536). If using Google Gemini, set **gemini-embedding-001** with **output dimensionality** 1536.

Optional: to restrict results by widget, use **Metadata Filter** in n8n (e.g. `widget_id` = the widget UUID from your chat context).

---

## 2. Implementing app tools in n8n (quotes, tables, checkout links)

Your app already has tools when using **Direct LLM** (search contacts, generate quote, send email, Shopify checkout link, etc.). In n8n you can expose the same behaviour by adding **Tool** nodes that call your app (or Supabase) and wiring them to the AI Agent.

### Flow in n8n

1. **Trigger**: “When chat message received” gives you `sessionId`, `chatInput`, and usually `conversationId`, `widgetId` (from your chat webhook payload).
2. **AI Agent**: Add **Tools** (e.g. “Tool” or “HTTP Request” as tools). Each tool has a **name**, **description**, and **parameters** so the LLM knows when to call it.
3. **Tool execution**: Each tool runs an HTTP request (or Supabase/Code node) and returns a result; the agent uses that in the reply.

### APIs you can call from n8n

Use your app’s base URL (e.g. `https://your-domain.com`) and pass **X-API-Key** where noted (use the same key as `SIGNED_URL_API_KEY` in `.env`).

| Tool / goal              | Method & endpoint                               | Auth        | Body (typical) |
|--------------------------|--------------------------------------------------|------------|----------------|
| **Generate quote PDF**   | POST `/api/quote/generate`                      | X-API-Key  | `widgetId`, `conversationId`, `customer?`, `project?` (see endpoint types) |
| **Update contact**       | PATCH `/api/widgets/{widgetId}/contacts`        | X-API-Key or session | `conversationId`, `name?`, `email?`, `phone?`, `address?`, `roof_size_sqm?` |
| **Send email to contact** | POST `/api/conversations/{conversationId}/send-email` | X-API-Key or session | `subject`, `body` |
| **Append quote to contact** | POST `/api/widgets/{widgetId}/contacts/pdf-quote` | Session only for now | `conversationId` or `email`, `pdfUrl` |

Set header **X-API-Key** to the same value as `SIGNED_URL_API_KEY` in your `.env` when calling from n8n.

### Practical pattern

1. **Quote generation**  
   In n8n add a **Tool** (e.g. “Generate quote”) that:
   - **Description**: e.g. “Generate a Done For You quote PDF. Requires name, email, roof size (sqm) for the current conversation.”
   - **Parameters**: e.g. `roof_size_sqm` (optional if already in contact).
   - **Execution**: HTTP Request to `POST https://your-domain.com/api/quote/generate` with header `X-API-Key: <SIGNED_URL_API_KEY>` and body:
     - `widgetId`: from chat trigger (e.g. `{{ $json.widgetId }}`).
     - `conversationId`: from chat trigger (e.g. `{{ $json.conversationId }}`).
     - Optionally `customer`, `project` if your payload provides them.

2. **Contact data (search / get current contact)**  
   If n8n has **Supabase** credentials (service role or key with access to `contacts`):
   - Add a **Tool** “Get current contact” that runs a Supabase query: get contact by `conversation_id` and `widget_id` (from chat trigger).
   - Add a **Tool** “Search contacts” that runs a Supabase query: filter `contacts` by `widget_id` and name/email (from tool input).

3. **Send email**  
   Use your existing Resend (or other) integration in n8n, or call your app’s send-email endpoint if you add API key auth for it. The logic is in `sendContactEmail`; from n8n you’d pass conversation/contact identifiers and email content.

4. **Checkout link / tables**  
   These are implemented in your app via Shopify + product pricing. Options:
   - **Option A**: In n8n, add a **Tool** that calls an internal HTTP endpoint (if you add one) that returns checkout URL or product table using your existing Shopify/product-pricing logic.
   - **Option B**: Replicate the logic in n8n with a **Code** or **HTTP Request** node that uses Supabase (e.g. `product_pricing`) and Shopify API (if you store Shopify config in DB or env), then return the link or table as the tool result.

### Passing context from the chat trigger

The chat widget sends only these fields in the webhook body to n8n:

- `message` – user message
- `sessionId` – session id
- `widgetId` – widget UUID (so n8n can call quote/contacts APIs)
- `conversationId` – conversation UUID (get/create via `/api/widgets/[id]/conversation` before sending to n8n)

**Role, tone, instructions (system prompt)** are not sent in the body. n8n can load them from Supabase: query `widgets` by `id` = `widgetId`, then use `config->bot->role`, `config->bot->tone`, `config->bot->instructions`; or if the widget uses an agent, query `agents` and use `system_prompt`, `bot_role`, `bot_tone`, `bot_instructions`. Build the AI Agent system prompt from those fields in n8n (e.g. with a Supabase node before the Agent, or in the Agent’s system message).

In n8n, the "When chat message received" trigger exposes the webhook body. Use expressions like:

- `{{ $json.widgetId }}`
- `{{ $json.conversationId }}`

If your trigger nests the body (e.g. under `body` or `chatInput`), use the path that matches your trigger output, e.g. `{{ $json.body.widgetId }}` or `{{ $json.chatInput }}` for the message only. Check the trigger’s **INPUT** panel to see the exact keys (e.g. `sessionId`, `action`, `chatInput`, `widgetId`, `conversationId`).

**If `widgetId` or `conversationId` are still undefined in n8n:**

1. Deploy the app so the widget sends the new fields (see code change in `ChatWindow.svelte`).
2. Test from the real chat embed (or a real browser session), not from n8n’s “Test workflow” with a manual payload.
3. In n8n, open the “When chat message received” node and look at **INPUT** / **Output** after a real message: confirm that `widgetId` and `conversationId` appear in the JSON. If your trigger uses a different structure (e.g. all body fields under `body`), use that path in expressions (e.g. `{{ $json.body.widgetId }}`).

Contacts and send-email accept **X-API-Key** (same as `SIGNED_URL_API_KEY`). Use the admin client when auth is API key so RLS does not block the request.

---

## 3. Sending the AI reply back to the chat widget

There is **no separate callback URL**. The widget sends a single POST to your n8n webhook and **waits for that same HTTP response** to display the bot message. n8n must **respond to that request** with the AI’s reply.

### What to do in n8n

1. **Connect the AI Agent’s output to a response**  
   The “When chat message received” trigger holds the HTTP request open until the workflow responds. Connect the **AI Agent** node’s output to a **Respond to Webhook** node (or your trigger’s “Respond” / response option, if it has one).

2. **Respond to Webhook node**  
   Add a **Respond to Webhook** node after the AI Agent. In it:
   - **Respond With**: e.g. “JSON” or “First Incoming Item”.
   - **Response Body**: the text you want shown in the chat. The widget looks for a string in this order: `output`, then `message`, then `reply`, then `text`.  
   - So either set the response body to a JSON object with one of those keys, e.g.  
     `{ "output": "{{ $json.output ?? $json.message ?? $json.text }}" }`  
     or, if the Agent node outputs the reply in a field like `output` or `message`, map that into the response (e.g. `{ "output": "{{ $json.output }}" }`).

3. **Exact format the widget expects (JSON response)**  
   For a non-streaming JSON response, the widget uses the first of these that exists: `data.output`, `data.message`, `data.reply`, `data.text`. So a minimal valid response is:  
   `{ "output": "Here is the reply from the AI." }`

If you use **Respond to Webhook** and the AI Agent’s output item has the reply in a field (often `output` or `message`), set the response body to:

```json
{ "output": "{{ $json.output }}" }
```

(or the correct field name from your Agent node’s output). Then the widget will show that string in the chat.

### Streaming (optional)

The widget also supports streaming: if the response has a non-JSON `Content-Type` and a body (e.g. SSE with `data: ...` lines or plain text), it will append chunks to the message as they arrive. For most setups, returning JSON with `output` is enough.

---

## Summary

- **Vector store**: Use table `widget_documents` and query name `match_documents`; embedding dimension 1536 (e.g. Gemini with output dimensionality 1536).
- **Tools in n8n**: Add Tool nodes that call `POST /api/quote/generate` (with X-API-Key), Supabase for contacts, and (optionally) your send-email and checkout endpoints once they accept X-API-Key. Pass `widgetId` and `conversationId` from the chat trigger into every tool call.
- **Response**: The widget waits for the webhook’s HTTP response (no separate callback). Add a **Respond to Webhook** node connected to the AI Agent output, and return JSON with `{ "output": "..." }` (or `message` / `reply` / `text`) so the chat can display the reply.
