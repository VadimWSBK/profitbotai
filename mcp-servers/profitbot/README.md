# ProfitBot MCP Server

A comprehensive Model Context Protocol (MCP) server that exposes ProfitBot functionality to AI assistants like OpenClaw. This server provides tools to manage widgets, agents, team members, analytics, contacts, conversations, and training data.

## Features

### Widget Management
- List all widgets (with optional workspace filtering)
- Get widget details by ID
- Create new widgets
- Update existing widgets
- Delete widgets

### Agent Management
- List all agents
- Get agent details by ID
- Create new agents
- Update existing agents
- Delete agents

### Team Management
- List team members for a workspace
- Get workspace ID for a user

### Analytics
- Get widget events/analytics with filtering by widget ID and date range

### Contacts
- List contacts with pagination and search
- Get contact details by ID

### Conversations
- List conversations (with optional widget filtering)
- Get conversation details by ID

### Training/Documents
- Get documents for a widget
- Count documents for a widget

## Setup

### Prerequisites

1. Node.js and npm installed
2. ProfitBot project with Supabase configured
3. Supabase service role key (for admin access)

### Installation

The MCP server is already included in the ProfitBot project. No additional installation needed.

### Configuration

1. Set environment variables:

```bash
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Or create a `.env` file in the project root:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**Important:** The service role key bypasses Row Level Security (RLS), so keep it secure and never expose it to clients.

### Running the Server

```bash
npm run mcp:profitbot
```

Or directly:

```bash
npx tsx mcp-servers/profitbot/index.ts
```

## Connecting to OpenClaw

### MCP Configuration

Add the ProfitBot MCP server to your OpenClaw configuration (typically in `~/.cursor/mcp.json` or similar):

```json
{
  "mcpServers": {
    "profitbot": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/profitbotai/mcp-servers/profitbot/index.ts"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key"
      }
    }
  }
}
```

Or if using environment variables from `.env`:

```json
{
  "mcpServers": {
    "profitbot": {
      "command": "npm",
      "args": ["run", "mcp:profitbot"],
      "cwd": "/absolute/path/to/profitbotai"
    }
  }
}
```

## Available Tools

### Widget Tools

#### `list_widgets`
List all widgets in ProfitBot.

**Parameters:**
- `workspaceId` (optional): Filter by workspace ID

**Example:**
```json
{
  "name": "list_widgets",
  "arguments": {
    "workspaceId": "workspace-123"
  }
}
```

#### `get_widget`
Get details of a specific widget.

**Parameters:**
- `widgetId` (required): Widget ID

#### `create_widget`
Create a new widget.

**Parameters:**
- `name` (required): Widget name
- `displayMode` (required): "popup" | "standalone" | "embedded"
- `workspaceId` (required): Workspace ID
- `createdBy` (required): User ID of creator
- `config` (optional): Widget configuration object
- `n8nWebhookUrl` (optional): n8n webhook URL

#### `update_widget`
Update an existing widget.

**Parameters:**
- `widgetId` (required): Widget ID
- `name` (optional): New name
- `displayMode` (optional): New display mode
- `config` (optional): Updated configuration
- `n8nWebhookUrl` (optional): Updated webhook URL

#### `delete_widget`
Delete a widget.

**Parameters:**
- `widgetId` (required): Widget ID

### Agent Tools

#### `list_agents`
List all agents.

#### `get_agent`
Get agent details by ID.

#### `create_agent`
Create a new agent.

**Parameters:**
- `name` (required): Agent name
- `createdBy` (required): User ID
- `description` (optional): Agent description
- `systemPrompt` (optional): System prompt

#### `update_agent`
Update an agent.

**Parameters:**
- `agentId` (required): Agent ID
- `name` (optional): New name
- `description` (optional): New description
- `systemPrompt` (optional): New system prompt
- `chatBackend` (optional): Chat backend (e.g., "n8n", "openai")
- `n8nWebhookUrl` (optional): n8n webhook URL
- `botRole` (optional): Bot role description
- `botTone` (optional): Bot tone
- `botInstructions` (optional): Additional instructions

#### `delete_agent`
Delete an agent.

### Team Tools

#### `list_team_members`
List team members for a workspace.

**Parameters:**
- `workspaceId` (required): Workspace ID

#### `get_workspace_id`
Get workspace ID for a user.

**Parameters:**
- `userId` (required): User ID

### Analytics Tools

#### `get_widget_events`
Get widget analytics events.

**Parameters:**
- `widgetId` (optional): Filter by widget ID
- `from` (optional): Start date (ISO 8601)
- `to` (optional): End date (ISO 8601)
- `limit` (optional): Max events (default: 500)

### Contact Tools

#### `list_contacts`
List contacts with pagination.

**Parameters:**
- `widgetId` (optional): Filter by widget ID
- `search` (optional): Search query (searches name and email)
- `limit` (optional): Results per page (default: 50, max: 50)
- `page` (optional): Page number (default: 1)

#### `get_contact`
Get contact details by ID.

**Parameters:**
- `contactId` (required): Contact ID

### Conversation Tools

#### `list_conversations`
List conversations.

**Parameters:**
- `widgetId` (optional): Filter by widget ID

#### `get_conversation`
Get conversation details by ID.

**Parameters:**
- `conversationId` (required): Conversation ID

### Training Tools

#### `get_widget_documents`
Get documents/training data for a widget.

**Parameters:**
- `widgetId` (required): Widget ID

#### `count_widget_documents`
Get count of documents for a widget.

**Parameters:**
- `widgetId` (required): Widget ID

## Security Considerations

⚠️ **Important Security Notes:**

1. **Service Role Key**: This MCP server uses the Supabase service role key, which bypasses Row Level Security (RLS). This gives full database access.

2. **Access Control**: Consider implementing additional access control if exposing this server to untrusted environments.

3. **Environment Variables**: Never commit service role keys to version control. Use environment variables or secure secret management.

4. **Network Security**: If running over a network, ensure proper authentication and encryption.

## Troubleshooting

### Server won't start
- Check that `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set correctly
- Verify the Supabase project is accessible
- Check Node.js version (requires Node.js 18+)

### Tools return errors
- Verify the service role key has proper permissions
- Check that required tables exist in Supabase
- Review error messages for specific issues

### Connection issues with OpenClaw
- Verify the MCP server path is correct
- Check that environment variables are accessible
- Ensure the server starts without errors when run manually

## Development

To extend the MCP server:

1. Add new methods to the `ProfitBotClient` class
2. Add corresponding tool definitions in `setupToolHandlers`
3. Add tool handlers in the `CallToolRequestSchema` handler
4. Update this README with new tool documentation

## License

Same as the ProfitBot project.
