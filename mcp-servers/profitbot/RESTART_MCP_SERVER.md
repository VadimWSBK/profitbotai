# How to Restart the MCP Server in OpenClaw

The Shopify tools have been added to the MCP server code, but **you need to restart the MCP server** for OpenClaw to see them.

## Why Restart is Needed

MCP servers load their tool definitions when they start. OpenClaw caches the tool list from the server, so even though the code has been updated, OpenClaw won't see the new tools until the server is restarted.

## How to Restart

### Option 1: Restart OpenClaw (Easiest)

1. Stop OpenClaw completely
2. Start OpenClaw again
3. The MCP server will automatically start and load the new tool definitions

### Option 2: Restart Just the MCP Plugin

If OpenClaw has a way to restart plugins:

1. Go to OpenClaw settings/plugins
2. Find the `openclaw-mcp-adapter` plugin
3. Disable it, then re-enable it
4. Or restart just the profitbot MCP server connection

### Option 3: Manual Restart (If Running in Terminal)

If you're running OpenClaw manually and can see the MCP server process:

1. Find the process running `npx tsx /home/node/profitbotai/mcp-servers/profitbot/http-client.ts`
2. Kill that process
3. OpenClaw should automatically restart it, or restart OpenClaw

## Verify Tools Are Available

After restarting, ask OpenClaw:

```
List all available ProfitBot tools
```

Or specifically:

```
Do you have access to shopify_get_statistics tool?
```

You should see all 10 Shopify tools:
- shopify_list_orders
- shopify_search_orders
- shopify_get_order
- shopify_cancel_order
- shopify_refund_order
- shopify_list_customers
- shopify_get_customer
- shopify_get_customer_orders
- shopify_list_products
- shopify_get_statistics

## Troubleshooting

If after restarting you still don't see the tools:

1. **Check the file path**: Verify OpenClaw is using `/home/node/profitbotai/mcp-servers/profitbot/http-client.ts`
   - Check `openclaw-config.json` in the plugins section

2. **Check environment variables**: Ensure `MCP_API_KEY` is set correctly
   - The server needs this to authenticate

3. **Check logs**: Look at OpenClaw logs for any MCP server errors
   - There might be syntax errors or connection issues

4. **Verify file was updated**: Run the verification script:
   ```bash
   node mcp-servers/profitbot/verify-shopify-tools.mjs
   ```

5. **Test the API directly**: Verify the API endpoint works:
   ```bash
   curl -X POST https://app.profitbot.ai/api/mcp \
     -H "Content-Type: application/json" \
     -H "X-MCP-API-Key: YOUR_API_KEY" \
     -d '{"action": "list_tools"}'
   ```
   This should return `shopify_get_statistics` in the tools list.

## Still Not Working?

If the tools still don't appear after restart:

1. The MCP server might be using a different file (check `index.ts` vs `http-client.ts`)
2. There might be a file path mismatch
3. OpenClaw might be caching aggressively - try a full restart
4. Check if there are multiple MCP server instances running
