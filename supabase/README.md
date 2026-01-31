# Supabase migrations & Edge Functions

## Edge Function: create-signed-url

Creates signed URLs for private PDFs in the `roof_quotes` bucket. Used by n8n to get shareable links for emails/chat.

### Deploy

```bash
# Link to your project (first time only)
supabase link --project-ref ghbytxmsklcizlcnxwfq

# Set secret (use same value as SIGNED_URL_API_KEY in your app)
supabase secrets set SIGNED_URL_SECRET=your-secret-key-here

# Deploy (--no-verify-jwt so n8n can call without Supabase auth)
supabase functions deploy create-signed-url --no-verify-jwt
```

### Call from n8n

| Setting | Value |
|---------|-------|
| **Method** | POST |
| **URL** | `https://ghbytxmsklcizlcnxwfq.supabase.co/functions/v1/create-signed-url` |
| **Headers** | `X-API-Key`: your SIGNED_URL_SECRET |
| **Body** | `{ "filePath": "{{ $json.Key }}", "expiresIn": 86400 }` |

If `SIGNED_URL_SECRET` is not set, the function allows unauthenticated calls (less secure).

---

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
