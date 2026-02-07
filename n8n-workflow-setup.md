# Correct n8n Workflow Setup for Storing Messages

## Required Node Order:

```
When chat message received
  ↓
AI Agent
  ↓
Respond to Webhook
  ↓
Code (prepare data) ← YOU NEED THIS!
  ↓
HTTP Request (Store Message)
```

## Why You Need the Code Node

After "Respond to Webhook", the data structure changes. The HTTP Request node needs properly formatted data with:
- `widgetId`
- `conversationId` 
- `role`
- `content`

The Code node extracts and formats this data from multiple sources (trigger + AI Agent output).

## Step 1: Add Code Node After "Respond to Webhook"

**Node Name**: "Prepare Message Data" (or any name you like)

**Code**:
```javascript
// Get data from all input items
const items = $input.all();

// Find trigger data (from "When chat message received")
const triggerData = items.find(item => 
  item.json.conversationId || 
  item.json.widgetId || 
  item.json.sessionId
) || items[0] || {};

// Find agent output (from "AI Agent")
const agentData = items.find(item => item.json.output) || items[0] || {};

// Extract values
const widgetId = triggerData.json.widgetId || '';
const conversationId = triggerData.json.conversationId || '';
const content = agentData.json.output || agentData.json.content || '';

// Return formatted data for HTTP Request node
return {
  widgetId: widgetId,
  conversationId: conversationId,
  role: "assistant",
  content: content
};
```

## Step 2: Configure HTTP Request Node

**Node Name**: "Store Message"

**Settings**:
- **Method**: `POST`
- **URL**: `https://app.profitbot.ai/api/widgets/{{ $json.widgetId }}/messages/save`
- **Headers**:
  - `Content-Type`: `application/json`
- **Body**:
  - **Body Content Type**: `JSON`
  - **Specify Body**: `Using JSON`
  - **Click the fx button** and enter:
    ```javascript
    {
      "conversationId": $json.conversationId,
      "role": $json.role,
      "content": $json.content
    }
    ```

## Important Notes:

1. ✅ **Code node is REQUIRED** - It formats the data correctly
2. ✅ **Use fx button** for JSON body - Don't type JSON directly
3. ✅ **Place Code node AFTER "Respond to Webhook"** - So webhook responds first, then message is saved
4. ✅ **Connect Code node output to HTTP Request node input**

## Troubleshooting:

If you still see errors:
1. Check Code node output - it should show `widgetId`, `conversationId`, `role`, `content`
2. Make sure you clicked **fx button** in HTTP Request body field
3. Verify the JSON expression uses `$json.fieldName` syntax
