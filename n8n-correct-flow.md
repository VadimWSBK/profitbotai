# Correct n8n Workflow Flow

## ✅ Your Current Flow is CORRECT:

```
When chat message received
  ↓
AI Agent
  ↓
Respond to Webhook
  ↓
Code in JavaScript  ← Prepares data
  ↓
Store Message        ← Saves to database
```

This flow is correct according to the documentation. The storage happens AFTER the webhook responds, which is fine - it runs asynchronously.

## ⚠️ But Your Code Node Needs Fixing

The issue is that after "Respond to Webhook", the input data structure changes. Your Code node needs to access data from the **original nodes**, not from the input.

## Fixed Code Node

Replace your Code node with this (it accesses data from the original nodes):

```javascript
// Get data from the previous node (Respond to Webhook or AI Agent)
const currentItem = $input.item.json;

// Get data from "When chat message received" node
const triggerNode = $node["When chat message received"];
const triggerData = triggerNode ? triggerNode.json : {};

// Get data from "AI Agent" node  
const agentNode = $node["AI Agent"];
const agentData = agentNode ? agentNode.json : {};

// Extract values
const widgetId = triggerData.widgetId || '';
const conversationId = triggerData.conversationId || '';
const content = agentData.output || currentItem.output || currentItem.content || '';

// Return formatted data for HTTP Request node
return {
  widgetId: widgetId,
  conversationId: conversationId,
  role: "assistant",
  content: content
};
```

## Key Changes:

1. ✅ Uses `$node["When chat message received"]` to get trigger data
2. ✅ Uses `$node["AI Agent"]` to get AI Agent output
3. ✅ Falls back to `$input.item.json` if needed
4. ✅ Extracts `widgetId` from trigger data

## Important: Trigger Node Configuration

Make sure your "When chat message received" trigger is configured correctly:

1. Open the trigger node settings
2. Find **"Respond"** or **"Response"** setting
3. Set it to **"Using Respond to Webhook Node"** (NOT "Immediately")
4. This ensures the webhook waits for "Respond to Webhook" before responding

## Complete Workflow Summary:

1. **When chat message received** - Receives webhook, waits for response
2. **AI Agent** - Processes message, generates response
3. **Respond to Webhook** - Sends response back to user (user sees message immediately)
4. **Code in JavaScript** - Prepares data for storage (accesses original nodes)
5. **Store Message** - Saves message to database (runs asynchronously)

This flow ensures:
- ✅ User gets response immediately
- ✅ Message is stored in database
- ✅ No blocking of the webhook response
