# Profitbot AI Dashboard

SvelteKit dashboard for managing widgets, with optional [n8n](https://n8n.io) integration.

## Setup

```bash
npm install
cp .env.example .env   # optional: add N8N_BASE_URL and N8N_API_KEY for n8n
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Connecting to n8n

1. In n8n, create a workflow that exposes a **Webhook** (e.g. GET) returning your widgets, e.g. at `https://your-n8n.com/webhook/widgets`.
2. In this repo, create a `.env` file (see `.env.example`):

   ```env
   N8N_BASE_URL=https://your-n8n-instance.com
   N8N_API_KEY=your-n8n-api-key
   ```

3. The dashboard will call `GET {N8N_BASE_URL}/webhook/widgets` to load the widget list. The response should be:

   ```json
   { "widgets": [ { "id": "...", "name": "...", "tags": ["Standalone", "Popup"], "createdAt": "30th Jan, 2026" } ] }
   ```

4. Restart the dev server after changing `.env`.

Without n8n config, the app runs with sample data.

## Scripts

- `npm run dev` – start dev server
- `npm run build` – production build
- `npm run preview` – preview production build

## Repo

[https://github.com/VadimWSBK/profitbotai](https://github.com/VadimWSBK/profitbotai)
