# Fix: "JSON parameter needs to be valid JSON" Error

## The Problem
Your JSON body field shows `1 {` which is invalid. You're typing JSON directly instead of using the expression editor.

## The Solution - Step by Step

### Step 1: Clear the Current JSON Body
1. In your "Store Message" HTTP Request node
2. Find the **"JSON (Body Content)"** field
3. **Delete everything** in that field (the `1 {` text)

### Step 2: Enable Expression Editor
1. Look for the **fx** button next to the JSON field
2. **Click the fx button** - this is CRITICAL!
3. The field should change to show a code editor icon or different styling

### Step 3: Enter the Expression
Once the fx button is active (expression mode), enter this EXACT code:

```javascript
{
  "conversationId": $json.conversationId,
  "role": $json.role,
  "content": $json.content
}
```

**Important Notes:**
- ✅ Use JavaScript object syntax (no quotes around the whole thing)
- ✅ Use `$json.fieldName` to reference fields from the Code node
- ✅ Make sure you're in expression mode (fx button clicked)

### Step 4: Alternative - If fx Button Doesn't Work

If you can't find the fx button, try this:

1. Change **"Specify Body"** dropdown to **"Using Fields Below"** or **"Using Expression"**
2. Then enter the expression in the field that appears

OR

Try this format with `JSON.stringify()`:

```javascript
JSON.stringify({
  conversationId: $json.conversationId,
  role: $json.role,
  content: $json.content
})
```

## Visual Guide

**WRONG** (what you have now):
```
JSON field: 1 {
```

**CORRECT** (what you need):
```
[fx button clicked] → Expression editor active
JSON field: {
  "conversationId": $json.conversationId,
  "role": $json.role,
  "content": $json.content
}
```

## Verify Your Code Node Output First

Before fixing the HTTP Request, make sure your Code node is outputting the right data:

1. **Run your workflow** up to the Code node
2. **Check the Code node output** - it should show:
   ```json
   {
     "widgetId": "some-uuid",
     "conversationId": "some-uuid",
     "role": "assistant",
     "content": "the message text"
   }
   ```
3. If the Code node output is wrong, fix that first

## Complete Workflow Check

Make sure your nodes are connected correctly:
```
When chat message received
  ↓
AI Agent
  ↓
Respond to Webhook
  ↓
Code (prepare data) ← Check output here first!
  ↓
HTTP Request (Store Message) ← Fix JSON body here
```

## Still Not Working?

If you still see the error after clicking fx and entering the expression:

1. **Try "Using Expression" mode instead:**
   - Change **"Specify Body"** to **"Using Expression"**
   - Enter: `{{ { "conversationId": $json.conversationId, "role": $json.role, "content": $json.content } }}`

2. **Or use "Using Fields Below" mode:**
   - Change **"Specify Body"** to **"Using Fields Below"**
   - Add fields:
     - `conversationId`: `{{ $json.conversationId }}`
     - `role`: `{{ $json.role }}`
     - `content`: `{{ $json.content }}`
