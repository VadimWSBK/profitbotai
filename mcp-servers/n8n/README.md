# N8N MCP Server

An MCP (Model Context Protocol) server that exposes N8N workflows and executions as tools, allowing AI assistants to interact with your N8N instance through a single MCP connection.

## Features

This MCP server provides the following tools:

- **`list_workflows`** - List all workflows in your N8N instance, optionally filtered by active status
- **`get_workflow`** - Get detailed information about a specific workflow
- **`execute_workflow`** - Execute a workflow with optional input data
- **`list_executions`** - List workflow executions, optionally filtered by workflow ID
- **`get_execution`** - Get detailed information about a specific execution

## Setup

### Prerequisites

1. **N8N Instance** - You need a running N8N instance with API access enabled
2. **API Key** - Create an API key in N8N: Settings → n8n API → Create API Key

### Environment Variables

Create a `.env` file or set these environment variables:

```bash
N8N_BASE_URL=https://your-n8n-instance.com
N8N_API_KEY=your-api-key-here
```

### Installation

The MCP SDK is already installed in the project. If you need to install it separately:

```bash
npm install @modelcontextprotocol/sdk
```

## Usage

### Running the Server

The server uses stdio transport, which is the standard for MCP servers:

```bash
npm run mcp:n8n
```

Or directly with tsx:

```bash
npx tsx mcp-servers/n8n/index.ts
```

### Configuring in Cursor

Add this to your Cursor MCP settings (typically in `~/.cursor/mcp.json` or similar):

**Option 1: Using npm script (recommended)**

```json
{
  "mcpServers": {
    "n8n": {
      "command": "npm",
      "args": ["run", "mcp:n8n"],
      "cwd": "/Users/vadimw/websites/profitbotai",
      "env": {
        "N8N_BASE_URL": "https://your-n8n-instance.com",
        "N8N_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Option 2: Using tsx directly**

```json
{
  "mcpServers": {
    "n8n": {
      "command": "npx",
      "args": ["tsx", "/Users/vadimw/websites/profitbotai/mcp-servers/n8n/index.ts"],
      "env": {
        "N8N_BASE_URL": "https://your-n8n-instance.com",
        "N8N_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Option 3: Using environment variables from shell**

If you prefer to use environment variables from your shell:

```json
{
  "mcpServers": {
    "n8n": {
      "command": "npm",
      "args": ["run", "mcp:n8n"],
      "cwd": "/Users/vadimw/websites/profitbotai"
    }
  }
}
```

Then set the environment variables in your shell profile (`.zshrc`, `.bashrc`, etc.):

```bash
export N8N_BASE_URL=https://your-n8n-instance.com
export N8N_API_KEY=your-api-key-here
```

**Note:** Update the `cwd` path to match your actual project directory.

## Tool Examples

### List All Active Workflows

```json
{
  "tool": "list_workflows",
  "arguments": {
    "active": true
  }
}
```

### Execute a Workflow

```json
{
  "tool": "execute_workflow",
  "arguments": {
    "workflowId": "abc123",
    "inputData": {
      "message": "Hello from MCP",
      "userId": "user-456"
    }
  }
}
```

### List Executions for a Workflow

```json
{
  "tool": "list_executions",
  "arguments": {
    "workflowId": "abc123",
    "limit": 10
  }
}
```

## API Reference

The server uses the N8N REST API v1. All requests require authentication via the `X-N8N-API-KEY` header.

### Endpoints Used

- `GET /api/v1/workflows` - List workflows
- `GET /api/v1/workflows/{id}` - Get workflow details
- `POST /api/v1/workflows/{id}/execute` - Execute workflow
- `GET /api/v1/executions` - List executions
- `GET /api/v1/executions/{id}` - Get execution details

## Troubleshooting

### "Missing required environment variables" Error

Make sure `N8N_BASE_URL` and `N8N_API_KEY` are set in your environment or MCP configuration.

### "N8N API error (401)" Error

Your API key is invalid or expired. Generate a new one in N8N Settings → n8n API.

### "N8N API error (404)" Error

The workflow or execution ID doesn't exist, or your N8N instance URL is incorrect.

### Server Not Starting

Make sure you have `tsx` installed globally or as a dev dependency:

```bash
npm install -g tsx
# or
npm install --save-dev tsx
```

## Development

To modify the server, edit `mcp-servers/n8n/index.ts`. The server will automatically reload when restarted.

To add new tools, add them to:
1. The `tools` array in `ListToolsRequestSchema` handler
2. The switch statement in `CallToolRequestSchema` handler
3. Add corresponding methods to the `N8NClient` class if needed

## License

Same as the main project.
