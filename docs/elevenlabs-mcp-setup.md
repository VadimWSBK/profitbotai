# ElevenLabs MCP Setup – Pricing & Quotes for Voice Calls

Connect your ElevenLabs Conversational AI (voice) agent to ProfitBot so customers who call can request quotes, DIY pricing, and checkout links.

## Overview

When a customer calls and asks for pricing, the ElevenLabs agent uses ProfitBot MCP tools to:

- **Generate quotes** – PDF roof quotes sent to their email  
- **Get product pricing** – DIY product buckets (15L, 10L, 5L) and pricing  
- **Create DIY checkout** – Personalized checkout link for products  
- **Look up contacts & conversations** – Use call context to find the right customer  

## Prerequisites

1. **ProfitBot MCP API Key** – [Settings → MCP API Keys](https://app.profitbot.ai/settings) in the ProfitBot dashboard.
2. **ElevenLabs agent** – A Conversational AI agent configured for telephony.
3. **Deployed ProfitBot** – The MCP endpoint must be reachable at `https://app.profitbot.ai/api/mcp/sse`.

---

## Step 1: Create MCP API Key in ProfitBot

1. Log in to [ProfitBot](https://app.profitbot.ai).
2. Go to **Settings** → **MCP API Keys**.
3. Click **Create Key** and name it e.g. “ElevenLabs Voice Agent”.
4. Copy the key (`pb_mcp_...`) and store it securely.

---

## Step 2: Add Custom MCP Server in ElevenLabs

1. Open the [ElevenLabs MCP integrations dashboard](https://elevenlabs.io/app/agents/integrations).
2. Click **Add Custom MCP Server**.
3. Use the form from the screenshot and fill in:

| Field | Value |
|-------|-------|
| **Name** | ProfitBot Pricing |
| **Description** | Quote generation, DIY pricing, and checkout links for callers |
| **Server type** | SSE (or Streamable HTTP) |
| **Server URL** | `https://app.profitbot.ai/api/mcp/sse` |
| **Secret Token** | Your MCP API key (`pb_mcp_...`) |

4. Optional: **HTTP Headers** for call context  
   - `X-Widget-Id: <your-default-widget-id>` – default widget for this agent  
   - `X-Conversation-Id` – ElevenLabs may inject this from the call

5. Check **I trust this server**.
6. Click **Add Server**.

---

## Step 3: Add MCP Server to Your Agent

1. In ElevenLabs, open your **Conversational AI agent**.
2. Go to **Tools** → **MCP servers**.
3. Add the **ProfitBot Pricing** MCP server.
4. Use **Tool approval modes** as needed:
   - **Always Ask** – approve each tool use (recommended for quotes/checkout)
   - **Auto-approved** – low-risk tools (e.g. `get_product_pricing`)
   - **Requires approval** – higher-risk tools (e.g. `generate_quote`, `create_diy_checkout`)

---

## Step 4: Configure Call Context (Telephony)

For voice calls, the agent needs `widgetId` and `conversationId` for quotes and checkouts.

### Option A: Default widget via HTTP header

In the MCP server config, add an HTTP header:

```
X-Widget-Id: <your-widget-id>
```

The agent will use this widget when a caller requests a quote or checkout.

### Option B: Conversation from call session

If your telephony setup creates a ProfitBot conversation when a call starts, pass the `conversationId` (e.g. via ElevenLabs custom data or webhook) and set:

```
X-Conversation-Id: <conversation-id>
```

### Option C: Agent discovers from customer info

If you don’t pass context, the agent can:

1. Ask for name or email.
2. Use `list_contacts` or `get_contact` to find the contact.
3. Derive `conversationId` or `widgetId` from that contact.

---

## Available Tools for Voice Agents

| Tool | Use when the caller… |
|------|-----------------------|
| `list_widgets` | Needs to choose which site/product line |
| `get_product_pricing` | Asks for DIY product prices |
| `generate_quote` | Wants a written quote / PDF |
| `create_diy_checkout` | Wants to buy products (e.g. roof coating) |
| `get_contact` | You need their details |
| `get_conversation` | You need call/conversation context |
| `get_conversation_messages` | You need prior messages |
| `list_contacts` | Looking up a customer |
| `send_message` | Sending a follow-up message |
| `mcp_call` | Advanced: call any ProfitBot MCP action |

---

## Agent Prompt Suggestions

Example additions to your ElevenLabs agent system prompt:

```text
When a customer asks for a quote:
1. Get their roof size or project details.
2. Use generate_quote with widgetId, conversationId (if available), and customer/project info.
3. Tell them the quote PDF will be sent to their email and share the total.

When a customer asks for DIY pricing:
1. Use get_product_pricing with widgetId or conversationId.
2. Explain the product options (15L, 10L, 5L) and prices.

When a customer wants to buy:
1. Use create_diy_checkout with roof_size_sqm or product counts (count_15l, count_10l, count_5l).
2. Share the checkout link and confirm their email.
```

---

## Testing the Connection

1. In ElevenLabs MCP integrations, click **Test connection** after adding the server.
2. ElevenLabs will list the tools and confirm access.
3. Use the ElevenLabs playground to simulate a call and test:
   - “I need a quote for my roof”
   - “What’s the price for the 15L product?”
   - “I’d like to buy 2 x 15L and 1 x 5L”

---

## Troubleshooting

### "Missing X-MCP-API-Key or Authorization: Bearer header"

- Set **Secret Token** in ElevenLabs MCP config to your `pb_mcp_...` key.
- ElevenLabs sends it as `Authorization: Bearer <key>`.

### "Invalid API key"

- Regenerate the key in ProfitBot Settings → MCP API Keys.
- Update the MCP server’s Secret Token in ElevenLabs.

### "widgetId or conversationId required"

- Configure a default `X-Widget-Id` header in MCP config, or
- Ensure your telephony flow passes `conversationId` via custom data/webhook, or
- Have the agent discover the customer with `list_contacts` and use the widget from their profile.

### Tools not appearing

- Refresh the ElevenLabs MCP integration.
- Confirm the ProfitBot app is deployed and reachable at `https://app.profitbot.ai/api/mcp/sse`.

---

## Security Notes

- **Custom MCP servers** are not verified by ElevenLabs. Only use ProfitBot’s official MCP endpoint.
- **API keys** are tenant-scoped; each key has access only to its workspace.
- **Tool approval**: Prefer “Always Ask” or “Requires approval” for tools that send emails or create checkouts.
- **Revoke keys** in ProfitBot if they are compromised or no longer needed.
