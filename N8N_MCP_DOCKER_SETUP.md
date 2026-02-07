# Setting Up n8n MCP Connection (Docker)

## Option 1: Connect to Docker Container (Recommended)

If you're running the n8n MCP server in Docker, configure Cursor to connect to it:

### Step 1: Find Your Docker Container

```bash
docker ps | grep n8n-mcp
```

Note the container name or ID.

### Step 2: Configure Cursor MCP Settings

Add this to your Cursor MCP configuration file (usually `~/.cursor/mcp.json` or check Cursor Settings → MCP):

**If using Docker exec:**
```json
{
  "mcpServers": {
    "n8n": {
      "command": "docker",
      "args": ["exec", "-i", "your-n8n-mcp-container-name", "node", "/path/to/index.js"],
      "env": {
        "N8N_BASE_URL": "https://your-n8n-instance.com",
        "N8N_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**If exposing via network (better approach):**
```json
{
  "mcpServers": {
    "n8n": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "mcp/n8n"],
      "env": {
        "N8N_BASE_URL": "https://your-n8n-instance.com",
        "N8N_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Option 2: Use Local npm Script (Simpler)

If you prefer to run it locally instead of Docker:

### Step 1: Add to Cursor MCP Config

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

### Step 2: Get Your n8n API Key

1. Go to your n8n instance
2. Settings → n8n API → Create API Key
3. Copy the API key

### Step 3: Update Environment Variables

Replace:
- `https://your-n8n-instance.com` with your actual n8n URL (e.g., `https://n8n.srv1309343.hstgr.cloud`)
- `your-api-key-here` with your actual API key

## Option 3: Use Docker Compose (If You Have docker-compose.yml)

If you have a docker-compose setup, you can expose the MCP server:

```yaml
services:
  n8n-mcp:
    image: mcp/n8n
    environment:
      - N8N_BASE_URL=${N8N_BASE_URL}
      - N8N_API_KEY=${N8N_API_KEY}
    stdin_open: true
    tty: true
```

Then configure Cursor to connect via docker-compose exec.

## Verify Connection

After configuring, restart Cursor and check:
1. Cursor Settings → MCP Servers
2. You should see "n8n" listed
3. Try using MCP tools like `list_workflows` or `execute_workflow`

## Troubleshooting

### "Connection refused" or "Cannot connect"
- Make sure Docker container is running: `docker ps`
- Check container logs: `docker logs your-container-name`
- Verify environment variables are set correctly

### "Missing N8N_BASE_URL or N8N_API_KEY"
- Make sure env vars are in the MCP config
- Or set them in your shell before starting Cursor

### "401 Unauthorized"
- Your API key is invalid or expired
- Generate a new one in n8n Settings → n8n API

## Quick Test

Once connected, you can test by asking Cursor:
- "List my n8n workflows"
- "Execute workflow X with data Y"
- "Show me the last execution of workflow Z"
