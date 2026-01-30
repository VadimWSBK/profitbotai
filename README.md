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

RLS is enabled with permissive policies; tighten them when you add auth.

## n8n (optional)

Use n8n to power chat responses:

1. In the dashboard, open a widget → **Connect** tab and set **n8n Webhook URL** (e.g. from a Webhook node in n8n).
2. The chat widget sends `POST {webhook}` with `{ message, sessionId }`; your workflow can reply with the response body or a field like `output` / `message`.

## Scripts

- `npm run dev` – start dev server
- `npm run build` – production build
- `npm run preview` – preview production build

## Repo

[https://github.com/VadimWSBK/profitbotai](https://github.com/VadimWSBK/profitbotai)
