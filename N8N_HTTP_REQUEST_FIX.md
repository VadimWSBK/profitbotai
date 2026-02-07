# Fix: HTTP Request Node Errors

## Issues Found:
1. ❌ `widgetId` is empty (URL shows `//`)
2. ❌ JSON body is invalid

## Step-by-Step Fix

### Step 1: Update Your Code Node

Replace your Code node with this (it properly extracts `widgetId`):

```javascript
// Get data from merged inputs
const items = $input.all();

// Find trigger data (has conversationId, widgetId, sessionId)
const triggerData = items.find(item => item.json.conversationId || item.json.widgetId || item.json.sessionId) || items[0] || {};

// Find agent data (has output)
const agentData = items.find(item => item.json.output) || items[0] || {};

// Extract values with fallbacks
const widgetId = triggerData.json.widgetId || '';
const conversationId = triggerData.json.conversationId || '';
const content = agentData.json.output || agentData.json.content || '';

// Return data for HTTP Request node
return {
  widgetId: widgetId,
  conversationId: conversationId,
  role: "assistant",
  content: content
};
```

### Step 2: Fix HTTP Request Node Configuration

#### A. URL Field
- **Current**: `https://app.profitbot.ai/api/widgets/{{ $json.widgetId }}/messages/save`
- **Keep it as is** - the expression is correct, but make sure `widgetId` is in the Code node output

#### B. JSON Body (THIS IS THE KEY FIX)

**IMPORTANT**: You MUST use the expression editor (fx button), not type JSON directly!

1. In the HTTP Request node, find the **"JSON (Body Content)"** field
2. Click the **fx** button (expression editor) - this is critical!
3. In the expression editor, enter this EXACT code:

```javascript
{
  "conversationId": $json.conversationId,
  "role": $json.role,
  "content": $json.content
}
```

**DO NOT**:
- ❌ Type this directly in the text field
- ❌ Use quotes around the whole thing
- ❌ Use `JSON.stringify()` - n8n handles that automatically

**DO**:
- ✅ Click the **fx** button first
- ✅ Enter the JavaScript object syntax (no quotes around the whole thing)
- ✅ Use `$json.fieldName` to reference fields from the Code node

### Step 3: Verify Your Workflow Flow

Make sure your nodes are connected in this order:
```
When chat message received
  ↓
AI Agent
  ↓
Respond to Webhook
  ↓
Code (prepare data) ← Updated code above
  ↓
HTTP Request (save message) ← Fixed configuration above
```

### Step 4: Test

1. Execute the workflow
2. Check the Code node output - verify it has `widgetId`, `conversationId`, `role`, and `content`
3. Check the HTTP Request node output - should show success response

## Troubleshooting

### If `widgetId` is still empty:

**Option 1**: Check what data is actually in your trigger node
- Add a temporary Code node right after "When chat message received"
- Return `$input.all()` to see all available fields
- Look for `widgetId` in the output

**Option 2**: Use `sessionId` instead (alternative approach)
If `widgetId` is not available, you can use `sessionId` and let the API resolve it:

**URL**: `https://app.profitbot.ai/api/widgets/PLACEHOLDER/messages/save`

**Body** (in expression editor):
```javascript
{
  "sessionId": $json.sessionId || $json[0]?.sessionId,
  "role": "assistant",
  "content": $json.content
}
```

But wait - the API requires `widgetId` in the URL. So you need to get it from somewhere.

**Option 3**: Hardcode widgetId temporarily (for testing)
If you know your widget ID, you can hardcode it:
- **URL**: `https://app.profitbot.ai/api/widgets/YOUR-WIDGET-ID-HERE/messages/save`

### If JSON body still shows "needs to be valid JSON":

1. Make absolutely sure you clicked the **fx** button
2. The field should show a code editor icon, not a text field
3. Try this alternative format in the expression editor:

```javascript
JSON.stringify({
  conversationId: $json.conversationId,
  role: $json.role,
  content: $json.content
})
```

### Debug: Check What Data Is Available

Add a Code node right before your HTTP Request node to debug:

```javascript
// Debug: See what data is available
const items = $input.all();
return {
  allItems: items.map(item => item.json),
  firstItem: items[0]?.json || {},
  widgetId: items[0]?.json?.widgetId || 'NOT FOUND',
  conversationId: items[0]?.json?.conversationId || 'NOT FOUND',
  content: items[0]?.json?.content || 'NOT FOUND'
};
```

This will show you exactly what fields are available.
