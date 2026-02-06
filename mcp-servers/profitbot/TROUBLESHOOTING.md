# ProfitBot MCP Troubleshooting Guide

## Error: "Invalid or missing X-API-Key"

This error typically means one of two things:

### 1. Code Not Deployed to Vercel

The hooks.server.ts changes that allow `/api/mcp` to handle its own authentication may not be deployed yet.

**Solution:**
- Commit and push the latest changes to your repository
- Ensure Vercel has deployed the latest version
- Check Vercel deployment logs to confirm the deployment succeeded

### 2. MCP_API_KEY Environment Variable Not Set

The `MCP_API_KEY` environment variable must be available to the MCP server process.

**Check 1: Verify in Docker Compose**
```bash
# On your VPS, check if MCP_API_KEY is in your .env file
cat .env | grep MCP_API_KEY
```

**Check 2: Verify Environment Variable is Passed to Container**
```bash
# Check if the environment variable is set in the running container
docker-compose exec openclaw env | grep MCP_API_KEY
```

**Check 3: Verify OpenClaw MCP Configuration**

The OpenClaw MCP config should pass the environment variable. Check your OpenClaw config file (usually in the `openclaw_config` volume):

```json
{
  "mcpServers": {
    "profitbot": {
      "command": "npx",
      "args": ["tsx", "/home/node/profitbot-mcp/index.ts"],
      "cwd": "/home/node/profitbot-mcp",
      "env": {
        "MCP_API_KEY": "pb_mcp_your-actual-key-here",
        "PROFITBOT_API_URL": "https://app.profitbot.ai"
      }
    }
  }
}
```

**Important:** If you're using `${MCP_API_KEY}` syntax, make sure OpenClaw expands environment variables. Otherwise, use the actual key value directly.

**Check 4: Test MCP Server Directly**

SSH into your VPS and test the MCP server manually:

```bash
# Enter the container
docker-compose exec openclaw sh

# Set the environment variable
export MCP_API_KEY="pb_mcp_your-actual-key-here"
export PROFITBOT_API_URL="https://app.profitbot.ai"

# Test if the script can read the environment variable
cd /home/node/profitbot-mcp
node -e "console.log('MCP_API_KEY:', process.env.MCP_API_KEY)"

# If tsx is installed, try running the client directly
npx tsx index.ts
```

### 3. Verify API Key is Valid

Make sure the API key exists in your ProfitBot dashboard:

1. Go to `https://app.profitbot.ai/settings`
2. Check "MCP API Keys" section
3. Verify the key exists and hasn't been deleted
4. Copy the key exactly (it should start with `pb_mcp_`)

### 4. Check API Endpoint Response

Test the API endpoint directly from your VPS:

```bash
# From your VPS (not in Docker)
curl -X POST https://app.profitbot.ai/api/mcp \
  -H "Content-Type: application/json" \
  -H "X-MCP-API-Key: pb_mcp_your-actual-key-here" \
  -d '{"action": "list_widgets"}'
```

**Expected responses:**
- `{"error": "Missing X-MCP-API-Key header"}` → Header not being sent (check HTTP client)
- `{"error": "Invalid API key"}` → Key doesn't exist in database (check dashboard)
- `{"success": true, "data": [...]}` → Success! The key works

### 5. Check OpenClaw Logs

View OpenClaw logs to see what's happening:

```bash
docker-compose logs -f openclaw
```

Look for:
- MCP server startup messages
- Error messages about missing environment variables
- Connection errors to `app.profitbot.ai`

## Common Issues

### Issue: Environment Variable Not Expanding

**Symptom:** `${MCP_API_KEY}` appears literally in the config instead of the actual key value.

**Solution:** Use the actual key value directly in the OpenClaw config, or ensure OpenClaw supports environment variable expansion.

### Issue: Wrong Header Name

**Symptom:** Error mentions "X-API-Key" instead of "X-MCP-API-Key".

**Solution:** This means the hooks.server.ts changes haven't been deployed. Deploy the latest code to Vercel.

### Issue: Path Not Found

**Symptom:** "Cannot find module" or "No such file or directory".

**Solution:** 
- Verify the standalone package is mounted correctly in docker-compose
- Check that the `cwd` in OpenClaw config matches the mount path
- Ensure `index.ts` exists at the specified path

### Issue: tsx Not Found

**Symptom:** "tsx: command not found".

**Solution:**
- Ensure the docker-compose startup command installs tsx (already included in DOCKER_SETUP.md)
- Or install tsx globally in the container: `docker-compose exec openclaw npm install -g tsx`

## Step-by-Step Verification

1. **Verify Vercel Deployment**
   ```bash
   # Check if hooks.server.ts changes are deployed
   curl -I https://app.profitbot.ai/api/mcp
   ```

2. **Verify Environment Variable in Container**
   ```bash
   docker-compose exec openclaw env | grep MCP_API_KEY
   ```

3. **Verify OpenClaw Config**
   ```bash
   # Access the config volume
   docker-compose exec openclaw cat /home/node/.openclaw/openclaw.json | grep -A 10 profitbot
   ```

4. **Restart OpenClaw**
   ```bash
   docker-compose restart openclaw
   docker-compose logs -f openclaw
   ```

5. **Test MCP Connection**
   - Use OpenClaw's interface to test the `profitbot_list_widgets` tool
   - Check for any error messages

## Still Having Issues?

If none of the above resolves the issue:

1. Check Vercel deployment logs for any errors
2. Verify Supabase RPC function `validate_mcp_api_key` exists and works
3. Check browser network tab when accessing ProfitBot dashboard to ensure API calls work
4. Verify the API key format matches exactly (should start with `pb_mcp_`)
