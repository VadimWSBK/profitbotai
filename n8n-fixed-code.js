// Fixed Code node - extracts widgetId from trigger data
// Place this AFTER "Respond to Webhook" node

// Get data from merged inputs
const items = $input.all();

// Find trigger data (has conversationId, widgetId, sessionId)
const triggerData = items.find(item => item.json.conversationId || item.json.widgetId || item.json.sessionId) || items[0] || {};

// Find agent data (has output)
const agentData = items.find(item => item.json.output) || items[0] || {};

// Extract values with fallbacks
const widgetId = triggerData.json.widgetId || '';
const conversationId = triggerData.json.conversationId || '';
const content = agentData.json.output || agentData.json.content || '';

// Return data for HTTP Request node
return {
  widgetId: widgetId,
  conversationId: conversationId,
  role: "assistant",
  content: content
};
