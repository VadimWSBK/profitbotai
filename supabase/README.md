# Supabase migrations

## Tables

- **widgets** – Widget settings (name, display_mode, config JSON, n8n_webhook_url, timestamps)
- **widget_events** – Analytics events (widget_id, event_type, session_id, metadata, created_at)

## Run the migration

### Option 1: Supabase Dashboard (SQL Editor)

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. Go to **SQL Editor**.
3. Copy the contents of `migrations/20260130000000_create_widgets_and_analytics.sql`.
4. Paste and click **Run**.

### Option 2: Supabase MCP (Cursor)

If you have the Supabase MCP connected in Cursor, you can run the migration via the MCP **apply_migration** tool with the same SQL.

### Option 3: Supabase CLI

If the project is linked to Supabase CLI:

```bash
supabase db push
# or
supabase migration up
```
