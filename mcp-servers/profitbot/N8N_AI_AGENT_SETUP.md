# N8N AI Agent + ProfitBot MCP HTTP Request Tool Setup

This guide shows how to configure an HTTP Request node as a tool for N8N's AI Agent to interact with the ProfitBot MCP API.

## HTTP Request Node Configuration

### Step 1: Basic Settings

1. **Method**: `POST` (NOT PUT or GET)
2. **URL**: `https://app.profitbot.ai/api/mcp`
3. **Authentication**: Use your Header Auth credential (e.g., "ProfitBot MCP")

### Step 2: Headers

Configure these headers:

- `Content-Type`: `application/json`
- `X-MCP-API-Key`: Your ProfitBot MCP API key (via Header Auth credential)

**Using Header Auth Credential:**
- Create a Header Auth credential named "ProfitBot MCP"
- Set Name: `X-MCP-API-Key`
- Set Value: Your API key (starts with `pb_mcp_`)
- Select this credential in the HTTP Request node's Authentication dropdown

### Step 3: Request Body (JSON)

The body should be a JSON object with an `action` field and optional parameters:

```json
{
  "action": "list_widgets"
}
```

For actions that require parameters:

```json
{
  "action": "get_widget",
  "widgetId": "{{ $json.widgetId }}"
}
```

### Step 4: Configure as AI Agent Tool

When using this HTTP Request node as a tool for an AI Agent:

1. **Description Field**: Keep your documentation (the list of available actions) - this helps the AI understand what actions are available
2. **Tool Name**: Give it a clear name like "ProfitBot MCP API" or "ProfitBot Actions"
3. **Tool Description**: Add a brief description like "Interact with ProfitBot widgets, leads, conversations, contacts, emails, quotes, and Shopify data"

## How AI Agent Calls This Tool

When the AI Agent needs to call this tool, it will:

1. **Determine the action** based on the user's request
2. **Format the request body** with the appropriate `action` and parameters
3. **Send the POST request** to the configured URL

### Example: AI Agent Tool Call

When a user asks: *"List all my widgets"*

The AI Agent will call the tool with:
```json
{
  "action": "list_widgets"
}
```

When a user asks: *"Get details for widget abc123"*

The AI Agent will call the tool with:
```json
{
  "action": "get_widget",
  "widgetId": "abc123"
}
```

## Complete HTTP Request Node Configuration

### Parameters Tab:

**Method**: `POST`

**URL**: `https://app.profitbot.ai/api/mcp`

**Authentication**: `Header Auth` → Select "ProfitBot MCP" credential

**Send Body**: ✅ Yes

**Body Content Type**: `JSON`

**Specify Body**: `Using JSON`

**JSON Body**:
```json
{
  "action": "{{ $json.action }}",
  "widgetId": "{{ $json.widgetId }}",
  "conversationId": "{{ $json.conversationId }}",
  "contactId": "{{ $json.contactId }}",
  "leadId": "{{ $json.leadId }}",
  "stageId": "{{ $json.stageId }}",
  "subject": "{{ $json.subject }}",
  "body": "{{ $json.body }}"
}
```

**Note**: The AI Agent will populate only the fields it needs. You can include all possible parameters, and unused ones will be `undefined` (which is fine).

### Alternative: Simpler Body Configuration

For a simpler setup, you can use:

**JSON Body**:
```json
{{ $json }}
```

This passes through whatever the AI Agent provides, which should already be in the correct format.

## Quick Configuration Summary

**HTTP Request Node Settings:**
- Method: `POST`
- URL: `https://app.profitbot.ai/api/mcp`
- Authentication: Header Auth → "ProfitBot MCP"
- Body: `{{ $json }}` (passes through AI Agent's tool call)

**That's it!** The AI Agent will format the requests correctly based on the tool description below.

## Tool Description for AI Agent

Use this description in your HTTP Request tool configuration (in the Description field or Tool Description):

```
Use this tool to interact with ProfitBot's API. Available actions:

Widget Management:
- list_widgets: List all widgets (no params)
- get_widget: Get widget details (requires widgetId)

Lead Management:
- list_leads: List all leads (optional widgetId)
- get_lead: Get lead details (requires leadId)
- move_lead: Move lead to stage (requires leadId, stageId)
- list_lead_stages: List all stages (no params)
- create_lead_stage: Create stage (requires name, optional sortOrder)
- update_lead_stage: Update stage (requires stageId, optional name, sortOrder)
- delete_lead_stage: Delete stage (requires stageId)

Conversations & Contacts:
- list_conversations: List conversations (optional widgetId)
- get_conversation: Get conversation details (requires conversationId)
- send_message: Send message (requires conversationId, content)
- get_conversation_messages: Get messages (requires conversationId, optional limit)
- list_contacts: List contacts (optional widgetId, search, limit, page)
- get_contact: Get contact details (requires contactId)

Email:
- send_email: Send email (requires subject, body, and either conversationId or contactId)
- list_email_templates: List templates (no params)
- get_email_template: Get template (requires templateId)
- create_email_template: Create template (requires name, optional subject, body)
- update_email_template: Update template (requires templateId, optional name, subject, body)
- delete_email_template: Delete template (requires templateId)
- list_emails: List emails (optional contactId, conversationId, limit, page)
- get_email: Get email details (requires emailId)

Quotes:
- generate_quote: Generate PDF quote (requires widgetId, optional conversationId, email, customer, project, lineItems, images)
- get_quote_settings: Get quote settings (no params)
- update_quote_settings: Update settings (optional company, bank_details, line_items, deposit_percent, tax_percent, valid_days, logo_url, barcode_url, etc.)
- upload_quote_image: Upload image (requires imageData or imageUrl)

Shopify:
- shopify_list_orders: List orders (optional limit)
- shopify_search_orders: Search orders (requires query, optional limit)
- shopify_get_order: Get order (requires orderId as number)
- shopify_cancel_order: Cancel order (requires orderId, optional reason, notify, restock)
- shopify_refund_order: Refund order (requires orderId, optional notify, note)
- shopify_list_customers: List customers (optional limit, pageInfo)
- shopify_get_customer: Get customer (requires customerId as number)
- shopify_get_customer_orders: Get customer orders (requires customerId)
- shopify_list_products: List products (optional limit)
- shopify_get_statistics: Get statistics (optional days)

Format: Send POST request to https://app.profitbot.ai/api/mcp with JSON body:
{
  "action": "action_name",
  "param1": "value1",
  "param2": "value2"
}
```

## Response Format

The API returns responses in this format:

**Success:**
```json
{
  "success": true,
  "data": {
    // Response data here
  }
}
```

**Error:**
```json
{
  "error": "Error message here"
}
```

The AI Agent will receive this response and can use it to answer the user's question.

## Testing the Tool

1. **Manual Test**: Execute the HTTP Request node manually with a test body:
   ```json
   {
     "action": "list_widgets"
   }
   ```

2. **Expected Response**:
   ```json
   {
     "success": true,
     "data": {
       "widgets": [...],
       "count": 5
     }
   }
   ```

3. **AI Agent Test**: Ask the AI Agent a question like:
   - "List all my widgets"
   - "Get details for widget [widget-id]"
   - "Send an email to contact [contact-id]"

## Troubleshooting

### AI Agent Not Calling the Tool

- Check that the tool is properly connected to the AI Agent node
- Verify the tool description is clear and includes action names
- Ensure the AI Agent's system prompt mentions these tools are available

### 401 Unauthorized

- Verify the `X-MCP-API-Key` header is set correctly
- Check that your API key is valid in ProfitBot dashboard
- Ensure the Header Auth credential is selected in the HTTP Request node

### Wrong Action Format

- The AI Agent should send `{ "action": "action_name", ...params }`
- If it's sending a different format, update the tool description to be more explicit
- You can add validation in the HTTP Request node to ensure the format is correct

### Response Not Parsed Correctly

- The AI Agent should receive the full response JSON
- Check that the response format matches what the AI Agent expects
- You may need to add a "Code" node after the HTTP Request to transform the response if needed

## Example Workflow

```
When chat message received
  ↓
AI Agent
  ├─ Chat Model (Google Gemini)
  ├─ Memory (Postgres)
  └─ Tools:
      ├─ Supabase Vector Store (for RAG)
      └─ HTTP Request (ProfitBot MCP API) ← This node
  ↓
Respond to Webhook
  ↓
Store in Widget messages
```

The AI Agent will automatically call the HTTP Request tool when it needs to interact with ProfitBot data.
