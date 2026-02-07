# Using ProfitBot MCP Server with N8N

Yes! You can use the ProfitBot MCP server with N8N. Since the ProfitBot MCP server exposes an HTTP API endpoint, you can integrate it into your N8N workflows.

## ⚠️ Important: MCP Client vs HTTP Request Node

**The ProfitBot `/api/mcp` endpoint is a REST API that uses POST requests with `{ "action": "...", ...params }` format.**

### Option A: HTTP Request Node (Recommended)

✅ **Use the "HTTP Request" node** - it works perfectly with the ProfitBot API and gives you full control.

### Option B: MCP Client Node (If Supported)

If your n8n version supports HTTP endpoints in the MCP Client node, you can try:
- **Endpoint**: `https://app.profitbot.ai/api/mcp`
- **Server Transport**: HTTP Streamable
- **Authentication**: None (use header `X-MCP-API-Key` in the request)
- **Tools to Include**: All

However, **HTTP Request nodes are still recommended** because they're simpler, more reliable, and easier to debug.

## Option 1: Direct HTTP API Calls (Recommended)

The simplest approach is to use N8N's **HTTP Request** node to call the ProfitBot MCP API directly. This gives you full control and doesn't require any additional setup.

### Setup

1. **Get your MCP API Key** from the ProfitBot dashboard (Settings → MCP API Keys)

2. **Add HTTP Request Node** in your N8N workflow

3. **Configure the HTTP Request node:**

   - **Method**: `POST`
   - **URL**: `https://app.profitbot.ai/api/mcp`
   - **Headers**:
     - `Content-Type`: `application/json`
     - `X-MCP-API-Key`: `pb_mcp_your-api-key-here`
   - **Body** (JSON):
     ```json
     {
       "action": "list_widgets"
     }
     ```

### Available Actions

The ProfitBot MCP API supports all the same actions as the MCP tools. Here are the main ones:

#### Widget Management
- `list_widgets` - List all widgets
- `get_widget` - Get widget details
  ```json
  { "action": "get_widget", "widgetId": "widget-id-here" }
  ```

#### Lead Management
- `list_leads` - List all leads
- `get_lead` - Get lead details
- `move_lead` - Move lead to different stage
- `list_lead_stages` - List all lead stages
- `create_lead_stage` - Create new lead stage
- `update_lead_stage` - Update lead stage
- `delete_lead_stage` - Delete lead stage

#### Conversations & Contacts
- `list_conversations` - List conversations
- `get_conversation` - Get conversation details
- `send_message` - Send message in conversation
- `get_conversation_messages` - Get conversation messages
- `list_contacts` - List contacts
- `get_contact` - Get contact details (by contactId)
- `get_contact_by_conversation` - Get contact by widgetId + conversationId (for chat interactions)
- `update_contact_by_conversation` - Update contact by widgetId + conversationId (for chat interactions)

#### Email
- `send_email` - Send email to contact/conversation
- `list_email_templates` - List email templates
- `get_email_template` - Get email template
- `create_email_template` - Create email template
- `update_email_template` - Update email template
- `delete_email_template` - Delete email template
- `list_emails` - List emails

#### Quotes
- `generate_quote` - Generate PDF quote
  - Requires: `widgetId` OR `conversationId` (if conversationId is provided, widgetId will be resolved automatically)
  - Also requires: `conversationId` OR `email`
- `get_quote_settings` - Get quote settings
- `update_quote_settings` - Update quote settings
- `upload_quote_image` - Upload image for quotes

#### DIY Checkout & Product Pricing
- `get_product_pricing` - Get product pricing for a widget (for DIY quotes)
  - Requires: `widgetId` OR `conversationId` (if conversationId is provided, widgetId will be resolved automatically)
- `create_diy_checkout` - Create DIY checkout link with product buckets
  - Requires: `widgetId` OR `conversationId` (if conversationId is provided, widgetId will be resolved automatically)

#### Shopify
- `shopify_list_orders` - List recent orders
- `shopify_search_orders` - Search orders
- `shopify_get_order` - Get order details
- `shopify_cancel_order` - Cancel order
- `shopify_refund_order` - Refund order
- `shopify_list_customers` - List customers
- `shopify_get_customer` - Get customer details
- `shopify_get_customer_orders` - Get customer orders
- `shopify_list_products` - List products
- `shopify_get_statistics` - Get store statistics

### Example Workflow: List Widgets

1. **HTTP Request Node**:
   - Method: `POST`
   - URL: `https://app.profitbot.ai/api/mcp`
   - Headers:
     ```json
     {
       "Content-Type": "application/json",
       "X-MCP-API-Key": "pb_mcp_your-key"
     }
     ```
   - Body:
     ```json
     {
       "action": "list_widgets"
     }
     ```

2. **Response** will be:
   ```json
   {
     "success": true,
     "data": {
       "widgets": [...],
       "count": 5
     }
   }
   ```

### Example Workflow: Send Email

1. **HTTP Request Node**:
   - Method: `POST`
   - URL: `https://app.profitbot.ai/api/mcp`
   - Headers: (same as above)
   - Body:
     ```json
     {
       "action": "send_email",
       "conversationId": "{{ $json.conversationId }}",
       "subject": "Thank you for your inquiry",
       "body": "We'll get back to you soon!"
     }
     ```

### Example Workflow: Generate Quote

1. **HTTP Request Node** (using widgetId):
   - Method: `POST`
   - URL: `https://app.profitbot.ai/api/mcp`
   - Headers: (same as above)
   - Body:
     ```json
     {
       "action": "generate_quote",
       "widgetId": "{{ $json.widgetId }}",
       "conversationId": "{{ $json.conversationId }}",
       "lineItems": [
         {
           "desc": "Roof sealing",
           "price": 50,
           "fixed": false,
           "total": 5000
         }
       ]
     }
     ```
   
   Or using conversationId only (widgetId will be resolved automatically):
   ```json
   {
     "action": "generate_quote",
     "conversationId": "{{ $json.conversationId }}",
     "lineItems": [
       {
         "desc": "Roof sealing",
         "price": 50,
         "fixed": false,
         "total": 5000
       }
     ]
   }
   ```

### Example Workflow: Get Contact & Update Contact (for Chat Interactions)

1. **Get Contact**:
   ```json
   {
     "action": "get_contact_by_conversation",
     "widgetId": "{{ $json.widgetId }}",
     "conversationId": "{{ $json.conversationId }}"
   }
   ```

2. **Update Contact**:
   ```json
   {
     "action": "update_contact_by_conversation",
     "widgetId": "{{ $json.widgetId }}",
     "conversationId": "{{ $json.conversationId }}",
     "name": "John Doe",
     "email": "john@example.com",
     "phone": "+1234567890",
     "address": "123 Main St",
     "roof_size_sqm": 200
   }
   ```

### Example Workflow: Get Product Pricing & Create DIY Checkout

1. **Get Product Pricing** (using widgetId):
   ```json
   {
     "action": "get_product_pricing",
     "widgetId": "{{ $json.widgetId }}"
   }
   ```
   
   Or using conversationId (widgetId will be resolved automatically):
   ```json
   {
     "action": "get_product_pricing",
     "conversationId": "{{ $json.conversationId }}"
   }
   ```

2. **Create DIY Checkout** (using widgetId):
   ```json
   {
     "action": "create_diy_checkout",
     "widgetId": "{{ $json.widgetId }}",
     "conversationId": "{{ $json.conversationId }}",
     "roof_size_sqm": 200,
     "discount_percent": 10
   }
   ```
   
   Or using conversationId only (widgetId will be resolved automatically):
   ```json
   {
     "action": "create_diy_checkout",
     "conversationId": "{{ $json.conversationId }}",
     "roof_size_sqm": 200,
     "discount_percent": 10
   }
   ```
   
   Or with explicit bucket counts:
   ```json
   {
     "action": "create_diy_checkout",
     "conversationId": "{{ $json.conversationId }}",
     "count_15l": 5,
     "count_10l": 2,
     "count_5l": 1,
     "discount_percent": 10
   }
   ```

### Using Environment Variables

Store your MCP API key as an N8N credential or environment variable:

1. In N8N, go to **Settings → Credentials**
2. Create a new credential or use environment variables
3. Reference it in your HTTP Request node:
   - Header: `X-MCP-API-Key`: `{{ $env.MCP_API_KEY }}`

## Option 2: MCP Client Node (Experimental)

**If your n8n version supports HTTP endpoints in the MCP Client node, you can try using it.**

### Configuration

1. **Add MCP Client Node** to your workflow
2. **Configure**:
   - **Endpoint**: `https://app.profitbot.ai/api/mcp`
   - **Server Transport**: HTTP Streamable
   - **Authentication**: None
   - **Tools to Include**: All (or select specific tools)
3. **Add Header**: You'll need to pass `X-MCP-API-Key` header with your API key

### Important Notes

- **HTTP Request nodes are still recommended** - they're simpler, more reliable, and easier to debug
- The ProfitBot API uses REST POST format `{ "action": "...", ...params }`, not MCP protocol messages
- If the MCP Client node doesn't work, fall back to HTTP Request nodes (Option 1)
- The MCP Client node may require additional configuration to pass the `X-MCP-API-Key` header

### Why HTTP Request Nodes Are Better

- ✅ Full control over request/response format
- ✅ Easier to debug (see exact request/response)
- ✅ Better error handling
- ✅ Works with all n8n versions
- ✅ No special configuration needed

## Best Practices

1. **Store API Key Securely**: Use N8N credentials or environment variables, never hardcode
2. **Error Handling**: Add error handling nodes after HTTP Request to handle API errors
3. **Rate Limiting**: Be mindful of API rate limits if making many calls
4. **Response Parsing**: Use N8N's expression editor to parse responses: `{{ $json.data.widgets }}`

## Troubleshooting

### "Error running node 'MCP Client'" or Connection Issues

**If you're seeing errors with the MCP Client node:**

- ❌ **Stop using the MCP Client node** - it won't work with ProfitBot's API
- ✅ **Switch to HTTP Request node** - follow the setup instructions in Option 1 above
- The ProfitBot API is a REST API, not an MCP protocol server

### 401 Unauthorized
- Check that `X-MCP-API-Key` header is set correctly in HTTP Request node
- Verify the API key is valid in ProfitBot dashboard (Settings → MCP API Keys)
- Make sure the header name is exactly `X-MCP-API-Key` (case-sensitive)

### 400 Bad Request
- Check that the `action` field is correct in the request body
- Verify required parameters are included (e.g., `widgetId` for `get_widget`)
- Ensure the request body is valid JSON

### 500 Internal Error
- Check N8N logs for detailed error messages
- Verify all required parameters are provided
- Check ProfitBot server logs if you have access

### HTTP Request Node Not Working

**Common issues:**
1. **Wrong URL**: Make sure it's `https://app.profitbot.ai/api/mcp` (not `/api/mcp/tools`)
2. **Missing header**: The `X-MCP-API-Key` header is required
3. **Wrong method**: Must be `POST`, not `GET`
4. **Invalid JSON**: Check that the body is valid JSON format

## Example: Complete Workflow

Here's a complete workflow that:
1. Receives a webhook from chat widget
2. Lists widgets
3. Gets conversation details
4. Sends an email

```
Webhook Trigger
  ↓
HTTP Request (list_widgets)
  ↓
HTTP Request (get_conversation)
  ↓
HTTP Request (send_email)
  ↓
Respond to Webhook
```

## Need Help?

- Check the ProfitBot MCP API documentation
- Review N8N HTTP Request node documentation
- Check N8N community forums for HTTP integration examples
