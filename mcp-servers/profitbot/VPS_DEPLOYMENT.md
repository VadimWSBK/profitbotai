# ProfitBot MCP VPS Deployment Guide

Since OpenClaw runs on a VPS (Hostinger), not locally, here's how to deploy the ProfitBot MCP client.

## Option 1: Standalone Package (Recommended)

### Step 1: Upload Standalone Package to VPS

1. **On your local machine**, zip the standalone folder:
   ```bash
   cd mcp-servers/profitbot
   tar -czf profitbot-mcp-standalone.tar.gz standalone/
   ```

2. **Upload to VPS** via SFTP/FTP:
   - Upload `profitbot-mcp-standalone.tar.gz` to `/home/node/` on your VPS
   - Extract: `tar -xzf profitbot-mcp-standalone.tar.gz`
   - Rename: `mv standalone profitbot-mcp`

### Step 2: Install Dependencies on VPS

SSH into your VPS and run:

```bash
cd /home/node/profitbot-mcp
npm install
```

### Step 3: Update docker-compose.yaml

Add these lines to your OpenClaw docker-compose:

```yaml
environment:
  # ... existing environment variables ...
  
  # --- PROFITBOT MCP ---
  MCP_API_KEY: ${MCP_API_KEY}
  PROFITBOT_API_URL: https://app.profitbot.ai

volumes:
  # ... existing volumes ...
  - /home/node/profitbot-mcp:/home/node/profitbot-mcp:ro
```

### Step 4: Update OpenClaw Config

In your OpenClaw config file (accessible via OpenClaw web UI or in the volume), add to the `servers` array:

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

### Step 5: Add MCP_API_KEY to .env

On your VPS, add to the `.env` file used by docker-compose:

```env
MCP_API_KEY=pb_mcp_your-generated-api-key-here
```

### Step 6: Restart OpenClaw

```bash
docker-compose restart openclaw
```

---

## Option 2: Git Clone (If Using Git)

If your ProfitBot repo is on GitHub/GitLab:

```bash
# On VPS
cd /home/node
git clone <your-repo-url> profitbotai
cd profitbotai
npm install

# Then use this path in OpenClaw config:
# /home/node/profitbotai/mcp-servers/profitbot/http-client.ts
```

---

## Verification

### Test the Client Manually

SSH into your VPS and test:

```bash
cd /home/node/profitbot-mcp
MCP_API_KEY=your-key-here npx tsx index.ts
```

Expected output: `ProfitBot MCP HTTP client running (connecting to https://app.profitbot.ai)`

### Check OpenClaw Logs

```bash
docker-compose logs openclaw | grep -i profitbot
docker-compose logs openclaw | grep -i mcp
```

### Test in OpenClaw

Once configured, ask OpenClaw:
- "List all widgets in ProfitBot"
- "Show me available ProfitBot tools"

---

## Important Notes

1. **All paths are VPS paths** (`/home/node/...`), NOT local Mac paths
2. **MCP_API_KEY** must be set in VPS `.env` file
3. **The client connects to `https://app.profitbot.ai`** - ensure VPS can reach this URL
4. **No local database** - everything goes through HTTP to Vercel
5. **Tenant-scoped** - Each MCP_API_KEY only accesses one workspace

---

## Troubleshooting

### "Command not found: tsx"
- Ensure tsx is installed: `npm install -g tsx` (or it's in node_modules)
- Check docker-compose startup command installs tsx

### "Cannot find module @modelcontextprotocol/sdk"
- Run `npm install` in `/home/node/profitbot-mcp`

### "Invalid API key"
- Verify MCP_API_KEY is correct in `.env`
- Check key hasn't been deleted in ProfitBot dashboard

### "Connection refused" or network errors
- Test: `curl https://app.profitbot.ai/api/mcp` from VPS
- Check firewall rules allow outbound HTTPS

### Tools not appearing in OpenClaw
- Check OpenClaw logs for MCP errors
- Verify config JSON is valid
- Restart OpenClaw after config changes
- Check volume mount path matches config path
