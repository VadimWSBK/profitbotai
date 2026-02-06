# ProfitBot MCP Setup for OpenClaw Docker

## Step 1: Update docker-compose.yaml

Add the ProfitBot project as a volume mount and add the MCP API key to environment variables:

```yaml
services:
  openclaw:
    image: ghcr.io/openclaw/openclaw:main
    restart: unless-stopped
    user: root

    ports:
      - "${PORT}:${PORT}"

    environment:
      # --- SYSTEM ---
      HOME: /home/node
      TERM: xterm-256color
      PATH: /home/node/.npm-global/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
      XDG_CONFIG_HOME: /home/node/.openclaw
      NPM_CONFIG_PREFIX: /home/node/.npm-global

      # --- GATEWAY ---
      OPENCLAW_GATEWAY_BIND: lan
      OPENCLAW_GATEWAY_PORT: ${PORT}
      OPENCLAW_GATEWAY_TOKEN: ${OPENCLAW_GATEWAY_TOKEN}

      # --- LLM PROVIDERS ---
      GEMINI_API_KEY: ${GEMINI_API_KEY}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}

      # --- DEFAULT / MAIN AGENT ---
      LLM_PROVIDER: gemini
      LLM_MODEL: gemini-2.5-flash

      # --- BROWSER (headless Chromium) ---
      CHROME_FLAGS: "--no-sandbox"
      CHROMIUM_FLAGS: "--no-sandbox"

      # --- PROFITBOT MCP ---
      MCP_API_KEY: ${MCP_API_KEY}
      PROFITBOT_API_URL: https://app.profitbot.ai

    volumes:
      - openclaw_config:/home/node/.openclaw
      - openclaw_workspace:/home/node/openclaw
      # Mount ProfitBot project so OpenClaw can access the MCP client
      - /path/to/profitbotai:/home/node/profitbotai:ro

    init: true

    command:
      - sh
      - -c
      - |
        if ! command -v chromium >/dev/null 2>&1; then
          apt-get update -qq && apt-get install -y -qq chromium --no-install-recommends >/dev/null 2>&1
        fi
        # Install tsx if not present (needed for MCP client)
        if ! command -v tsx >/dev/null 2>&1; then
          npm install -g tsx >/dev/null 2>&1
        fi
        chmod 700 /home/node/.openclaw
        [ -f /home/node/.openclaw/openclaw.json ] && chmod 600 /home/node/.openclaw/openclaw.json
        chown -R node:node /home/node/.openclaw /home/node/openclaw
        APP_DIR=$$(pwd)
        export CHROME_FLAGS="--no-sandbox"
        export CHROMIUM_FLAGS="--no-sandbox"
        exec su node -p -s /bin/sh -c "cd $$APP_DIR && node dist/index.js gateway --bind lan --port $PORT"

volumes:
  openclaw_config:
  openclaw_workspace:
```

**Important changes:**
1. Added `MCP_API_KEY` and `PROFITBOT_API_URL` to environment variables
2. Added volume mount: `/path/to/profitbotai:/home/node/profitbotai:ro` (replace `/path/to/profitbotai` with your actual ProfitBot project path)
3. Added `tsx` installation in the startup command (needed to run the TypeScript MCP client)

## Step 2: Add MCP_API_KEY to .env

Add to your `.env` file (used by docker-compose):

```env
MCP_API_KEY=pb_mcp_your-generated-api-key-here
```

## Step 3: Configure OpenClaw MCP Settings

OpenClaw's MCP configuration is typically stored in the `openclaw_config` volume. You'll need to configure it via OpenClaw's web interface or by editing the config file directly.

The MCP server configuration should be:

```json
{
  "mcpServers": {
    "profitbot": {
      "command": "npx",
      "args": ["tsx", "/home/node/profitbotai/mcp-servers/profitbot/http-client.ts"],
      "env": {
        "MCP_API_KEY": "${MCP_API_KEY}",
        "PROFITBOT_API_URL": "https://app.profitbot.ai"
      }
    }
  }
}
```

**Note:** The path `/home/node/profitbotai` matches the volume mount path in docker-compose.

## Step 4: Restart OpenClaw

```bash
docker-compose down
docker-compose up -d
```

## Alternative: Using npm script (if package.json is accessible)

If the ProfitBot project has `node_modules` installed in the mounted volume, you can use:

```json
{
  "mcpServers": {
    "profitbot": {
      "command": "npm",
      "args": ["run", "mcp:profitbot:http"],
      "cwd": "/home/node/profitbotai",
      "env": {
        "MCP_API_KEY": "${MCP_API_KEY}",
        "PROFITBOT_API_URL": "https://app.profitbot.ai"
      }
    }
  }
}
```

## Troubleshooting

### "tsx: command not found"
- Make sure the startup command installs tsx (already added above)
- Or install tsx in the ProfitBot project before mounting

### "Cannot find module"
- Ensure the ProfitBot project has `node_modules` installed
- Or install dependencies in the container: `docker-compose exec openclaw sh -c "cd /home/node/profitbotai && npm install"`

### "Invalid API key"
- Verify `MCP_API_KEY` is set correctly in your `.env` file
- Check that the key hasn't been deleted in ProfitBot dashboard
- Ensure the key belongs to the correct workspace

### Path issues
- Verify the volume mount path matches your actual ProfitBot project location
- Use absolute paths in the MCP config
- Check file permissions (the volume is mounted as `:ro` read-only, which should be fine)
