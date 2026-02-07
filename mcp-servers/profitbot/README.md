# ProfitBot MCP Server (Tenant-Scoped)

A comprehensive Model Context Protocol (MCP) server that exposes ProfitBot functionality to AI assistants like OpenClaw. **This server is tenant-scoped** - each API key provides access to only one workspace/tenant, ensuring secure multi-tenant operation.

## Features

### 🔒 Tenant-Scoped Security
- Each MCP API key is scoped to a specific workspace
- OpenClaw can only access data for the tenant associated with the API key
- Perfect for multi-tenant deployments where each tenant needs their own OpenClaw connection

### 🛠️ Available Tools

#### Leadflow Management
- `list_leads` - List all leads in the pipeline (optionally filter by widget)
- `get_lead` - Get lead details by ID
- `move_lead` - Move a lead to a different stage
- `list_lead_stages` - List all pipeline stages
- `create_lead_stage` - Create a new stage
- `update_lead_stage` - Update stage name or sort order
- `delete_lead_stage` - Delete a stage (leads moved to first remaining stage)

#### Messaging & Conversations
- `list_conversations` - List conversations (optionally filter by widget)
- `get_conversation` - Get conversation details
- `send_message` - Send a message as a human agent
- `get_conversation_messages` - Get messages from a conversation

#### Contacts
- `list_contacts` - List contacts with pagination and search
- `get_contact` - Get contact details by ID

#### Widgets
- `list_widgets` - List all widgets for the workspace
- `get_widget` - Get widget details by ID

## Setup

### Step 1: Generate an MCP API Key

1. Log into your ProfitBot dashboard
2. Go to **Settings** → **MCP API Keys**
3. Click **Create Key** (optionally add a name like "OpenClaw Production")
4. **Copy the API key immediately** - you won't be able to see it again!

### Step 2: Configure Environment Variables

Create a `.env` file or set environment variables:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
MCP_API_KEY=pb_mcp_your-generated-api-key-here
```

**Important:** 
- The `SUPABASE_SERVICE_ROLE_KEY` is required for the MCP server to access the database
- The `MCP_API_KEY` is the tenant-specific key you generated in the dashboard
- Keep both keys secure and never commit them to version control

### Step 3: Run the Server

```bash
npm run mcp:profitbot
```

Or directly:

```bash
npx tsx mcp-servers/profitbot/index.ts
```

You should see: `ProfitBot MCP server running on stdio (workspace: <workspace-id>)`

## Integration Options

The ProfitBot MCP server can be used with:

1. **OpenClaw** - Via stdio MCP protocol (see below)
2. **N8N** - Via HTTP API calls (see [N8N_INTEGRATION.md](./N8N_INTEGRATION.md))

## Connecting to OpenClaw

### MCP Configuration

Add the ProfitBot MCP server to your OpenClaw configuration (typically in `~/.cursor/mcp.json` or similar):

```json
{
  "mcpServers": {
    "profitbot-netzero": {
      "command": "npm",
      "args": ["run", "mcp:profitbot"],
      "cwd": "/absolute/path/to/profitbotai",
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "MCP_API_KEY": "pb_mcp_your-generated-api-key-here"
      }
    }
  }
}
```

**For multiple tenants**, create separate MCP server entries:

```json
{
  "mcpServers": {
    "profitbot-netzero": {
      "command": "npm",
      "args": ["run", "mcp:profitbot"],
      "cwd": "/absolute/path/to/profitbotai",
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "MCP_API_KEY": "pb_mcp_netzero-key-here"
      }
    },
    "profitbot-tenant2": {
      "command": "npm",
      "args": ["run", "mcp:profitbot"],
      "cwd": "/absolute/path/to/profitbotai",
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "MCP_API_KEY": "pb_mcp_tenant2-key-here"
      }
    }
  }
}
```

### Using Environment Variables from .env

If your `.env` file is in the project root, you can reference it:

```json
{
  "mcpServers": {
    "profitbot-netzero": {
      "command": "npm",
      "args": ["run", "mcp:profitbot"],
      "cwd": "/absolute/path/to/profitbotai"
    }
  }
}
```

Note: You'll need to create separate `.env` files or use different environment variable sources for each tenant.

## Available Tools

### Leadflow Tools

#### `list_leads`
List all leads in the pipeline.

**Parameters:**
- `widgetId` (optional): Filter by widget ID

**Example:**
```json
{
  "name": "list_leads",
  "arguments": {
    "widgetId": "widget-123"
  }
}
```

#### `move_lead`
Move a lead to a different stage.

**Parameters:**
- `leadId` (required): Lead ID
- `stageId` (required): Target stage ID

#### `list_lead_stages`
List all pipeline stages.

#### `create_lead_stage`
Create a new stage.

**Parameters:**
- `name` (required): Stage name
- `sortOrder` (optional): Sort order (default: 999)

#### `update_lead_stage`
Update a stage.

**Parameters:**
- `stageId` (required): Stage ID
- `name` (optional): New name
- `sortOrder` (optional): New sort order

#### `delete_lead_stage`
Delete a stage. Leads in this stage are moved to the first remaining stage.

### Messaging Tools

#### `send_message`
Send a message as a human agent in a conversation.

**Parameters:**
- `conversationId` (required): Conversation ID
- `content` (required): Message content

**Example:**
```json
{
  "name": "send_message",
  "arguments": {
    "conversationId": "conv-123",
    "content": "Hello! How can I help you today?"
  }
}
```

#### `list_conversations`
List conversations.

**Parameters:**
- `widgetId` (optional): Filter by widget ID

#### `get_conversation_messages`
Get messages from a conversation.

**Parameters:**
- `conversationId` (required): Conversation ID
- `limit` (optional): Max messages (default: 50)

### Contact Tools

#### `list_contacts`
List contacts with pagination and search.

**Parameters:**
- `widgetId` (optional): Filter by widget ID
- `search` (optional): Search query (searches name and email)
- `limit` (optional): Results per page (default: 50, max: 50)
- `page` (optional): Page number (default: 1)

#### `get_contact`
Get contact details by ID.

### Widget Tools

#### `list_widgets`
List all widgets for the workspace.

#### `get_widget`
Get widget details by ID.

## Security Considerations

### Tenant Isolation
- ✅ Each MCP API key is scoped to a single workspace
- ✅ All operations automatically filter by workspace_id
- ✅ Cross-tenant access is prevented at the database level
- ✅ API keys can be revoked/deleted at any time

### Best Practices
1. **Generate separate keys per tenant** - Don't share keys between tenants
2. **Rotate keys regularly** - Delete old keys and create new ones
3. **Monitor key usage** - Check `last_used_at` in the dashboard
4. **Use descriptive names** - Name keys like "OpenClaw Production" or "OpenClaw Staging"
5. **Keep service role key secure** - Never expose it to clients or commit to git

### Access Control
- MCP keys inherit the permissions of the user who created them
- All operations respect Row Level Security (RLS) policies
- The service role key is only used for database access, not for user impersonation

## Troubleshooting

### "Invalid MCP API key"
- Verify the API key is correct (check for typos)
- Ensure the key hasn't been deleted
- Check that the key belongs to the correct workspace

### "Access denied: resource belongs to different workspace"
- This means you're trying to access a resource from a different tenant
- Verify you're using the correct MCP API key for the tenant
- Check that the resource ID is correct

### Server won't start
- Check that all environment variables are set correctly
- Verify the Supabase project is accessible
- Ensure the API key exists in the database

### Tools return empty results
- Verify you're using the correct API key for the tenant
- Check that the workspace has data (widgets, leads, etc.)
- Review error messages for specific issues

## Multi-Tenant Setup Example

For a deployment with multiple tenants (e.g., "NetZero Coating" and "Another Company"):

1. **Tenant 1 (NetZero Coating)**:
   - Generate MCP key in NetZero's dashboard
   - Configure OpenClaw with key: `pb_mcp_netzero_...`
   - OpenClaw can only access NetZero's data

2. **Tenant 2 (Another Company)**:
   - Generate MCP key in Another Company's dashboard
   - Configure OpenClaw with key: `pb_mcp_another_...`
   - OpenClaw can only access Another Company's data

Each tenant gets their own isolated OpenClaw connection!

## Development

To extend the MCP server:

1. Add new methods to the `ProfitBotClient` class
2. Ensure all queries filter by `workspace_id` or use workspace-scoped joins
3. Add corresponding tool definitions in `setupToolHandlers`
4. Add tool handlers in the `CallToolRequestSchema` handler
5. Update this README with new tool documentation

## N8N Integration

You can also use the ProfitBot MCP server with N8N workflows! See the detailed guide:

- **[N8N_INTEGRATION.md](./N8N_INTEGRATION.md)** - Complete guide for using ProfitBot MCP with N8N
- **[N8N_QUICK_REFERENCE.md](./N8N_QUICK_REFERENCE.md)** - Quick reference for common actions

The ProfitBot MCP server exposes an HTTP API endpoint (`/api/mcp`) that N8N can call directly using HTTP Request nodes. This allows you to:
- List widgets, leads, conversations, and contacts
- Send messages and emails
- Generate quotes
- Manage Shopify orders and customers
- And much more!

## License

Same as the ProfitBot project.
