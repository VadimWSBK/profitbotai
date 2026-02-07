// Final Code node - extracts data for storing messages
// Place AFTER "Respond to Webhook" node

// Get data from all input items
const items = $input.all();

// Find trigger data (from "When chat message received")
const triggerData = items.find(item => 
  item.json.conversationId || 
  item.json.widgetId || 
  item.json.sessionId
) || items[0] || {};

// Find agent output (from "AI Agent")
const agentData = items.find(item => item.json.output) || items[0] || {};

// Extract values
const widgetId = triggerData.json.widgetId || '';
const conversationId = triggerData.json.conversationId || '';
const sessionId = triggerData.json.sessionId || ''; // Optional fallback
const content = agentData.json.output || agentData.json.content || '';

// Return formatted data for HTTP Request node
// conversationId is preferred, but include sessionId as fallback
return {
  widgetId: widgetId,
  conversationId: conversationId, // Use this - API prefers it
  sessionId: sessionId, // Optional fallback if conversationId missing
  role: "assistant",
  content: content
};
