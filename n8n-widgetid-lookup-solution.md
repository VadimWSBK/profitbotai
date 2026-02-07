# Solution: Look Up widgetId from conversationId

Since `widgetId` is not in the webhook payload but we have `conversationId`, we can look it up using the ProfitBot MCP API.

## Option 1: Add HTTP Request Node to Look Up widgetId

### Workflow Structure:

```
When chat message received ──┐
                              ├─→ Merge ─→ HTTP Request (Get Conversation) ─→ Code ─→ Store Message
AI Agent ─────────────────────┘
  ↓
Respond to Webhook
```

### Step 1: Add HTTP Request Node After Merge

**Node Name**: "Get Conversation Details"

**Configuration**:
- **Method**: `POST`
- **URL**: `https://app.profitbot.ai/api/mcp`
- **Headers**:
  - `Content-Type`: `application/json`
  - `X-MCP-API-Key`: `your-mcp-api-key-here` (get from ProfitBot Settings → MCP API Keys)
- **Body** (Using Expression):
  ```javascript
  {
    "action": "get_conversation",
    "conversationId": $json.conversationId || $json[0]?.conversationId
  }
  ```

### Step 2: Update Code Node

After the HTTP Request node, your Code node will receive the conversation data with `widgetId`:

```javascript
// Get data from previous nodes
const items = $input.all();

// Find conversation data (from HTTP Request "Get Conversation Details")
let conversationData = null;
let agentOutput = null;

for (const item of items) {
  const data = item.json || {};
  // Look for MCP API response (has widgetId)
  if (data.data && data.data.widgetId) {
    conversationData = data.data;
  }
  // Look for agent output
  if (data.output) {
    agentOutput = data.output;
  }
  // Also check direct fields
  if (data.widgetId) {
    conversationData = data;
  }
}

// Extract values
const widgetId = conversationData?.widgetId || '';
const conversationId = conversationData?.conversationId || items.find(i => i.json?.conversationId)?.json?.conversationId || '';
const content = agentOutput || items.find(i => i.json?.output)?.json?.output || '';

// Validate
if (!widgetId) {
  throw new Error(`Missing widgetId after lookup. Conversation data: ${JSON.stringify(conversationData)}`);
}

if (!conversationId) {
  throw new Error(`Missing conversationId`);
}

if (!content) {
  throw new Error(`Missing content`);
}

return {
  widgetId: widgetId,
  conversationId: conversationId,
  role: "assistant",
  content: content
};
```

## Option 2: Use sessionId Instead (Simpler)

If you have `sessionId` in the webhook payload, you can use it directly with the API:

### Updated HTTP Request Body:

```json
{
  "sessionId": "{{ $json.sessionId }}",
  "role": "assistant",
  "content": "{{ $json.output }}"
}
```

**BUT** - you still need `widgetId` in the URL! So this doesn't solve the problem.

## Option 3: Fix the Root Cause (Best Solution)

The webhook payload **should** include `widgetId` according to the code. Check:

1. **Verify webhook payload** - In "When chat message received", check what fields are actually being sent
2. **Check widget configuration** - Make sure the widget is properly configured
3. **Check if widgetId is undefined** - The code conditionally includes it: `...(widgetId && { widgetId })`

If `widgetId` is undefined in the chat widget, it won't be sent. This might happen if:
- The widget is in preview mode
- The widget ID isn't being passed correctly to the ChatWindow component

## Recommended: Use Option 1

Add the HTTP Request node to look up the conversation and get `widgetId`, then use that in your Code node.
