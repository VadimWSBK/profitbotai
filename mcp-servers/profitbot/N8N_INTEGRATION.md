# Using ProfitBot MCP Server with N8N

Yes! You can use the ProfitBot MCP server with N8N. Since the ProfitBot MCP server exposes an HTTP API endpoint, you can integrate it into your N8N workflows in two ways:

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
- `get_contact` - Get contact details

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
- `get_quote_settings` - Get quote settings
- `update_quote_settings` - Update quote settings
- `upload_quote_image` - Upload image for quotes

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

1. **HTTP Request Node**:
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

### Using Environment Variables

Store your MCP API key as an N8N credential or environment variable:

1. In N8N, go to **Settings → Credentials**
2. Create a new credential or use environment variables
3. Reference it in your HTTP Request node:
   - Header: `X-MCP-API-Key`: `{{ $env.MCP_API_KEY }}`

## Option 2: MCP Client Node (If Available)

If your N8N instance has the MCP Client node installed (from `n8n-nodes-mcp` package), you can connect to the ProfitBot MCP server. However, this requires the ProfitBot MCP server to expose an HTTP MCP endpoint, which it currently doesn't (it's stdio-based for OpenClaw).

### Future Enhancement

To use N8N's MCP Client node, we would need to create an HTTP MCP server wrapper. This would:
1. Expose an HTTP endpoint that follows the MCP protocol
2. Translate MCP protocol messages to ProfitBot API calls
3. Return responses in MCP format

If you'd like this feature, we can add it!

## Best Practices

1. **Store API Key Securely**: Use N8N credentials or environment variables, never hardcode
2. **Error Handling**: Add error handling nodes after HTTP Request to handle API errors
3. **Rate Limiting**: Be mindful of API rate limits if making many calls
4. **Response Parsing**: Use N8N's expression editor to parse responses: `{{ $json.data.widgets }}`

## Troubleshooting

### 401 Unauthorized
- Check that `X-MCP-API-Key` header is set correctly
- Verify the API key is valid in ProfitBot dashboard

### 400 Bad Request
- Check that the `action` field is correct
- Verify required parameters are included (e.g., `widgetId` for `get_widget`)

### 500 Internal Error
- Check N8N logs for detailed error messages
- Verify all required parameters are provided

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
