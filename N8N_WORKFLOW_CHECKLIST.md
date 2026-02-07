# n8n Workflow Issues Checklist

## Issues We've Identified and Fixed:

### ✅ 1. Missing widgetId in Webhook Payload
**Status**: Fixed with new endpoint  
**Solution**: Use `/api/conversations/{conversationId}/messages/save` instead of `/api/widgets/{widgetId}/messages/save`

### ✅ 2. JSON Body Syntax Error
**Status**: Needs fixing  
**Issue**: "JSON parameter needs to be valid JSON"  
**Solution**: Use "Using Fields Below" mode instead of "Using JSON" mode

### ✅ 3. Code Node Not Receiving Trigger Data
**Status**: Fixed with Merge node  
**Solution**: Connect both "When chat message received" and "AI Agent" to Merge node before Code node

### ✅ 4. Inefficient API Calls
**Status**: Fixed with new endpoint  
**Solution**: Removed need for extra HTTP Request to look up widgetId

## Current Workflow Structure (Should Be):

```
When chat message received
  ↓
AI Agent
  ├─→ Respond to Webhook (responds to user)
  └─→ Merge ─→ Code ─→ Store Message (saves to database)
```

## Step-by-Step Verification:

### 1. Check "When chat message received" Trigger
- [ ] **Response Mode**: Set to "Using Respond to Webhook Node" (NOT "Immediately")
- [ ] **Webhook Payload**: Should include `conversationId`, `sessionId`, `message`
- [ ] **Optional**: `widgetId` (not required with new endpoint)

### 2. Check AI Agent Node
- [ ] **Chat Model**: Connected to "Google Gemini Chat Model"
- [ ] **Memory**: Connected to "Postgres Chat Memory"
- [ ] **Tools**: Connected to "Supabase Vector Store" and "ProfitBot MCP API"
- [ ] **System Message**: Uses `{{ $json.systemPrompt }}` from trigger

### 3. Check Respond to Webhook Node
- [ ] **Response Body**: Returns JSON with `output` field
- [ ] **Example**: `{ "output": "{{ $json.output }}" }`
- [ ] **Status**: Should be 200 (not 500)

### 4. Check Merge Node (if using)
- [ ] **Mode**: "Merge by Index" or "Append"
- [ ] **Inputs**: 
  - Input 1: "When chat message received"
  - Input 2: "AI Agent"
- [ ] **Output**: Combined data from both nodes

### 5. Check Code Node
- [ ] **Input**: Receives merged data (or data from previous node)
- [ ] **Code**: Extracts `conversationId` and `content`
- [ ] **Output**: Returns `{ conversationId, role: "assistant", content }`

### 6. Check Store Message HTTP Request Node
- [ ] **Method**: POST
- [ ] **URL**: `https://app.profitbot.ai/api/conversations/{{ $json.conversationId }}/messages/save`
- [ ] **Headers**: `Content-Type: application/json`
- [ ] **Body Mode**: "Using Fields Below" (NOT "Using JSON")
- [ ] **Body Fields**:
  - `role`: `assistant`
  - `content`: `{{ $json.content }}`

## Common Issues to Check:

### Issue: Messages Not Being Stored
**Check**:
1. Is Store Message node executing? (check execution logs)
2. Is conversationId being passed correctly?
3. Is the HTTP Request returning success (201)?
4. Check database: `widget_conversation_messages` table

### Issue: JSON Body Error
**Fix**: Switch to "Using Fields Below" mode

### Issue: widgetId Missing
**Fix**: Use new endpoint `/api/conversations/{conversationId}/messages/save`

### Issue: Webhook Responds But Message Not Saved
**Check**:
1. Is Store Message node AFTER Respond to Webhook?
2. Is it connected correctly?
3. Check execution logs for errors

## Testing the Workflow:

1. **Send a test message** through the chat widget
2. **Check n8n execution logs**:
   - "When chat message received" - should receive webhook
   - "AI Agent" - should process and generate response
   - "Respond to Webhook" - should return response
   - "Store Message" - should save to database
3. **Check database**:
   ```sql
   SELECT * FROM widget_conversation_messages 
   ORDER BY created_at DESC 
   LIMIT 5;
   ```
4. **Verify message appears** in Messages dashboard

## Quick Fixes Needed:

### Fix 1: Update HTTP Request Body Mode
- Change "Specify Body" from "Using JSON" to **"Using Fields Below"**
- Add fields: `role` = `assistant`, `content` = `{{ $json.content }}`

### Fix 2: Update URL (if still using old endpoint)
- Change from: `/api/widgets/{{ $json.widgetId }}/messages/save`
- Change to: `/api/conversations/{{ $json.conversationId }}/messages/save`

### Fix 3: Verify Code Node Output
- Make sure Code node returns: `{ conversationId, role: "assistant", content }`
- Check that `conversationId` is extracted from trigger data
- Check that `content` is extracted from AI Agent output

## Expected Workflow Flow:

1. **User sends message** → Chat widget POSTs to n8n webhook
2. **"When chat message received"** → Receives webhook, waits for response
3. **"AI Agent"** → Processes message, generates response
4. **"Respond to Webhook"** → Sends response back to user (user sees message)
5. **"Merge"** → Combines trigger data + AI Agent output
6. **"Code"** → Prepares data: `{ conversationId, role, content }`
7. **"Store Message"** → POSTs to `/api/conversations/{id}/messages/save`
8. **Database** → Message saved in `widget_conversation_messages`

## Performance:

**Before**: 7+ API calls per message  
**After**: 5 API calls per message (removed widgetId lookup)

**API Calls**:
1. Google Gemini (Chat Model)
2. Postgres (Memory)
3. Supabase Vector Store (RAG)
4. ProfitBot MCP API (Tools)
5. Store Message (Save to DB)
