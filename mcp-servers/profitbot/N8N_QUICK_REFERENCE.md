# ProfitBot MCP → N8N Quick Reference

## HTTP Request Node Configuration

**Base Configuration:**
- **Method**: `POST`
- **URL**: `https://app.profitbot.ai/api/mcp`
- **Headers**:
  ```
  Content-Type: application/json
  X-MCP-API-Key: pb_mcp_your-api-key-here
  ```

## Common Actions

### Widgets
```json
{"action": "list_widgets"}
{"action": "get_widget", "widgetId": "..."}
```

### Leads
```json
{"action": "list_leads"}
{"action": "get_lead", "leadId": "..."}
{"action": "move_lead", "leadId": "...", "stageId": "..."}
{"action": "list_lead_stages"}
```

### Conversations
```json
{"action": "list_conversations", "widgetId": "..."}
{"action": "get_conversation", "conversationId": "..."}
{"action": "send_message", "conversationId": "...", "content": "..."}
{"action": "get_conversation_messages", "conversationId": "..."}
```

### Contacts
```json
{"action": "list_contacts", "widgetId": "...", "search": "...", "limit": 50, "page": 1}
{"action": "get_contact", "contactId": "..."}
```

### Email
```json
{"action": "send_email", "conversationId": "...", "subject": "...", "body": "..."}
{"action": "list_email_templates"}
{"action": "create_email_template", "name": "...", "subject": "...", "body": "..."}
```

### Quotes
```json
{"action": "generate_quote", "widgetId": "...", "conversationId": "...", "lineItems": [...]}
{"action": "get_quote_settings"}
{"action": "update_quote_settings", "company": {...}, "line_items": [...]}
```

### Shopify
```json
{"action": "shopify_list_orders", "limit": 10}
{"action": "shopify_search_orders", "query": "...", "limit": 10}
{"action": "shopify_get_order", "orderId": 12345}
{"action": "shopify_cancel_order", "orderId": 12345}
{"action": "shopify_refund_order", "orderId": 12345}
{"action": "shopify_list_customers", "limit": 50}
{"action": "shopify_get_customer", "customerId": 12345}
{"action": "shopify_list_products", "limit": 100}
{"action": "shopify_get_statistics", "days": 30}
```

## Response Format

All successful responses follow this format:
```json
{
  "success": true,
  "data": { ... }
}
```

Error responses:
```json
{
  "error": "Error message here"
}
```

## N8N Expression Examples

**Access response data:**
```
{{ $json.data.widgets }}
{{ $json.data.count }}
{{ $json.data.widget.id }}
```

**Use previous node data:**
```
{{ $json.conversationId }}
{{ $('Previous Node').item.json.widgetId }}
```

**Conditional logic:**
```
{{ $json.success ? $json.data : null }}
```

## Environment Variables

In N8N, set:
- `MCP_API_KEY` = `pb_mcp_your-key-here`

Then use in headers:
```
X-MCP-API-Key: {{ $env.MCP_API_KEY }}
```
