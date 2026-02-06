# ProfitBot MCP Client - Standalone Package

This is a standalone package that can be deployed to your VPS for OpenClaw to use.

## Quick Setup on VPS

### Step 1: Upload to VPS

Upload the entire `standalone/` folder to your VPS:

```bash
# On your VPS (via SSH)
mkdir -p /home/node/profitbot-mcp
# Then upload files via SFTP/FTP or git clone
```

### Step 2: Install Dependencies

```bash
cd /home/node/profitbot-mcp
npm install
```

### Step 3: Update docker-compose.yaml

Add to your OpenClaw docker-compose:

```yaml
environment:
  # ... existing vars ...
  MCP_API_KEY: ${MCP_API_KEY}
  PROFITBOT_API_URL: https://app.profitbot.ai

volumes:
  # ... existing volumes ...
  - /home/node/profitbot-mcp:/home/node/profitbot-mcp:ro
```

### Step 4: Update OpenClaw Config

Add to `plugins.entries.openclaw-mcp-adapter.config.servers`:

```json
{
  "name": "profitbot",
  "transport": "stdio",
  "command": "npx",
  "args": ["tsx", "/home/node/profitbot-mcp/index.ts"],
  "env": {
    "MCP_API_KEY": "${MCP_API_KEY}",
    "PROFITBOT_API_URL": "https://app.profitbot.ai"
  }
}
```

### Step 5: Add to .env

```env
MCP_API_KEY=pb_mcp_your-generated-api-key-here
```

### Step 6: Restart

```bash
docker-compose restart openclaw
```

## Test Manually

Test the client works:

```bash
cd /home/node/profitbot-mcp
MCP_API_KEY=your-key-here npx tsx index.ts
```

You should see: `ProfitBot MCP HTTP client running (connecting to https://app.profitbot.ai)`
