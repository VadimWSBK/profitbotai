# Quick Start: N8N MCP Server

## 1. Get Your N8N API Key

1. Open your N8N instance
2. Go to **Settings → n8n API**
3. Click **Create API Key**
4. Copy the API key (you'll need it in step 3)

## 2. Set Environment Variables

Add to your `.env` file or export in your shell:

```bash
export N8N_BASE_URL=https://your-n8n-instance.com
export N8N_API_KEY=your-api-key-here
```

## 3. Configure Cursor MCP

Edit `~/.cursor/mcp.json` (or create it if it doesn't exist):

```json
{
  "mcpServers": {
    "n8n": {
      "command": "npm",
      "args": ["run", "mcp:n8n"],
      "cwd": "/Users/vadimw/websites/profitbotai",
      "env": {
        "N8N_BASE_URL": "https://your-n8n-instance.com",
        "N8N_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Important:** Update the `cwd` path to match your actual project directory.

## 4. Restart Cursor

Restart Cursor for the MCP server configuration to take effect.

## 5. Test It

Once configured, you can ask the AI assistant to:
- "List all my N8N workflows"
- "Show me details of workflow XYZ"
- "Execute workflow ABC with this data: {...}"
- "List recent executions for workflow XYZ"

The AI will use the MCP tools automatically!

## Troubleshooting

**Server won't start:**
- Check that `N8N_BASE_URL` and `N8N_API_KEY` are set correctly
- Verify your N8N instance is accessible
- Check Cursor's MCP logs (usually in Cursor's developer console)

**"API error 401":**
- Your API key is invalid or expired
- Generate a new API key in N8N Settings → n8n API

**"API error 404":**
- Check that your `N8N_BASE_URL` is correct (should include protocol: `https://`)
- Verify the N8N instance is running
