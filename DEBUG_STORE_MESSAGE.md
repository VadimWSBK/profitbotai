# Debug: Store Message Not Saving

## The Problem
Workflow shows "Succeeded" but message isn't in database.

## Debugging Steps

### Step 1: Check Store Message Node Output

In n8n execution view:
1. Click on the **"Store Message"** node
2. Check the **OUTPUT** tab
3. Look for:
   - HTTP status code (should be 201 for success)
   - Response body
   - Any error messages

**What to look for:**
- ✅ Status 201 = Success (but check response body)
- ❌ Status 400/404/500 = Error (check error message)
- ⚠️ Status 200 but wrong response = API issue

### Step 2: Check Code Node Output

Before Store Message, check the **Code** node:
1. Click on **Code** node in execution
2. Check **OUTPUT** tab
3. Verify it has:
   ```json
   {
     "conversationId": "uuid-here",
     "role": "assistant",
     "content": "message text here"
   }
   ```

**Common issues:**
- `conversationId` is empty or wrong
- `content` is empty or wrong
- Missing fields

### Step 3: Check HTTP Request Configuration

Verify the Store Message HTTP Request node:

**URL**: Should be:
```
https://app.profitbot.ai/api/conversations/{{ $json.conversationId }}/messages/save
```

**Body Mode**: Should be **"Using Fields Below"** (not "Using JSON")

**Body Fields**:
- `role`: `assistant`
- `content`: `{{ $json.content }}`

### Step 4: Check Database Directly

Run this SQL query to see if anything was saved:

```sql
SELECT * FROM widget_conversation_messages 
WHERE role = 'assistant'
ORDER BY created_at DESC 
LIMIT 10;
```

### Step 5: Check API Endpoint Logs

If you have access to server logs, check for:
- Incoming requests to `/api/conversations/{id}/messages/save`
- Any error messages
- Response status codes

## Common Issues and Fixes

### Issue 1: HTTP Request Returns 200 But Empty Response
**Symptom**: Status 200 but no data saved  
**Cause**: API endpoint might be returning HTML error page  
**Fix**: Check the actual response body in Store Message output

### Issue 2: conversationId is Wrong
**Symptom**: Status 404 "Conversation not found"  
**Fix**: Check Code node is extracting conversationId correctly

### Issue 3: Content is Empty
**Symptom**: Status 400 "Missing content"  
**Fix**: Check Code node is extracting content from AI Agent output

### Issue 4: Wrong Endpoint URL
**Symptom**: Status 404  
**Fix**: Verify URL is `/api/conversations/{conversationId}/messages/save`

### Issue 5: JSON Body Not Parsed Correctly
**Symptom**: Status 400 "Invalid JSON body"  
**Fix**: Use "Using Fields Below" mode instead of "Using JSON"

## Quick Test

1. **Check Store Message node output** - What status code and response?
2. **Check Code node output** - Does it have conversationId and content?
3. **Check database** - Run the SQL query above
4. **Check API endpoint** - Is `/api/conversations/{id}/messages/save` deployed?

## Next Steps

Share with me:
1. The **HTTP status code** from Store Message node output
2. The **response body** from Store Message node output  
3. The **Code node output** (what data it's passing)
4. Results from the **SQL query** (any messages in database?)

This will help identify exactly where the issue is.
