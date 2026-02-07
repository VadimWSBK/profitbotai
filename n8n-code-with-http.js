// Code node that makes HTTP request directly to save the message
// This should be placed AFTER "Respond to Webhook" node
// Note: Requires n8n version that supports $http helper in Code nodes

// Get data from merged inputs
const items = $input.all();
const triggerData = items.find(item => item.json.conversationId) || items[0] || {};
const agentData = items.find(item => item.json.output) || items[0] || {};

const conversationId = triggerData.json.conversationId || "";
const widgetId = triggerData.json.widgetId || items.find(item => item.json.widgetId)?.json?.widgetId || '';
const content = agentData.json.output || agentData.json.content || "";

// Validate required fields
if (!conversationId) {
  throw new Error("Missing conversationId");
}

if (!widgetId) {
  throw new Error("Missing widgetId");
}

if (!content) {
  throw new Error("Missing content (assistant output)");
}

// Make HTTP request to save the message
try {
  const response = await $http.request({
    method: 'POST',
    url: `https://app.profitbot.ai/api/widgets/${widgetId}/messages/save`,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      conversationId: conversationId,
      role: "assistant",
      content: content
    }
  });

  return {
    success: true,
    savedMessage: response,
    conversationId: conversationId,
    content: content
  };
} catch (error) {
  // Log error but don't fail the workflow
  console.error('Error saving message:', error);
  return {
    success: false,
    error: error.message,
    conversationId: conversationId,
    content: content
  };
}
