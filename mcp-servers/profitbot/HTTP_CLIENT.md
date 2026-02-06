# ProfitBot MCP HTTP API Client

Since ProfitBot is hosted on Vercel at `app.profitbot.ai`, OpenClaw should connect via HTTP instead of running a local process.

## API Endpoint

**Base URL:** `https://app.profitbot.ai/api/mcp`

**Authentication:** Include your MCP API key in the `X-MCP-API-Key` header

## Usage

### List Available Tools

```bash
curl -X POST https://app.profitbot.ai/api/mcp \
  -H "Content-Type: application/json" \
  -H "X-MCP-API-Key: pb_mcp_your-api-key-here" \
  -d '{"action": "list_tools"}'
```

### Example: List Leads

```bash
curl -X POST https://app.profitbot.ai/api/mcp \
  -H "Content-Type: application/json" \
  -H "X-MCP-API-Key: pb_mcp_your-api-key-here" \
  -d '{"action": "list_leads"}'
```

### Example: Send Message

```bash
curl -X POST https://app.profitbot.ai/api/mcp \
  -H "Content-Type: application/json" \
  -H "X-MCP-API-Key: pb_mcp_your-api-key-here" \
  -d '{
    "action": "send_message",
    "conversationId": "conv-123",
    "content": "Hello! How can I help?"
  }'
```

## Available Actions

- `list_tools` - List all available tools
- `list_widgets` - List widgets for workspace
- `get_widget` - Get widget details (requires `widgetId`)
- `list_leads` - List leads (optional `widgetId`)
- `get_lead` - Get lead details (requires `leadId`)
- `move_lead` - Move lead to stage (requires `leadId`, `stageId`)
- `list_lead_stages` - List pipeline stages
- `create_lead_stage` - Create stage (requires `name`, optional `sortOrder`)
- `update_lead_stage` - Update stage (requires `stageId`, optional `name`, `sortOrder`)
- `delete_lead_stage` - Delete stage (requires `stageId`)
- `list_conversations` - List conversations (optional `widgetId`)
- `get_conversation` - Get conversation (requires `conversationId`)
- `send_message` - Send message (requires `conversationId`, `content`)
- `get_conversation_messages` - Get messages (requires `conversationId`, optional `limit`)
- `list_contacts` - List contacts (optional `widgetId`, `search`, `limit`, `page`)
- `get_contact` - Get contact (requires `contactId`)

## Response Format

All responses follow this format:

```json
{
  "success": true,
  "data": {
    // Tool-specific data
  }
}
```

Errors:

```json
{
  "error": "Error message here"
}
```

## OpenClaw Configuration

For OpenClaw to use this HTTP API, you'll need to configure it to make HTTP requests instead of running a local process. The exact configuration depends on OpenClaw's HTTP MCP support.

If OpenClaw doesn't support HTTP MCP directly, you may need to:
1. Create a local proxy/gateway that translates between stdio MCP and HTTP
2. Or use OpenClaw's HTTP tool calling capabilities to call these endpoints directly
