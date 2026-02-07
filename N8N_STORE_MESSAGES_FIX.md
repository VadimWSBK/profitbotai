# Fix: Storing Assistant Messages in n8n Workflow

## Problem
Your Code node is preparing data but not actually storing it in the database. The code only returns data - it doesn't make an API call to save the message.

## Solution 1: Use HTTP Request Node (Recommended)

This is the most reliable approach and works with all n8n versions.

### Step 1: Update Your Code Node

Replace your current Code node with this:

```javascript
// Get data from merged inputs
const items = $input.all();
const triggerData = items.find(item => item.json.conversationId) || items[0] || {};
const agentData = items.find(item => item.json.output) || items[0] || {};

// Also try to get widgetId from trigger data
const widgetId = triggerData.json.widgetId || items.find(item => item.json.widgetId)?.json?.widgetId || '';

// Return data structure for HTTP Request node
return {
  widgetId: widgetId,
  conversationId: triggerData.json.conversationId || "",
  role: "assistant",
  content: agentData.json.output || agentData.json.content || ""
};
```

### Step 2: Add HTTP Request Node After Code Node

1. **Add an HTTP Request node** after your Code node
2. **Configure it as follows:**
   - **Method**: `POST`
   - **URL**: `https://app.profitbot.ai/api/widgets/{{ $json.widgetId }}/messages/save`
   - **Headers**:
     - `Content-Type`: `application/json`
   - **Body**:
     - **Body Content Type**: `JSON`
     - **Specify Body**: `Using JSON`
     - Click the **fx** button (expression editor) and enter:
       ```javascript
       {
         "conversationId": $json.conversationId,
         "role": $json.role,
         "content": $json.content
       }
       ```

### Step 3: Verify Your Workflow Flow

Your workflow should look like:
```
When chat message received
  ↓
AI Agent
  ↓
Respond to Webhook
  ↓
Code (prepare data) ← Your updated code
  ↓
HTTP Request (save message) ← NEW NODE
```

## Solution 2: Make HTTP Request Directly from Code Node

**Note**: This only works if your n8n version supports `$http` helper in Code nodes.

Replace your Code node with this:

```javascript
// Get data from merged inputs
const items = $input.all();
const triggerData = items.find(item => item.json.conversationId) || items[0] || {};
const agentData = items.find(item => item.json.output) || items[0] || {};

const conversationId = triggerData.json.conversationId || "";
const widgetId = triggerData.json.widgetId || items.find(item => item.json.widgetId)?.json?.widgetId || '';
const content = agentData.json.output || agentData.json.content || "";

// Validate required fields
if (!conversationId) {
  throw new Error("Missing conversationId");
}

if (!widgetId) {
  throw new Error("Missing widgetId");
}

if (!content) {
  throw new Error("Missing content (assistant output)");
}

// Make HTTP request to save the message
try {
  const response = await $http.request({
    method: 'POST',
    url: `https://app.profitbot.ai/api/widgets/${widgetId}/messages/save`,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      conversationId: conversationId,
      role: "assistant",
      content: content
    }
  });

  return {
    success: true,
    savedMessage: response,
    conversationId: conversationId,
    content: content
  };
} catch (error) {
  // Log error but don't fail the workflow
  console.error('Error saving message:', error);
  return {
    success: false,
    error: error.message,
    conversationId: conversationId,
    content: content
  };
}
```

## Troubleshooting

### "Missing widgetId" error
- Make sure your "When chat message received" trigger includes `widgetId` in the webhook payload
- Check that the widget is configured correctly in ProfitBot

### "Missing conversationId" error
- Verify that `conversationId` is being passed from the trigger node
- Check the webhook payload structure

### "JSON parameter needs to be valid JSON"
- Make sure you clicked the **fx** button (expression editor) in the HTTP Request node body
- Don't type directly in the text field - use the expression editor

### Messages still not appearing
- Check n8n execution logs to see if the HTTP Request node is being called
- Verify the API endpoint URL is correct: `https://app.profitbot.ai/api/widgets/{widgetId}/messages/save`
- Check that the HTTP Request node is placed AFTER "Respond to Webhook" (so the webhook responds first, then the message is saved)

## API Endpoint Details

**Endpoint**: `POST /api/widgets/{widgetId}/messages/save`

**Body**:
```json
{
  "conversationId": "uuid-here",
  "role": "assistant",
  "content": "Message content here"
}
```

**Response**:
```json
{
  "success": true,
  "message": {
    "id": "uuid",
    "role": "assistant",
    "content": "Message content",
    "createdAt": "2026-02-07T..."
  },
  "conversationId": "uuid"
}
```
