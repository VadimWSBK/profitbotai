# N8N Setup Guide: ProfitBot MCP Integration

## ✅ Correct Setup: HTTP Request Node

### Step 1: Add HTTP Request Node

1. In your N8N workflow, add an **HTTP Request** node (NOT MCP Client)
2. Connect it to your trigger or previous node

### Step 2: Configure HTTP Request Node

**Basic Settings:**
- **Method**: `POST`
- **URL**: `https://app.profitbot.ai/api/mcp`
- **Authentication**: `Header Auth` or `Generic Credential Type`

**Headers:**
- `Content-Type`: `application/json`
- `X-MCP-API-Key`: `pb_mcp_your-api-key-here`

**Body (JSON):**
```json
{
  "action": "list_widgets"
}
```

### Step 3: Configure Header Auth Credential

If using Header Auth credential:

1. **Name**: `X-MCP-API-Key`
2. **Value**: Your ProfitBot MCP API key (starts with `pb_mcp_`)
3. **Allowed HTTP Request Domains**: `All` (or specifically `app.profitbot.ai`)

### Step 4: Test the Connection

1. Execute the node
2. You should see a response like:
   ```json
   {
     "success": true,
     "data": {
       "widgets": [...],
       "count": 5
     }
   }
   ```

## ❌ Incorrect Setup: MCP Client Node

**Don't use the MCP Client node** - it won't work because:
- ProfitBot's API is a REST API, not an MCP protocol server
- MCP Client expects MCP protocol messages (list_tools, call_tool, etc.)
- ProfitBot uses simple POST requests with `{ action, ...params }` format

## Example: List Widgets

**HTTP Request Node Configuration:**

```
Method: POST
URL: https://app.profitbot.ai/api/mcp
Headers:
  Content-Type: application/json
  X-MCP-API-Key: pb_mcp_your-key-here
Body (JSON):
{
  "action": "list_widgets"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "widgets": [
      {
        "id": "widget-123",
        "name": "My Widget",
        ...
      }
    ],
    "count": 1
  }
}
```

## Example: Get Widget Details

**HTTP Request Node Configuration:**

```
Method: POST
URL: https://app.profitbot.ai/api/mcp
Headers:
  Content-Type: application/json
  X-MCP-API-Key: pb_mcp_your-key-here
Body (JSON):
{
  "action": "get_widget",
  "widgetId": "{{ $json.widgetId }}"
}
```

## Example: Send Email

**HTTP Request Node Configuration:**

```
Method: POST
URL: https://app.profitbot.ai/api/mcp
Headers:
  Content-Type: application/json
  X-MCP-API-Key: pb_mcp_your-key-here
Body (JSON):
{
  "action": "send_email",
  "conversationId": "{{ $json.conversationId }}",
  "subject": "Thank you for your inquiry",
  "body": "We'll get back to you soon!"
}
```

## Using N8N Expressions

You can use N8N expressions to pass dynamic values:

**From previous node:**
```json
{
  "action": "get_widget",
  "widgetId": "{{ $json.widgetId }}"
}
```

**From environment variable:**
```json
{
  "action": "list_widgets"
}
```
Headers:
- `X-MCP-API-Key`: `{{ $env.MCP_API_KEY }}`

## Troubleshooting

### "Error running node 'MCP Client'"
- **Solution**: Switch to HTTP Request node instead

### 401 Unauthorized
- Check that `X-MCP-API-Key` header is set correctly
- Verify the API key is valid (starts with `pb_mcp_`)
- Check the API key in ProfitBot dashboard (Settings → MCP API Keys)

### Connection Timeout
- Verify the URL is correct: `https://app.profitbot.ai/api/mcp`
- Check your network/firewall settings
- Ensure N8N can reach external URLs

### Invalid JSON Response
- Check that the request body is valid JSON
- Verify the `action` field is correct
- Check N8N execution logs for detailed error messages

## Next Steps

- See [N8N_INTEGRATION.md](./N8N_INTEGRATION.md) for complete API reference
- See [N8N_QUICK_REFERENCE.md](./N8N_QUICK_REFERENCE.md) for quick action reference
