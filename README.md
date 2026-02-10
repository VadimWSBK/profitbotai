# Profitbot AI Dashboard

SvelteKit dashboard for managing customizable chat widgets, with [Supabase](https://supabase.com) for storage and analytics and optional [n8n](https://n8n.io) for chat backends.

## Setup

```bash
npm install
cp .env.example .env   # add Supabase (required) and optional n8n
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Supabase (required)

Widget settings and analytics are stored in Supabase.

1. Create a project at [Supabase](https://supabase.com/dashboard) (e.g. [project ghbytxmsklcizlcnxwfq](https://supabase.com/dashboard/project/ghbytxmsklcizlcnxwfq)).
2. In **Settings → API**, copy the **Project URL** and **anon public** key.
3. In this repo, create a `.env` file:

   ```env
   SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   ```

4. Tables `widgets` and `widget_events` are created via migration (see “Database” below). If you use a new project, run the migration from the Supabase SQL editor or the MCP apply_migration tool.

Without these env vars, the app will fail when listing or saving widgets.

## Database

The app expects these tables (already applied if you used the Supabase MCP):

- **widgets** – `id`, `name`, `display_mode`, `config` (jsonb), `n8n_webhook_url`, `created_at`, `updated_at`
- **widget_events** – `id`, `widget_id` (fk), `event_type`, `session_id`, `metadata` (jsonb), `created_at`
- **widget_documents** – `id`, `widget_id` (fk), `content`, `embedding` (vector 1536), `metadata` (jsonb), `created_at` — for Train Bot / RAG (requires `vector` extension)

RLS is enabled with permissive policies; tighten them when you add auth.

## Train Bot (optional)

Add a knowledge base per widget so n8n can use **Supabase Vector Store** for RAG:

1. Set **OPENAI_API_KEY** in `.env` (used for embeddings; e.g. OpenAI text-embedding-3-small). The app also needs **SUPABASE_SERVICE_ROLE_KEY** (Settings → API in Supabase) so the server can write to `widget_documents`.
2. Run the migration that creates `widget_documents` and enables the `vector` extension (see `supabase/migrations/20260130120000_widget_documents_vector.sql`).
3. In the dashboard, open a widget → **Train Bot** tab: upload PDFs or paste URLs to scrape. Content is chunked, embedded, and stored in Supabase.
4. In n8n, add **Supabase Vector Store** and use **“Retrieve documents for AI Agent as Tool”** with the same Supabase project and table `widget_documents` (filter by `metadata->>'widget_id'` = your widget ID) so the AI Agent can answer from this data.

## Chatwoot (optional)

Connect a Chatwoot Agent Bot to a Profitbot agent so Chatwoot conversations are answered by your AI. In Chatwoot’s **Add Bot** form, set **Webhook URL** to `https://YOUR-PROFITBOT-DOMAIN/api/webhooks/chatwoot`, then configure `CHATWOOT_AGENT_ID`, `CHATWOOT_BOT_ACCESS_TOKEN`, and `CHATWOOT_BASE_URL` in your app. See [docs/chatwoot-setup.md](docs/chatwoot-setup.md).

## n8n (optional)

Use n8n to power chat responses:

1. In the dashboard, open a widget → **Connect** tab and set **n8n Webhook URL** (e.g. from a Webhook node in n8n).
2. The chat widget sends `POST {webhook}` with `{ message, sessionId }` and, when set in **Train Bot** → Bot instructions, `systemPrompt`, `role`, `tone`, and `instructions`. Map `systemPrompt` into your AI Agent node’s system message so the bot follows the configured role and tone. Your workflow can reply with the response body or a field like `output` / `message`.

## Scripts

- `npm run dev` – start dev server
- `npm run build` – production build
- `npm run preview` – preview production build

## Repo

[https://github.com/VadimWSBK/profitbotai](https://github.com/VadimWSBK/profitbotai)
