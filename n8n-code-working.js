// Working Code node for n8n - uses $input.all() instead of $node
// Place AFTER "Respond to Webhook" node

// Get all input items (from previous nodes)
const items = $input.all();

// Find trigger data (has conversationId, widgetId, sessionId)
// Look for item with these fields from "When chat message received"
const triggerData = items.find(item => 
  item.json.conversationId || 
  item.json.widgetId || 
  item.json.sessionId ||
  item.json.message
) || items[0] || {};

// Find agent output (has output field from "AI Agent")
const agentData = items.find(item => 
  item.json.output || 
  item.json.content
) || items[0] || {};

// Extract values with fallbacks
const widgetId = triggerData.json.widgetId || '';
const conversationId = triggerData.json.conversationId || '';
const content = agentData.json.output || agentData.json.content || triggerData.json.output || '';

// Return formatted data for HTTP Request node
return {
  widgetId: widgetId,
  conversationId: conversationId,
  role: "assistant",
  content: content
};
