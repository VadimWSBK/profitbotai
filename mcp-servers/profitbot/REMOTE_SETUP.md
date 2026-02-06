# ProfitBot MCP Remote Setup (Vercel)

Since ProfitBot is hosted on Vercel at `app.profitbot.ai`, OpenClaw should connect via HTTP using the HTTP client wrapper.

## Quick Setup

### Step 1: Generate Your MCP API Key

1. Log into ProfitBot at https://app.profitbot.ai
2. Go to **Settings** → **MCP API Keys**
3. Click **Create Key**
4. Copy the API key (starts with `pb_mcp_`)

### Step 2: Configure OpenClaw

Add this to your OpenClaw MCP configuration (`~/.cursor/mcp.json` or similar):

```json
{
  "mcpServers": {
    "profitbot": {
      "command": "npm",
      "args": ["run", "mcp:profitbot:http"],
      "cwd": "/Users/vadimw/websites/profitbotai",
      "env": {
        "MCP_API_KEY": "pb_mcp_your-generated-api-key-here",
        "PROFITBOT_API_URL": "https://app.profitbot.ai"
      }
    }
  }
}
```

**Note:** 
- Replace `/Users/vadimw/websites/profitbotai` with your local project path
- Replace `pb_mcp_your-generated-api-key-here` with your actual API key
- `PROFITBOT_API_URL` is optional (defaults to `https://app.profitbot.ai`)

### Step 3: Restart OpenClaw

Restart OpenClaw/Cursor to load the configuration.

## How It Works

The HTTP client (`http-client.ts`) is a local wrapper that:
1. Runs locally via stdio (what OpenClaw expects)
2. Translates MCP protocol calls to HTTP requests
3. Connects to `https://app.profitbot.ai/api/mcp`
4. Uses your MCP API key for authentication
5. Returns results back to OpenClaw via stdio

## Multi-Tenant Setup

For multiple tenants, create separate entries:

```json
{
  "mcpServers": {
    "profitbot-netzero": {
      "command": "npm",
      "args": ["run", "mcp:profitbot:http"],
      "cwd": "/Users/vadimw/websites/profitbotai",
      "env": {
        "MCP_API_KEY": "pb_mcp_netzero-key-here",
        "PROFITBOT_API_URL": "https://app.profitbot.ai"
      }
    },
    "profitbot-tenant2": {
      "command": "npm",
      "args": ["run", "mcp:profitbot:http"],
      "cwd": "/Users/vadimw/websites/profitbotai",
      "env": {
        "MCP_API_KEY": "pb_mcp_tenant2-key-here",
        "PROFITBOT_API_URL": "https://app.profitbot.ai"
      }
    }
  }
}
```

## Direct HTTP API (Alternative)

If you prefer to call the API directly without the MCP wrapper, you can use the HTTP API at `https://app.profitbot.ai/api/mcp`:

```bash
curl -X POST https://app.profitbot.ai/api/mcp \
  -H "Content-Type: application/json" \
  -H "X-MCP-API-Key: pb_mcp_your-api-key" \
  -d '{"action": "list_leads"}'
```

See [HTTP_CLIENT.md](./HTTP_CLIENT.md) for full API documentation.

## Troubleshooting

### "Missing required environment variable: MCP_API_KEY"
- Make sure `MCP_API_KEY` is set in your MCP config
- Verify the key is correct (starts with `pb_mcp_`)

### Connection errors
- Verify `app.profitbot.ai` is accessible
- Check that the API key hasn't been deleted
- Ensure you're using the correct API key for your workspace

### "Invalid API key"
- Regenerate the key in ProfitBot dashboard
- Make sure you copied the full key
- Verify the key belongs to the correct workspace
