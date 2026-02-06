# ProfitBot MCP Server - Quick Start Guide

Get the ProfitBot MCP server running with OpenClaw in 5 minutes.

## Step 1: Generate Your MCP API Key

1. Log into your ProfitBot dashboard
2. Navigate to **Settings** → **MCP API Keys**
3. Click **Create Key**
4. Optionally add a name (e.g., "OpenClaw Production")
5. **Copy the API key immediately** - you won't be able to see it again!

The key will look like: `pb_mcp_abc123def456...`

## Step 2: Set Environment Variables

Create or update your `.env` file in the project root:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
MCP_API_KEY=pb_mcp_your-generated-api-key-here
```

**Where to find these:**
- **SUPABASE_URL**: Supabase dashboard → Settings → API → Project URL
- **SUPABASE_SERVICE_ROLE_KEY**: Supabase dashboard → Settings → API → service_role key (⚠️ Keep secret!)
- **MCP_API_KEY**: Generated in Step 1 above

## Step 3: Test the Server

Run the server manually to verify it works:

```bash
npm run mcp:profitbot
```

You should see: `ProfitBot MCP server running on stdio (workspace: <workspace-id>)`

Press Ctrl+C to stop it.

## Step 4: Configure OpenClaw

### Option A: Using npm script with env vars (Recommended)

Add to your OpenClaw MCP configuration (usually `~/.cursor/mcp.json`):

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

The server will automatically read from your `.env` file.

### Option B: Inline environment variables

```json
{
  "mcpServers": {
    "profitbot": {
      "command": "npm",
      "args": ["run", "mcp:profitbot"],
      "cwd": "/Users/vadimw/websites/profitbotai",
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "MCP_API_KEY": "pb_mcp_your-generated-api-key-here"
      }
    }
  }
}
```

### Option C: Direct command

```json
{
  "mcpServers": {
    "profitbot": {
      "command": "npx",
      "args": ["tsx", "/Users/vadimw/websites/profitbotai/mcp-servers/profitbot/index.ts"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "MCP_API_KEY": "pb_mcp_your-generated-api-key-here"
      }
    }
  }
}
```

## Step 5: Restart OpenClaw

Restart OpenClaw/Cursor to load the new MCP server configuration.

## Step 6: Verify Connection

In OpenClaw, you should now be able to use ProfitBot tools. Try asking:

- "List all leads in the pipeline"
- "Show me conversations for widget [id]"
- "Move lead [id] to stage [stage-id]"
- "Send a message to conversation [id] saying 'Hello!'"

## Multi-Tenant Setup

If you have multiple tenants (e.g., "NetZero Coating" and "Another Company"):

1. **For each tenant:**
   - Log into that tenant's dashboard
   - Generate a separate MCP API key
   - Create a separate MCP server entry in OpenClaw config

2. **Example configuration:**

```json
{
  "mcpServers": {
    "profitbot-netzero": {
      "command": "npm",
      "args": ["run", "mcp:profitbot"],
      "cwd": "/Users/vadimw/websites/profitbotai",
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "MCP_API_KEY": "pb_mcp_netzero-key-here"
      }
    },
    "profitbot-tenant2": {
      "command": "npm",
      "args": ["run", "mcp:profitbot"],
      "cwd": "/Users/vadimw/websites/profitbotai",
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "MCP_API_KEY": "pb_mcp_tenant2-key-here"
      }
    }
  }
}
```

Each tenant gets isolated access - OpenClaw connected to "profitbot-netzero" can only see NetZero's data!

## Troubleshooting

### "Missing required environment variable: MCP_API_KEY"
- Make sure `MCP_API_KEY` is set in your `.env` file or MCP config
- Verify the key is correct (starts with `pb_mcp_`)
- Check for extra spaces or quotes

### "Invalid MCP API key"
- Verify the API key is correct (copy it again from Settings)
- Check that the key hasn't been deleted
- Ensure you're using the key for the correct workspace

### "Failed to start server"
- Check Node.js version: `node --version` (needs 18+)
- Verify all environment variables are set correctly
- Check that the project path in config is absolute and correct
- Ensure Supabase credentials are valid

### "Access denied: resource belongs to different workspace"
- You're trying to access a resource from a different tenant
- Verify you're using the correct MCP API key
- Check that the resource ID belongs to your workspace

### Connection issues with OpenClaw
- Verify the MCP server path is correct
- Check that environment variables are accessible
- Ensure the server starts without errors when run manually
- Restart OpenClaw after configuration changes

## Security Reminder

⚠️ **Important:**
- The service role key has full database access - keep it secure!
- MCP API keys are scoped to one workspace - never share keys between tenants
- Never commit API keys or service role keys to git
- Rotate keys regularly by deleting old ones and creating new ones

## Next Steps

- Read the full [README.md](./README.md) for detailed tool documentation
- Explore all available tools: leadflow, messaging, contacts, widgets
- Check out the n8n MCP server for workflow automation
- Generate separate keys for staging/production environments
