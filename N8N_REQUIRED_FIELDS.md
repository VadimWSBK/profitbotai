# Required Fields for Storing Messages

## Database Schema (`widget_conversation_messages` table)

Based on the database schema, here are the fields:

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | uuid | NO | `gen_random_uuid()` | Auto-generated |
| `conversation_id` | uuid | **YES** | - | Must reference `widget_conversations.id` |
| `role` | text | **YES** | - | Must be: `'user'`, `'assistant'`, or `'human_agent'` |
| `content` | text | **YES** | `''` | Message content |
| `read_at` | timestamptz | NO | - | Optional timestamp |
| `created_at` | timestamptz | NO | `now()` | Auto-generated |
| `created_by` | uuid | NO | - | Optional user ID |

## API Endpoint: `POST /api/widgets/{widgetId}/messages/save`

### URL Parameter:
- **`widgetId`** (required) - In the URL path: `/api/widgets/{widgetId}/messages/save`

### Request Body Fields:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `conversationId` | string (uuid) | **YES*** | Required if `sessionId` not provided |
| `sessionId` | string | **YES*** | Required if `conversationId` not provided |
| `role` | string | **YES** | Must be: `'user'`, `'assistant'`, or `'human_agent'` |
| `content` | string | **YES** | Message content (cannot be empty) |
| `createdAt` | string (ISO 8601) | NO | Optional timestamp |

**Note:** You need **either** `conversationId` **OR** `sessionId` (not both, but at least one).

## Required Fields for Your n8n HTTP Request

### URL:
```
https://app.profitbot.ai/api/widgets/{{ $json.widgetId }}/messages/save
```

### Body (JSON):
```json
{
  "conversationId": "uuid-here",  // REQUIRED (or use sessionId instead)
  "role": "assistant",              // REQUIRED - must be "assistant" for bot messages
  "content": "message text here"   // REQUIRED - cannot be empty
}
```

### Minimum Required Body:
```json
{
  "conversationId": "{{ $json.conversationId }}",
  "role": "assistant",
  "content": "{{ $json.content }}"
}
```

## Your Code Node Should Output:

```javascript
return {
  widgetId: "...",           // For URL
  conversationId: "...",     // REQUIRED for body
  role: "assistant",         // REQUIRED for body
  content: "..."             // REQUIRED for body
};
```

## Valid Role Values:
- `"user"` - User/visitor message
- `"assistant"` - AI bot message (use this for your bot responses)
- `"human_agent"` - Human operator message

## Summary:

**Minimum required fields in HTTP Request body:**
1. ✅ `conversationId` (or `sessionId` as alternative)
2. ✅ `role` (must be `"assistant"` for bot messages)
3. ✅ `content` (cannot be empty)

**Optional fields:**
- `createdAt` - ISO 8601 timestamp (if you want to set a specific timestamp)

**URL requires:**
- `widgetId` - Must be in the URL path
