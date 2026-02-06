# ProfitBot MCP Server - Quick Start Guide

Get the ProfitBot MCP server running with OpenClaw in 5 minutes.

## Step 1: Get Your Supabase Credentials

1. Go to your Supabase project dashboard
2. Navigate to **Settings → API**
3. Copy:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **service_role** key (⚠️ Keep this secret!)

## Step 2: Set Environment Variables

Create or update your `.env` file in the project root:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

## Step 3: Test the Server

Run the server manually to verify it works:

```bash
npm run mcp:profitbot
```

You should see: `ProfitBot MCP server running on stdio`

Press Ctrl+C to stop it.

## Step 4: Configure OpenClaw

### Option A: Using npm script (Recommended)

Add to your OpenClaw MCP configuration (usually `~/.cursor/mcp.json` or similar):

```json
{
  "mcpServers": {
    "profitbot": {
      "command": "npm",
      "args": ["run", "mcp:profitbot"],
      "cwd": "/Users/vadimw/websites/profitbotai"
    }
  }
}
```

**Note:** Replace `/Users/vadimw/websites/profitbotai` with your actual project path.

### Option B: Using environment variables from .env

If your `.env` file is in the project root, OpenClaw will automatically pick it up:

```json
{
  "mcpServers": {
    "profitbot": {
      "command": "npm",
      "args": ["run", "mcp:profitbot"],
      "cwd": "/Users/vadimw/websites/profitbotai"
    }
  }
}
```

### Option C: Direct command with env vars

```json
{
  "mcpServers": {
    "profitbot": {
      "command": "npx",
      "args": ["tsx", "/Users/vadimw/websites/profitbotai/mcp-servers/profitbot/index.ts"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key"
      }
    }
  }
}
```

## Step 5: Restart OpenClaw

Restart OpenClaw/Cursor to load the new MCP server configuration.

## Step 6: Verify Connection

In OpenClaw, you should now be able to use ProfitBot tools. Try asking:

- "List all widgets in ProfitBot"
- "Show me the analytics for widget [id]"
- "Create a new widget called 'Test Widget'"

## Troubleshooting

### "Missing required environment variables"
- Make sure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set
- Check your `.env` file is in the project root
- Verify the values are correct (no extra quotes or spaces)

### "Failed to start server"
- Check Node.js version: `node --version` (needs 18+)
- Verify Supabase credentials are correct
- Check that the project path in config is absolute and correct

### "Unknown tool" errors
- Restart OpenClaw after configuration changes
- Verify the server starts manually with `npm run mcp:profitbot`
- Check OpenClaw logs for connection errors

## Next Steps

- Read the full [README.md](./README.md) for detailed tool documentation
- Explore all available tools: widgets, agents, team, analytics, contacts, conversations
- Check out the n8n MCP server for workflow automation

## Security Reminder

⚠️ The service role key has full database access. Never:
- Commit it to git
- Share it publicly
- Expose it in client-side code
- Use it in production without proper access controls
