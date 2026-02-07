# Cursor MCP Setup for n8n

## Your .env File Has:
- ✅ `N8N_BASE_URL=https://n8n.srv1309343.hstgr.cloud`
- ✅ `N8N_API_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

## Step 1: Find Cursor MCP Config File

The MCP config file is usually located at:
- **macOS**: `~/.cursor/mcp.json` or `~/Library/Application Support/Cursor/User/globalStorage/mcp.json`
- **Linux**: `~/.cursor/mcp.json` or `~/.config/Cursor/User/globalStorage/mcp.json`
- **Windows**: `%APPDATA%\Cursor\User\globalStorage\mcp.json`

Or check: **Cursor Settings → MCP** (it might show the path)

## Step 2: Add n8n MCP Configuration

Add this to your Cursor MCP config file:

```json
{
  "mcpServers": {
    "n8n": {
      "command": "npm",
      "args": ["run", "mcp:n8n"],
      "cwd": "/Users/vadimw/websites/profitbotai",
      "env": {
        "N8N_BASE_URL": "https://n8n.srv1309343.hstgr.cloud",
        "N8N_API_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5NjMwMWU5Yi02ZTcwLTQ1MzEtYmJkMi00MWQyOTVlNThkNGQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzcwNTAxMjA3fQ.rGpp1vFs5Izc10kac8L8XwbN8eoLqmam32Y_F2jE--I"
      }
    }
  }
}
```

**Important**: Replace the `N8N_API_KEY` value above with your actual API key from line 28 of your `.env` file.

## Step 3: Alternative - Load from .env File

If you prefer to load from `.env` file automatically, you can modify the MCP server to use `dotenv`:

1. Install dotenv-cli:
   ```bash
   npm install --save-dev dotenv-cli
   ```

2. Update `package.json` script:
   ```json
   "mcp:n8n": "dotenv -e .env -- tsx mcp-servers/n8n/index.ts"
   ```

3. Then Cursor config can be simpler (no env vars needed):
   ```json
   {
     "mcpServers": {
       "n8n": {
         "command": "npm",
         "args": ["run", "mcp:n8n"],
         "cwd": "/Users/vadimw/websites/profitbotai"
       }
     }
   }
   ```

## Step 4: Restart Cursor

After adding the config:
1. **Restart Cursor completely** (Quit and reopen)
2. Check **Cursor Settings → MCP Servers**
3. You should see "n8n" listed

## Step 5: Test the Connection

Once connected, you can test by asking Cursor:
- "List my n8n workflows"
- "Show me workflow executions"
- "Execute workflow X"

## Troubleshooting

### "Missing required environment variables"
- Make sure the `env` section in MCP config has both `N8N_BASE_URL` and `N8N_API_KEY`
- Check for typos in the config JSON

### "Cannot find module" or "npm not found"
- Make sure you're in the correct directory (`cwd` path)
- Verify `npm run mcp:n8n` works when run manually in terminal

### "401 Unauthorized"
- Your API key might be invalid or expired
- Generate a new one in n8n: Settings → n8n API → Create API Key

### Config file not found
- Create the file if it doesn't exist
- Make sure the path is correct for your OS
