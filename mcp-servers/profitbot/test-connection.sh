#!/bin/bash
# Test script to verify ProfitBot MCP connection
# Usage: ./test-connection.sh YOUR_MCP_API_KEY

if [ -z "$1" ]; then
    echo "Usage: $0 YOUR_MCP_API_KEY"
    echo "Example: $0 pb_mcp_abc123..."
    exit 1
fi

MCP_API_KEY="$1"
API_URL="${PROFITBOT_API_URL:-https://app.profitbot.ai}"

echo "Testing ProfitBot MCP API connection..."
echo "API URL: $API_URL"
echo "API Key: ${MCP_API_KEY:0:20}..." # Show first 20 chars only
echo ""

# Test 1: Check if endpoint is accessible
echo "Test 1: Checking endpoint accessibility..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/mcp" \
  -H "Content-Type: application/json" \
  -H "X-MCP-API-Key: $MCP_API_KEY" \
  -d '{"action": "list_widgets"}')

if [ "$HTTP_CODE" = "401" ]; then
    echo "  ❌ Got 401 Unauthorized"
    echo "  This could mean:"
    echo "    - The API key is invalid or missing from the database"
    echo "    - The hooks.server.ts changes haven't been deployed to Vercel yet"
    echo "    - Check Vercel deployment logs"
elif [ "$HTTP_CODE" = "200" ]; then
    echo "  ✅ Got 200 OK - Connection successful!"
else
    echo "  ⚠️  Got HTTP $HTTP_CODE"
fi
echo ""

# Test 2: Check response body
echo "Test 2: Checking API response..."
RESPONSE=$(curl -s -X POST "$API_URL/api/mcp" \
  -H "Content-Type: application/json" \
  -H "X-MCP-API-Key: $MCP_API_KEY" \
  -d '{"action": "list_widgets"}')

echo "Response: $RESPONSE"
echo ""

# Test 3: Check for specific error messages
if echo "$RESPONSE" | grep -q "Invalid or missing X-API-Key"; then
    echo "  ❌ ERROR: Hooks are intercepting the request"
    echo "  SOLUTION: Deploy the latest hooks.server.ts changes to Vercel"
    echo "  The hooks need to be updated to allow /api/mcp to handle its own auth"
elif echo "$RESPONSE" | grep -q "Missing X-MCP-API-Key header"; then
    echo "  ❌ ERROR: Header not being sent"
    echo "  SOLUTION: Check that MCP_API_KEY environment variable is set in OpenClaw"
elif echo "$RESPONSE" | grep -q "Invalid API key"; then
    echo "  ❌ ERROR: API key not found in database"
    echo "  SOLUTION: Verify the key exists in ProfitBot dashboard (Settings → MCP API Keys)"
elif echo "$RESPONSE" | grep -q '"success":true'; then
    echo "  ✅ SUCCESS: API key is valid and working!"
else
    echo "  ⚠️  Unexpected response format"
fi
