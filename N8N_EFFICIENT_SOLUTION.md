# Efficient Solution: Store Messages Without Extra API Calls

## Problem
Your current workflow requires an extra HTTP Request to look up `widgetId` from `conversationId`, which is inefficient.

## Solution: Use New Endpoint

I've created a new, more efficient endpoint that accepts `conversationId` directly:

**New Endpoint**: `POST /api/conversations/{conversationId}/messages/save`

This eliminates the need to:
1. ❌ Look up widgetId from conversationId (extra API call)
2. ❌ Include widgetId in the webhook payload
3. ❌ Use Merge nodes to combine data

## Updated Workflow (Simplified)

```
When chat message received
  ↓
AI Agent
  ↓
Respond to Webhook
  ↓
Code (prepare data) ← Simple!
  ↓
Store Message ← Uses new endpoint
```

## Updated Code Node

```javascript
// Simple Code node - no need to look up widgetId!
const items = $input.all();

// Find conversationId (from trigger)
let conversationId = '';
let content = '';

for (const item of items) {
  const data = item.json || {};
  if (data.conversationId && !conversationId) {
    conversationId = data.conversationId;
  }
  if (data.output && !content) {
    content = data.output;
  }
}

if (!conversationId) {
  throw new Error(`Missing conversationId`);
}

if (!content) {
  throw new Error(`Missing content`);
}

return {
  conversationId: conversationId,
  role: "assistant",
  content: content
};
```

## Updated HTTP Request Node

**URL**: `https://app.profitbot.ai/api/conversations/{{ $json.conversationId }}/messages/save`

**Body** (Using Expression):
```javascript
{
  "role": $json.role,
  "content": $json.content
}
```

## Benefits

✅ **No extra API calls** - Direct save using conversationId  
✅ **Simpler workflow** - No Merge node needed  
✅ **No widgetId required** - Endpoint looks it up automatically  
✅ **Faster** - One less HTTP request per message  
✅ **More reliable** - Fewer moving parts = fewer failure points  

## API Endpoint Details

**Endpoint**: `POST /api/conversations/{conversationId}/messages/save`

**Body**:
```json
{
  "role": "assistant",
  "content": "message text"
}
```

**Response**:
```json
{
  "success": true,
  "message": {
    "id": "uuid",
    "role": "assistant",
    "content": "message text",
    "createdAt": "2026-02-07T..."
  },
  "conversationId": "uuid",
  "widgetId": "uuid"
}
```

## Migration Steps

1. **Deploy the new endpoint** (already created: `src/routes/api/conversations/[id]/messages/save/+server.ts`)
2. **Update your Code node** with the simpler code above
3. **Update HTTP Request URL** to use the new endpoint
4. **Remove the Merge node** (no longer needed)
5. **Remove the "Get Conversation" HTTP Request** (no longer needed)

This reduces your workflow from **7+ API calls** to **5 API calls** per message, and eliminates the complexity of looking up widgetId.
