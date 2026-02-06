# OpenClaw Prompt: ProfitBot MCP Connection

Use this prompt to configure and test your ProfitBot MCP connection in OpenClaw:

---

## Prompt for OpenClaw

```
I have configured a ProfitBot MCP server connection in OpenClaw. The ProfitBot MCP server is configured to connect to the remote ProfitBot instance hosted at https://app.profitbot.ai.

**Configuration Details:**
- MCP Server Name: "profitbot"
- Transport: stdio
- Command: npx tsx /home/node/profitbotai/mcp-servers/profitbot/http-client.ts
- API Endpoint: https://app.profitbot.ai/api/mcp
- Authentication: Uses MCP_API_KEY environment variable (tenant-scoped API key)

**What I need you to do:**

1. **Verify MCP Connection**: Check if the ProfitBot MCP server is available and connected. You should be able to see ProfitBot tools in your available tools list.

2. **List Available ProfitBot Tools**: Show me all the ProfitBot tools that are now available. These should include:
   - Leadflow tools: list_leads, get_lead, move_lead, list_lead_stages, create_lead_stage, update_lead_stage, delete_lead_stage
   - Messaging tools: list_conversations, get_conversation, send_message, get_conversation_messages
   - Contact tools: list_contacts, get_contact
   - Widget tools: list_widgets, get_widget

3. **Test the Connection**: Try calling the `list_widgets` tool to verify the connection is working. This should return a list of widgets for the workspace associated with the MCP API key.

4. **Show Me How to Use It**: Once verified, demonstrate how I can use ProfitBot tools. For example:
   - "List all leads in the pipeline"
   - "Show me conversations for widget [id]"
   - "Move lead [id] to stage [stage-id]"
   - "Send a message to conversation [id]"

**Important Notes:**
- The ProfitBot MCP server is tenant-scoped - it only has access to the workspace associated with the MCP_API_KEY
- All operations are automatically scoped to that workspace for security
- The server connects to the remote Vercel instance, not a local database
- If you see any errors, check that MCP_API_KEY is set correctly in the environment

Please verify the connection and show me the available ProfitBot tools.
```

---

## Quick Test Commands

Once OpenClaw confirms the connection, try these commands:

### Test Basic Connection
```
List all widgets in ProfitBot
```

### Test Leadflow
```
Show me all leads in the pipeline
List all lead stages
```

### Test Messaging
```
List all conversations
```

### Test Contacts
```
List all contacts
```

---

## Troubleshooting

If OpenClaw can't see the ProfitBot tools:

1. **Check MCP Server Status**: Verify the server is running and accessible
2. **Check Environment Variables**: Ensure `MCP_API_KEY` is set in docker-compose
3. **Check Volume Mount**: Verify `/home/node/profitbotai` is correctly mounted
4. **Check tsx Installation**: Ensure `tsx` is installed (should be in startup command)
5. **Check Logs**: Look at OpenClaw logs for MCP connection errors

### Common Issues

**"Command not found: tsx"**
- Solution: The docker-compose startup command should install tsx. Check if it's running.

**"Cannot find module"**
- Solution: The ProfitBot project needs node_modules. Either install them before mounting, or install in container.

**"Invalid API key"**
- Solution: Verify MCP_API_KEY is correct and hasn't been deleted in ProfitBot dashboard.

**"Connection refused"**
- Solution: Check that https://app.profitbot.ai is accessible from the OpenClaw container.

---

## Expected Behavior

When working correctly, OpenClaw should:
1. Show ProfitBot tools in its available tools list
2. Be able to call ProfitBot tools successfully
3. Return data scoped to the workspace associated with the MCP_API_KEY
4. Handle errors gracefully with clear messages

---

## Example Interaction

**User**: "List all leads in ProfitBot"

**OpenClaw**: *Calls `list_leads` tool → Returns list of leads with contact info and stages*

**User**: "Move the lead with ID [id] to the 'Won' stage"

**OpenClaw**: *Calls `list_lead_stages` to find 'Won' stage ID → Calls `move_lead` with lead ID and stage ID → Confirms success*

**User**: "Send a message to conversation [id] saying 'Hello, how can I help?'"

**OpenClaw**: *Calls `send_message` tool → Sends message as human agent → Confirms message sent*
