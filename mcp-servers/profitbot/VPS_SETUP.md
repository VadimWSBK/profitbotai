# ProfitBot MCP Setup for OpenClaw on VPS (Hostinger)

Since OpenClaw is running on a VPS, not locally, we need to set this up differently.

## Option 1: Mount ProfitBot Project on VPS (Recommended)

### Step 1: Clone/Copy ProfitBot to VPS

On your VPS (Hostinger), clone or copy the ProfitBot project:

```bash
# On VPS
cd /home/node
git clone <your-profitbot-repo-url> profitbotai
# OR upload the project via SFTP/FTP
```

### Step 2: Install Dependencies on VPS

```bash
cd /home/node/profitbotai
npm install
```

### Step 3: Update docker-compose.yaml

Update the volume mount to point to the VPS path:

```yaml
volumes:
  - openclaw_config:/home/node/.openclaw
  - openclaw_workspace:/home/node/openclaw
  # Mount ProfitBot project from VPS filesystem
  - /home/node/profitbotai:/home/node/profitbotai:ro
```

### Step 4: Update OpenClaw Config

The MCP server config should use VPS paths:

```json
{
  "name": "profitbot",
  "transport": "stdio",
  "command": "npx",
  "args": ["tsx", "/home/node/profitbotai/mcp-servers/profitbot/http-client.ts"],
  "env": {
    "MCP_API_KEY": "${MCP_API_KEY}",
    "PROFITBOT_API_URL": "https://app.profitbot.ai"
  }
}
```

---

## Option 2: Standalone HTTP Client (Simpler)

Instead of mounting the entire project, create a minimal standalone HTTP client that OpenClaw can run.

### Step 1: Create Standalone Package

On your VPS, create a minimal ProfitBot MCP client:

```bash
mkdir -p /home/node/profitbot-mcp
cd /home/node/profitbot-mcp
npm init -y
npm install @modelcontextprotocol/sdk
npm install -D tsx typescript @types/node
```

### Step 2: Copy HTTP Client

Copy `mcp-servers/profitbot/http-client.ts` to `/home/node/profitbot-mcp/index.ts`

### Step 3: Update OpenClaw Config

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

---

## Option 3: Use HTTP Transport Directly (Best for VPS)

Since OpenClaw supports HTTP transport (like Tavily), we can create an MCP-compatible HTTP endpoint. However, this requires implementing SSE transport on our API.

For now, **Option 2 (Standalone HTTP Client)** is the simplest approach.

---

## Updated docker-compose.yaml for VPS

```yaml
services:
  openclaw:
    # ... existing config ...
    
    environment:
      # ... existing env vars ...
      
      # --- PROFITBOT MCP ---
      MCP_API_KEY: ${MCP_API_KEY}
      PROFITBOT_API_URL: https://app.profitbot.ai

    volumes:
      - openclaw_config:/home/node/.openclaw
      - openclaw_workspace:/home/node/openclaw
      # Mount ProfitBot MCP client (Option 2 - standalone)
      - /home/node/profitbot-mcp:/home/node/profitbot-mcp:ro

    command:
      - sh
      - -c
      - |
        if ! command -v chromium >/dev/null 2>&1; then
          apt-get update -qq && apt-get install -y -qq chromium --no-install-recommends >/dev/null 2>&1
        fi
        # Install tsx for MCP client
        if ! command -v tsx >/dev/null 2>&1; then
          npm install -g tsx >/dev/null 2>&1
        fi
        chmod 700 /home/node/.openclaw
        [ -f /home/node/.openclaw/openclaw.json ] && chmod 600 /home/node/.openclaw/openclaw.json
        chown -R node:node /home/node/.openclaw /home/node/openclaw /home/node/profitbot-mcp
        APP_DIR=$$(pwd)
        export CHROME_FLAGS="--no-sandbox"
        export CHROMIUM_FLAGS="--no-sandbox"
        exec su node -p -s /bin/sh -c "cd $$APP_DIR && node dist/index.js gateway --bind lan --port $PORT"
```

---

## Quick Setup Script for VPS

Create this script on your VPS to set up the standalone client:

```bash
#!/bin/bash
# Setup ProfitBot MCP Client on VPS

mkdir -p /home/node/profitbot-mcp
cd /home/node/profitbot-mcp

# Initialize npm project
npm init -y

# Install dependencies
npm install @modelcontextprotocol/sdk
npm install -D tsx typescript @types/node

# Create tsconfig.json
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true
  }
}
EOF

echo "Setup complete! Now copy http-client.ts to /home/node/profitbot-mcp/index.ts"
```

---

## Verification Steps

1. **SSH into your VPS**
2. **Verify the path exists**: `ls -la /home/node/profitbot-mcp/`
3. **Test the client manually**:
   ```bash
   cd /home/node/profitbot-mcp
   MCP_API_KEY=your-key-here npx tsx index.ts
   ```
4. **Check OpenClaw logs**: `docker-compose logs openclaw | grep -i mcp`
5. **Restart OpenClaw**: `docker-compose restart openclaw`

---

## Important Notes

- **Paths are VPS paths**, not local Mac paths (`/Users/vadimw/...`)
- **MCP_API_KEY** must be set in your VPS `.env` file or docker-compose environment
- **The HTTP client connects to `https://app.profitbot.ai`** - make sure the VPS can reach this URL
- **No local database needed** - everything goes through HTTP to Vercel
