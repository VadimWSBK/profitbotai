# Fix: Missing widgetId - Use Merge Node

## The Problem
After "Respond to Webhook", the Code node only receives the AI Agent's output (`["output"]`), not the original trigger data with `widgetId` and `conversationId`.

## Solution: Add Merge Node

You need to combine data from both "When chat message received" and "AI Agent" before your Code node.

### Step 1: Add Merge Node

1. **Add a Merge node** between "Respond to Webhook" and your Code node
2. **Connect both nodes to Merge:**
   - Connect "When chat message received" output to Merge node
   - Connect "AI Agent" output to Merge node
3. **Configure Merge node:**
   - **Mode**: "Merge by Index" or "Append"
   - This combines data from both nodes

### Step 2: Update Your Workflow Flow

**Current (broken):**
```
When chat message received
  ↓
AI Agent
  ↓
Respond to Webhook
  ↓
Code ← Only gets ["output"]
  ↓
Store Message
```

**Fixed:**
```
When chat message received ──┐
                              ├─→ Merge ─→ Code ─→ Store Message
AI Agent ─────────────────────┘
  ↓
Respond to Webhook
```

**OR (if Respond to Webhook needs to be last):**

```
When chat message received ──┐
                              ├─→ Merge ─→ Code ─→ Store Message
AI Agent ─────────────────────┘
  ↓
Respond to Webhook (runs in parallel or after)
```

### Step 3: Update Your Code Node

After adding the Merge node, your Code node will receive data from both nodes:

```javascript
// Get merged data from both trigger and AI Agent
const items = $input.all();

// First item should be from "When chat message received" (has widgetId, conversationId)
// Second item should be from "AI Agent" (has output)
const triggerData = items[0]?.json || {};
const agentData = items[1]?.json || items[0]?.json || {};

// Extract values
const widgetId = triggerData.widgetId || '';
const conversationId = triggerData.conversationId || '';
const content = agentData.output || agentData.content || '';

// Validate
if (!widgetId) {
  throw new Error(
    `Missing widgetId. ` +
    `Trigger data: ${JSON.stringify(Object.keys(triggerData))}. ` +
    `All items: ${items.length}`
  );
}

if (!conversationId) {
  throw new Error(`Missing conversationId. Trigger data: ${JSON.stringify(Object.keys(triggerData))}`);
}

if (!content) {
  throw new Error(`Missing content. Agent data: ${JSON.stringify(Object.keys(agentData))}`);
}

// Return formatted data
return {
  widgetId: widgetId,
  conversationId: conversationId,
  role: "assistant",
  content: content
};
```

## Alternative: Access Original Nodes Directly

If Merge node doesn't work, try accessing the original nodes using n8n's node reference (if your n8n version supports it):

```javascript
// Try to access original nodes (may not work in all n8n versions)
const triggerNode = $('When chat message received');
const agentNode = $('AI Agent');

const widgetId = triggerNode?.json?.widgetId || '';
const conversationId = triggerNode?.json?.conversationId || '';
const content = agentNode?.json?.output || '';

if (!widgetId) {
  throw new Error(`widgetId missing. Try using Merge node instead.`);
}

return {
  widgetId: widgetId,
  conversationId: conversationId,
  role: "assistant",
  content: content
};
```

## Recommended: Use Merge Node

The Merge node approach is the most reliable and works with all n8n versions.
