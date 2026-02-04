# n8n setup: Vector Store & app tools

## 1. Supabase Vector Store (match_documents)

The **PGRST202 Could not find the function public.match_documents** error is fixed.

- **Migration**: `20260204110000_match_documents_rpc.sql` adds `public.match_documents(filter, match_count, query_embedding)`.
- **Table**: It queries `widget_documents` (content, embedding, metadata). Use **Table Name** = `widget_documents` in n8n.
- **Query name**: In the Supabase Vector Store node options, set **Query Name** to `match_documents` (this is the default).
- **Embedding**: Use **768 dimensions** (Supabase tables use `vector(768)`). In n8n use the default Embeddings Google Gemini model (e.g. `text-embedding-004` or `gemini-embedding-001`), which outputs 768 by default—no dimension setting needed.

Optional: to restrict results by widget, use **Metadata Filter** in n8n (e.g. `widget_id` = the widget UUID from your chat context).

**Note:** All vector columns use **768 dimensions** (migration `20260204210000_vector_768_dimensions.sql`). This matches the default output of n8n’s Embeddings Google Gemini node, so you don’t need to set a dimension option there.

---

## 1b. Agent rules (RAG) from Supabase

Your **Instructions / rules (RAG)** are stored in the `agent_rules` table (one rule per row, with `content`, `embedding`, `tags`, `agent_id`). The n8n agent can use them as a second vector store so the AI gets relevant rules at chat time.

- **Migration**: `20260204200000_match_agent_rules_for_n8n.sql` adds `public.match_agent_rules_documents(filter, match_count, query_embedding)` with the same signature as `match_documents`.
- **Table**: In n8n add a **second** Supabase Vector Store (or use this instead of `widget_documents` if you only need rules). Set **Table Name** = `agent_rules`.
- **Query name**: Set **Query Name** to `match_agent_rules_documents`.
- **Embedding**: Same as above — **768 dimensions** (default for Gemini embedding models in n8n).
- **Metadata filter**: The RPC filters by `agent_id`. In the Vector Store node set **Metadata Filter** so that `agent_id` equals the agent UUID. The chat widget sends `agentId` in the webhook body when the widget uses an agent — use **`{{ $json.agentId }}`** (or the path your trigger exposes, e.g. `{{ $json.body.agentId }}`).

The widget now includes **`agentId`** in the webhook payload when the widget is configured with an agent, so n8n can pass it into the Vector Store metadata filter and only relevant rules for that agent are retrieved.

**How retrieval works:** Rules are retrieved by **semantic similarity** between the user message (or query) and each rule’s **content**. Tags are stored in metadata for organization but are not used as filters in the RPC — so the agent gets rules whose *text* is relevant to what the user said (e.g. “quote” messages pull in quote-flow rules).

**Making the agent use rules before the quote tool:** Your agent_rules contain quote-flow instructions (what to ask before generating a quote, contact collection, roof size extraction). To make the AI consistently **retrieve** those rules when the user asks for a quote (and follow them before calling the quote tool):

1. **System prompt** — add one line, e.g.:  
   *“Before using the quote generation tool, retrieve relevant instructions from the knowledge base so you follow the correct flow (e.g. what to ask, when to send a quote link, contact collection). Only call the quote tool after following those instructions.”*

2. **Vector Store tool description** (in the Supabase Vector Store node) — make it clear the store holds instructions and flows, not only product facts. Example:  
   *“Retrieve instructions and rules for the current topic. Use this when the user asks for a quote, product details, or contact/roof-size collection — so you follow the correct flow (what to ask, when to send a quote link, how to extract roof size) before calling any tools.”*

Then the agent will treat “user asked for a quote” as a signal to call the knowledge-base tool first and apply your quote/collection rules.

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
| **Get current contact**  | GET `/api/widgets/{widgetId}/contacts?conversationId={id}` | X-API-Key or session | — |
| **Get product pricing**  | GET `/api/widgets/{widgetId}/product-pricing`   | X-API-Key or session | — |
| **Generate quote PDF**   | POST `/api/quote/generate`                      | X-API-Key  | `widgetId`, `conversationId`, `customer?`, `project?` (see endpoint types) |
| **Update contact**       | PATCH `/api/widgets/{widgetId}/contacts`        | X-API-Key or session | `conversationId`, `name?`, `email?`, `phone?`, `address?`, `street_address?`, `city?`, `state?`, `postcode?`, `country?`, `roof_size_sqm?` |
| **Send email to contact** | POST `/api/conversations/{conversationId}/send-email` | X-API-Key or session | `subject`, `body` |
| **Append quote to contact** | POST `/api/widgets/{widgetId}/contacts/pdf-quote` | Session only for now | `conversationId` or `email`, `pdfUrl` |
| **Create DIY checkout**    | POST `/api/widgets/{widgetId}/diy-checkout`       | X-API-Key or session | `conversationId?`, `roof_size_sqm?`, `count_15l?`, `count_10l?`, `count_5l?`, `discount_percent?`, `email?` |
| **Create discount**        | POST `/api/widgets/{widgetId}/create-discount`    | X-API-Key or session | `discount_percent` (10 or 15) |

Set header **X-API-Key** to the same value as `SIGNED_URL_API_KEY` in your `.env` when calling from n8n.

**Quote download link in chat (avoid "signature verification failed")**  
The API returns a long `pdfUrl` (Supabase signed URL with a JWT). If that URL is passed through n8n → AI → chat, it can get **truncated**, so the user gets "InvalidJWT / signature verification failed" when opening it. Use the **short download link** instead: have the AI share  
`https://app.profitbot.ai/api/quote/download?path=<fileName>`  
where `<fileName>` is the `fileName` from the quote generate response (e.g. `a82d5354-.../quote_Customer_20260204195252.pdf`). URL-encode the path if needed. When the user clicks, the app redirects to a fresh signed URL so the link always works.

**Show the link as a hyperlink ("Download Quote")**  
In the AI Agent’s **System Message** (or instructions), add something like:  
*"When you share a quote download link, always use this Markdown format so it appears as a hyperlink: [Download Quote](URL). For the URL use the short link: https://app.profitbot.ai/api/quote/download?path= plus the fileName from the quote tool result (URL-encode the fileName, e.g. replace / with %2F). Example: [Download Quote](https://app.profitbot.ai/api/quote/download?path=conv-id%2Fquote_Customer_20260204195252.pdf). Never paste the long pdfUrl in the message."*  
The chat widget renders Markdown, so `[Download Quote](url)` will show as a clickable “Download Quote” link.

### Practical pattern

1. **Quote generation**  
   In n8n add a **Tool** (e.g. “Generate quote”) that:
   - **Description**: e.g. “Generate a Done For You quote PDF. Requires name, email, roof size (sqm) for the current conversation.”
   - **Parameters**: e.g. `roof_size_sqm` (optional if already in contact).
   - **Execution**: HTTP Request to `POST https://your-domain.com/api/quote/generate` with header `X-API-Key: <SIGNED_URL_API_KEY>` and body:
     - `widgetId`: from chat trigger (e.g. `{{ $json.widgetId }}`).
     - `conversationId`: from chat trigger (e.g. `{{ $json.conversationId }}`).
     - Optionally `customer`, `project` if your payload provides them.

2. **Contact and product pricing (so the AI has current contact + Shopify/product pricing)**  
   Add **Tools** that call your app (no Supabase node needed in n8n):
   - **Get current contact** — **Tool** with **HTTP Request** GET  
     `https://your-domain.com/api/widgets/{{ $json.widgetId }}/contacts?conversationId={{ $json.conversationId }}`  
     and header `X-API-Key: <SIGNED_URL_API_KEY>`. Returns `{ contact: { name, email, phone, address, roofSizeSqm, ... } }` or `{ contact: null }`.  
     *Description for AI:* e.g. "Get the current contact for this conversation (name, email, phone, address, roof size). Use before asking for details or generating a quote so you only ask for missing info."
   - **Get product pricing** — **Tool** with **HTTP Request** GET  
     `https://your-domain.com/api/widgets/{{ $json.widgetId }}/product-pricing`  
     and header `X-API-Key: <SIGNED_URL_API_KEY>`. Returns `{ products: [ { name, sizeLitres, price, currency, coverageSqm }, ... ] }` (DIY bucket sizes and prices).  
     *Description for AI:* e.g. "Get current DIY product pricing (bucket sizes, prices, coverage in m²). Use when calculating a DIY quote or when the user asks about pricing."
   - **Update contact** — **Tool** with **HTTP Request** PATCH  
     `https://your-domain.com/api/widgets/{{ $json.widgetId }}/contacts`  
     and header `X-API-Key: <SIGNED_URL_API_KEY>`. Body can include: `conversationId` (required), and any of `name`, `email`, `phone`, `address` (single line), or **split address**: `street_address`, `city`, `state`, `postcode`, `country`, plus `roof_size_sqm`. Only include fields you want to set; empty values are ignored.  
     *Description for AI:* e.g. "Update the current contact. When the user gives an address, save it in the correct columns: street_address (street and number), city, state, postcode, country. Also accept name, email, phone, roof_size_sqm. Call as soon as the user provides any of these; use Get current contact first to avoid overwriting with empty values."  
   The **vector store** is for agent rules (RAG). Contact and pricing are **structured data** — the AI gets them by calling these tools when needed.

3. **Send email (using the ProfitBot user's email client)**  
   The app has an endpoint that sends email via the Resend account connected in **Settings → Integrations** for the widget owner. n8n can call it so the AI can send emails (quote link, follow-up, etc.) without configuring Resend in n8n.
   - **Tool** (e.g. "Send email"): **HTTP Request** POST  
     `https://app.profitbot.ai/api/conversations/{{ $json.conversationId }}/send-email`  
     with header `X-API-Key: <SIGNED_URL_API_KEY>` and JSON body: `{ "subject": "...", "body": "..." }`.
   - The recipient is the **contact for that conversation** (the app looks up the contact by `conversationId` and uses their email). The email is sent using the widget owner's Resend integration and stored in contact_emails for the Messages view.
   - **Requirements:** The ProfitBot user must have Resend connected in Integrations and set a "From email" on a verified domain when sending to customers.

**Send email tool – paste into n8n**

- **Tool name:** `Send email`
- **Description:** Send an email to the current contact for this conversation. Use when the customer asks to receive something by email (e.g. quote link, follow-up, summary). Pass the conversation ID from the chat trigger, and provide subject and body (plain text or simple HTML). The email is sent using the ProfitBot user's connected Resend account to the contact's email for this conversation. Get the contact first if you need their name for the body.
- **URL:** `https://app.profitbot.ai/api/conversations/{{ $json.conversationId }}/send-email`
- **Method:** POST  
- **Headers:** `X-API-Key`: your `SIGNED_URL_API_KEY`
- **Body (JSON):** In the HTTP Request node:
  1. Set **Send Body** = ON
  2. Set **Body Content Type** = `JSON`
  3. Set **Specify Body** = `Using JSON`
  4. Click the **fx** (expression) button next to the JSON field
  5. Enter this expression (not as a string, but as an expression that evaluates to JSON):
     ```javascript
     {
       "subject": $json.subject || "",
       "body": $json.body || ""
     }
     ```
     Or if your subject/body come from a different node's output, use the correct path (e.g. `$json["Send email"].subject` or `$json["AI Agent"].subject`).
  
  **Important:** The JSON field must be an **expression** (click fx), not a string literal. If you see "JSON parameter needs to be valid JSON" error, you're entering it as a string. Use the expression editor (fx button) and enter the object directly without quotes around the whole thing.

4. **DIY checkout: table with product images + “GO TO CHECKOUT” button**  
   To show the same breakdown as the direct LLM (product table with images, summary, and button), add a **Tool** that calls the app’s DIY checkout API, then have **Respond to Webhook** return both the reply text and the **checkoutPreview** object so the widget can render it.
   - **Tool** (e.g. “Create DIY checkout”): **HTTP Request** POST  
     `https://your-domain.com/api/widgets/{{ $json.widgetId }}/diy-checkout`  
     with header `X-API-Key: <SIGNED_URL_API_KEY>` and JSON body:
     - `conversationId` (optional, from chat trigger) – used to pre-fill contact email
     - `roof_size_sqm` (optional) – roof size in m²; app calculates bucket counts (1L covers 2 m²)
     - Or explicit counts: `count_15l`, `count_10l`, `count_5l`
     - `discount_percent` (optional, e.g. 10 or 15)
     - `email` (optional)
   - The API returns `{ checkoutUrl, lineItemsUI, summary }`. In your **Respond to Webhook** node, return JSON in this form so the widget shows the table and button:
     ```json
     {
       "output": "Here is your one-click checkout for your 100 m² roof:",
       "checkoutPreview": {
         "lineItemsUI": <paste lineItemsUI from the tool response>,
         "summary": <paste summary from the tool response>,
         "checkoutUrl": <paste checkoutUrl from the tool response>
       }
     }
     ```
   - So: run the DIY checkout tool, then in the node that builds the webhook response set **output** to your intro text and **checkoutPreview** to the full object returned by the tool (e.g. `{{ $json.lineItemsUI }}`, `{{ $json.summary }}`, `{{ $json.checkoutUrl }}` from the HTTP Request node). The chat widget will render the product table with images and the “GO TO CHECKOUT” button.

5. **Create discount (10% or 15%)**  
   When the customer asks for a discount, the AI can call this tool first, then use the same percentage when calling the DIY checkout.
   - **Tool** (e.g. “Create discount”): **HTTP Request** POST  
     `https://app.profitbot.ai/api/widgets/{{ $json.widgetId }}/create-discount`  
     with header `X-API-Key: <SIGNED_URL_API_KEY>` and JSON body: `{ "discount_percent": 10 }` or `{ "discount_percent": 15 }`.
   - The API returns `{ discountPercent, code, message }` (e.g. `code` is `CHAT10` or `CHAT15`). Tell the customer the discount is applied and use the same `discount_percent` when you call the DIY checkout tool so the checkout link includes the discount.

**Create discount tool – paste into n8n**

- **Tool name:** `Create discount`
- **Description:** Create a 10% or 15% discount for the customer. Use when the customer asks for a discount. Pass `discount_percent` 10 for a first request, or 15 if they ask for more. Returns a code (CHAT10 or CHAT15) and a message to tell the customer. You must then use the same discount_percent when calling the Create DIY checkout tool so the checkout link includes the discount.
- **URL:** `https://app.profitbot.ai/api/widgets/{{ $json.widgetId }}/create-discount`
- **Method:** POST  
- **Headers:** `X-API-Key`: your `SIGNED_URL_API_KEY`
- **Body (JSON):** `{ "discount_percent": "{{ $json.discount_percent }}" }` (use 10 or 15)

**So the AI uses discount first, then DIY checkout**  
Add this to your **System Message** (or agent instructions in ProfitBot) so the AI always does the right order:

*When the customer asks for a discount: first call the Create discount tool with discount_percent 10 (or 15 if they ask for more). Tell them the discount is applied (e.g. mention the code CHAT10 or CHAT15). When they then ask for their checkout link or DIY quote, call the Create DIY checkout tool and pass the same discount_percent (10 or 15) so the checkout link includes the discount. Never create a DIY checkout with a discount unless you have already called Create discount with that percentage in this conversation.*

### Passing context from the chat trigger

The chat widget sends these fields in the webhook body to n8n:

- `message` – user message
- `sessionId` – session id
- `widgetId` – widget UUID (so n8n can call quote/contacts APIs)
- `conversationId` – conversation UUID (get/create via `/api/widgets/[id]/conversation` before sending to n8n)
- `agentId` – agent UUID when the widget uses an agent (required for agent_rules Vector Store metadata filter)
- `systemPrompt` – when the widget uses an agent, this is the **agent’s** system prompt (editable per agent in Edit Agent → Train Bot, stored in Supabase). Otherwise it’s built from the widget’s bot role/tone/instructions. n8n uses this as the System Message.

So n8n can use **System Message** = `{{ $json.systemPrompt }}` with no Supabase node. Optionally you can still load from Supabase if you prefer (see below).

**What is the system prompt?**  
The app sends a **single** system prompt string: it is the combination of the agent’s **Role** + **Tone** + **Additional instructions** from Edit Agent → Train Bot (and any legacy System prompt field if set). So all three (Role, Tone, Additional instructions) are always combined into one `systemPrompt` that n8n receives. Put discount/checkout rules in **Additional instructions** (e.g. “When the customer asks for a discount, first call Create discount with 10 or 15, then use the same percentage when calling Create DIY checkout”).

In n8n, the "When chat message received" trigger exposes the webhook body.

---

### Prompt and system message in the AI Agent

**Most efficient: send role, tone, instructions with each message**  
The widget sends `systemPrompt` (and optionally `role`, `tone`, `instructions`) in the webhook body. n8n needs no extra nodes and no Supabase read per message. In the AI Agent, set **System Message** to `{{ $json.systemPrompt }}` (or build from `{{ $json.role }}`, `{{ $json.tone }}`, `{{ $json.instructions }}`). This is the default and the simplest.

**Alternative: Supabase “Get a row”**  
Use a Supabase node + Merge when you prefer not to send prompt text from the widget (e.g. very long system prompt, or you want a single source of truth only in the DB). Cost: one extra Supabase read and more workflow nodes per message.

**Not recommended: vector store for system prompt**  
The vector store is for RAG: “retrieve documents relevant to this query.” Role/tone/instructions are the same for every message in that widget — they’re static context, not something you search by similarity. Using the vector store for that would mean an extra embed + vector search every message just to fetch one fixed block of text, plus keeping that doc in sync when you edit the bot in the dashboard. Use the vector store for knowledge-base docs (e.g. `widget_documents`); keep system prompt in the message body or in a single Supabase row.

---

**Step-by-step: AI Agent node (when the widget sends systemPrompt)**

1. **Prompt (User Message)**  
   Set to **`{{ $json.message }}`** (not `chatInput` — the widget sends the user text in `message`). This fixes the “No prompt specified” error.

2. **System Message**  
   In the AI Agent node, open **Options** (or the section that has “System Message”, “Instructions”, or “System prompt”). Set it to **`{{ $json.systemPrompt }}`**.  
   Your trigger receives `systemPrompt` from the widget (combined role + tone + instructions). The widget no longer sends `role`, `tone`, or `instructions` separately.

3. Save the node and run again; the agent will use the user message and your Gaz persona.

**1. User message (prompt)**  
The widget sends the user’s text in **`message`**, not `chatInput`. In the AI Agent node, set **Prompt (User Message)** to:

- `{{ $json.message }}`

If your trigger puts the body under another key (e.g. `body`), use e.g. `{{ $json.body.message }}`. Do **not** use `chatInput` unless your trigger actually outputs that field.

**2. System prompt (role, tone, instructions)** — alternative: load from DB  
Use a **Supabase node between the chat trigger and the AI Agent** to load the prompt, then pass it into the Agent. Do **not** add this as a tool — tools are for actions the AI chooses (e.g. quote, search); the system prompt is fixed context.

**Flow:** When chat message received → **Supabase “Get a row”** (or get widget + optional agent) → **Merge** (so the Agent gets both the trigger payload and the Supabase row) → AI Agent.

**Supabase “Get a row”:**

- **Table:** `widgets`
- **Filter:** Column `id` equals `{{ $json.widgetId }}` (from the trigger).
- The row’s `config` is JSONB: use `config->bot->role`, `config->bot->tone`, `config->bot->instructions` to build the system message.

If the widget uses an **agent** (e.g. `config.agentId`), get the widget row first, then get the **agents** row where `id` = that `config.agentId`, and use `system_prompt`, `bot_role`, `bot_tone`, `bot_instructions` from the agent row.

**Merge:** Use a **Merge** node (e.g. “Combine by position”) so one item contains both the trigger fields (`message`, `widgetId`, `conversationId`) and the Supabase fields (`config` or agent columns). Connect the trigger branch and the Supabase branch into the Merge, then connect the Merge output to the AI Agent.

**In the AI Agent:**

- **Prompt (User Message):** `{{ $json.message }}` (from the merged item).
- **System Message** (or **Options** → **System Message**): build from the merged item, e.g.  
  `{{ $json.config.bot.role ?? '' }}\n\nTone: {{ $json.config.bot.tone ?? '' }}\n\n{{ $json.config.bot.instructions ?? '' }}`  
  (if you fetched the widget row and merged it; adjust keys if you merged the agent row instead).

Result: the Agent receives the user message and the Supabase-backed system prompt every time, without using a tool.

Use expressions like:

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

### Reply not showing in real time / “Message could not be send” / only appears after refresh

If n8n shows success but the reply doesn’t appear in the chat (or you see “Ooop. Message could not be send.” and it only shows up after refresh), the browser is usually getting the **wrong** HTTP response:

- The **“When chat message received”** node must **not** send the response itself. It must wait for your **Respond to Webhook** node to send it.
- In the **“When chat message received”** (chat trigger) node, open its settings and set **Respond** (or “Response” / “Webhook Response”) to **“Using Respond to Webhook Node”** (or “When last node finishes” / “Using ‘Respond to Webhook’ node”, depending on your n8n version). Do **not** use “Immediately” or “When trigger is called”.
- Then the same HTTP request is only completed when the workflow reaches **Respond to Webhook** with the AI reply. The widget will receive that response and show it straight away.
- Also ensure **Respond to Webhook** returns JSON with an **`output`** key (e.g. `{ "output": "{{ $json.output }}" }`) so the widget can read it.

### Error handling: Show human-friendly messages instead of technical errors

When something goes wrong in your workflow (API call fails, tool error, etc.), you want to show a friendly message to the user, not technical error details.

**Best practice: Always return 200 status with a friendly error message**

1. **Wrap your workflow in error handling:**
   - Add a **Try-Catch** node (or use n8n's built-in error handling) around your AI Agent and tools
   - When an error occurs, catch it and return a friendly message instead of letting n8n return a 500 error

2. **Example workflow structure:**
   ```
   When chat message received
   → Try node (or AI Agent with error handling)
     → AI Agent
     → Tools (HTTP Request nodes, etc.)
   → Catch node (on error)
     → Set friendly error message
     → Respond to Webhook with: { "output": "I apologize, but I'm having trouble processing your request right now. Please try again in a moment." }
   → Respond to Webhook (on success)
     → { "output": "{{ $json.output }}" }
   ```

3. **In your Respond to Webhook node (success path):**
   - Always return **HTTP 200** status (even if there was a logical error)
   - Return JSON with `output` field containing a user-friendly message:
     ```json
     {
       "output": "{{ $json.output ?? 'I apologize, but I encountered an issue. Please try again.' }}"
     }
     ```

4. **For tool errors specifically:**
   - If a tool (HTTP Request) fails, catch the error in n8n
   - Return a friendly message like: `"I'm having trouble accessing that information right now. Could you please try again?"`
   - **Never** return the raw error message (e.g. "HTTP 500", "Connection refused", "Invalid JSON")

5. **Example: Error handling for Send Email tool**
   - If the email API call fails, catch the error
   - Return: `{ "output": "I apologize, but I couldn't send the email right now. Please try again later or contact us directly." }`
   - Don't return: `{ "error": "Failed to send email: Connection timeout" }`

**Why this matters:** The chat widget will show whatever is in the `output` field. If you return a 500 error or include technical error details, users will see those instead of a helpful message. Always return 200 with a friendly `output` message, even when something goes wrong.

---

## Summary

- **Vector store**: Use table `widget_documents` and query name `match_documents`; embedding **768 dimensions** (Gemini default in n8n). For **agent rules (RAG)** add a second Vector Store: table `agent_rules`, query name `match_agent_rules_documents`, metadata filter `agent_id` = `{{ $json.agentId }}`.
- **Tools in n8n**: Add Tool nodes that call `POST /api/quote/generate`, `GET /api/widgets/{id}/contacts`, `GET /api/widgets/{id}/product-pricing`, `POST /api/conversations/{id}/send-email`, `POST /api/widgets/{id}/create-discount` (10% or 15%), and `POST /api/widgets/{id}/diy-checkout` for quote, contact, pricing, email, discount, and one-click checkout. Pass `widgetId` and `conversationId` from the chat trigger; use header `X-API-Key` (same as `SIGNED_URL_API_KEY`). Base URL: **https://app.profitbot.ai**.
- **Response**: The widget waits for the webhook’s HTTP response (no separate callback). Add a **Respond to Webhook** node and return JSON with `{ "output": "..." }` (or `message` / `reply` / `text`). To show the **DIY checkout table with product images and “GO TO CHECKOUT” button**, also include `checkoutPreview: { lineItemsUI, summary, checkoutUrl }` in the same response (from the diy-checkout tool result).

---

## 4. Messages menu and n8n history

When a widget uses n8n, chat messages are stored in **n8n’s Postgres Chat Memory** (table `n8n_chat_histories`, keyed by `session_id`). The app’s **Messages** menu (conversation list and thread view) now uses that same source for those conversations:

- Opening a conversation whose widget has an n8n webhook URL loads chat messages from **`n8n_chat_histories`** (by `session_id`) instead of `widget_conversation_messages`.
- **Polling** (e.g. every 3s) with `since=<last message time>` returns new messages as n8n appends them, so new replies show in the Messages view without refresh.

Ensure n8n is configured to use **Postgres Chat Memory** pointing at your Supabase project and that the table name is `n8n_chat_histories` (or matches what your n8n workflow uses). The widget’s get-or-create conversation call still creates a row in `widget_conversations` so the conversation appears in the list; only the message body is read from n8n’s table.
