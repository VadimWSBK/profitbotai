# Chatwoot Agent Bot setup

Connect a Chatwoot Agent Bot to a Profitbot agent so that conversations in Chatwoot are answered by your Profitbot AI.

**How it works:** This is a **webhook** integration, not MCP. Chatwoot sends each new message to your Profitbot webhook; Profitbot runs your agent (role, tone, instructions, **Train Bot** rules, and LLM) and posts the reply back. You do **not** train or configure the bot inside Chatwoot—the brain is entirely your Profitbot agent. The bot gets **conversation context** (recent Chatwoot messages) and **knowledge from Profitbot** (Train Bot rules and, when available, agent documents) so it can answer accurately instead of making things up.

## 1. Webhook URL to use in Chatwoot

Each agent has its own webhook URL. In the Profitbot dashboard: **Agents → [your agent] → Chatwoot** tab, copy the URL shown there. It looks like:

```text
https://YOUR-PROFITBOT-DOMAIN/api/webhooks/chatwoot/AGENT-UUID
```

Paste that URL in Chatwoot: **Settings → Bots → Add Bot → Webhook URL**. Chatwoot must be able to reach it over HTTPS.

## 2. Environment variables (Profitbot app)

In your Profitbot app (e.g. `.env` or your host’s env), set:

| Variable | Description |
|----------|-------------|
| `CHATWOOT_AGENT_ID` | UUID of the Profitbot **agent** to use (from your Agents list in the dashboard). This agent’s role, tone, instructions, and LLM are used. |
| `CHATWOOT_BOT_ACCESS_TOKEN` | The bot’s access token from Chatwoot. After creating the bot in Chatwoot, get it via **Settings → Bots → [your bot] → API** or from the Chatwoot API/console when creating the bot. |
| `CHATWOOT_BASE_URL` | Your Chatwoot instance URL, e.g. `https://app.chatwoot.com` or `https://chatwoot.yourcompany.com`. No trailing slash. |

The agent is chosen by the webhook URL (each agent has its own URL), so `CHATWOOT_AGENT_ID` is not needed.

## 3. Chatwoot: create the bot and connect the inbox

1. In Chatwoot: **Settings → Bots → Add Bot**.
2. Set **Bot name**, **Description**, and **Webhook URL** (the URL from step 1).
3. Click **Create Bot**.
4. Copy the bot’s **access token** and set it as `CHATWOOT_BOT_ACCESS_TOKEN` in Profitbot.
5. Open the **inbox** you want the bot to handle → **Bot Configuration** → select this bot → **Save**.

After this, when a user sends a message in that inbox, Chatwoot will POST to your webhook; Profitbot will run the configured agent and post the reply back into the conversation.

## 4. Agent requirements in Profitbot

- The agent must use **Direct** chat (not n8n) in the Connect tab.
- The agent’s owner must have an **LLM API key** set for the agent’s chosen provider (e.g. OpenAI, Anthropic) in **Settings → LLM keys**.

## 5. Context and knowledge (no training in Chatwoot)

- **Conversation context:** Profitbot fetches recent messages from the Chatwoot conversation via the Chatwoot API and sends them to the LLM so the bot has dialogue history.
- **Knowledge from Profitbot:** The bot uses your agent’s **Train Bot** rules (and, where supported, documents) from Profitbot. Configure those in **Agents → [your agent] → Train Bot**. You do **not** need to train or add knowledge inside Chatwoot—the bot uses data and tools from Profitbot only.

## 6. Contact updates (CRM sync)

When a user provides their **name**, **email**, **phone**, or **address** in the conversation, Profitbot updates the Chatwoot contact profile automatically after each reply (address is stored in `additional_attributes`). This uses Chatwoot's [Update Contact](https://developers.chatwoot.com/api-reference/contacts/update-contact) API (`PUT /api/v1/accounts/{account_id}/contacts/{id}`) with the same bot token. No separate webhooks or manual steps are required—contact details collected during the chat are written back to the contact record in Chatwoot so your team sees them in the sidebar and CRM.
