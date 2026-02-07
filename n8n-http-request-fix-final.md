# Fix: "JSON parameter needs to be valid JSON" Error

## The Problem
Even with the fx button clicked, n8n is still showing the JSON error. This usually means:
1. The expression syntax is wrong, OR
2. You need to use "Using Expression" mode instead of "Using JSON"

## Solution 1: Use "Using Expression" Mode (Try This First)

1. In your "Store Message" HTTP Request node:
2. Find **"Specify Body"** dropdown
3. Change it from **"Using JSON"** to **"Using Expression"**
4. In the expression field, enter:
   ```javascript
   {
     "conversationId": $json.conversationId,
     "role": $json.role,
     "content": $json.content
   }
   ```

## Solution 2: Use JSON.stringify() (If Solution 1 Doesn't Work)

1. Keep **"Specify Body"** as **"Using Expression"**
2. Enter this:
   ```javascript
   JSON.stringify({
     conversationId: $json.conversationId,
     role: $json.role,
     content: $json.content
   })
   ```

## Solution 3: Use "Using Fields Below" Mode (Most Reliable)

This is the most reliable method:

1. Change **"Specify Body"** to **"Using Fields Below"**
2. Click **"Add Field"** three times
3. Set up these fields:
   - **Field 1:**
     - Name: `conversationId`
     - Value: `{{ $json.conversationId }}`
   - **Field 2:**
     - Name: `role`
     - Value: `{{ $json.role }}`
   - **Field 3:**
     - Name: `content`
     - Value: `{{ $json.content }}`

## Solution 4: Check Your Code Node Output

First, verify your Code node is outputting the correct data:

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

## Debug: Test the Expression

To test if your expression works:

1. In the HTTP Request node, temporarily change the body to just: `$json`
2. Run the workflow
3. Check the output - you should see all the fields from your Code node
4. If that works, then the issue is with the JSON object syntax

## Most Common Fix:

Try **Solution 3** ("Using Fields Below") - it's the most reliable and least error-prone method.
