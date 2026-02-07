// Code node that looks up widgetId from conversationId if missing
// Place AFTER Merge node

const items = $input.all();

// Find conversationId and content
let conversationId = '';
let content = '';

// Search all items
for (const item of items) {
  const data = item.json || {};
  if (data.conversationId && !conversationId) {
    conversationId = data.conversationId;
  }
  if (data.output && !content) {
    content = data.output;
  }
  if (data.widgetId) {
    // If widgetId is found, use it directly
    return {
      widgetId: data.widgetId,
      conversationId: conversationId || data.conversationId,
      role: "assistant",
      content: content || data.output
    };
  }
}

// If widgetId is missing but we have conversationId, look it up via MCP API
if (!conversationId) {
  throw new Error(`Missing conversationId. Available keys: ${items.map(i => Object.keys(i.json || {})).join(', ')}`);
}

if (!content) {
  throw new Error(`Missing content from AI Agent`);
}

// Use ProfitBot MCP API to get widgetId from conversationId
// Note: You'll need to add an HTTP Request node before this Code node
// OR use this code in a Code node that can make HTTP requests

// For now, throw error with instructions
throw new Error(
  `widgetId is missing from webhook payload. ` +
  `You have conversationId: ${conversationId}. ` +
  `Solution: Add an HTTP Request node before this Code node to call: ` +
  `POST https://app.profitbot.ai/api/mcp ` +
  `with body: { "action": "get_conversation", "conversationId": "${conversationId}" } ` +
  `and header: X-MCP-API-Key: your-api-key`
);
