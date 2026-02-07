// Code node with debugging - finds widgetId from trigger data
// Place AFTER "Respond to Webhook" node

// Get all input items
const items = $input.all();

// Find trigger data (from "When chat message received")
// This should have: message, sessionId, widgetId, conversationId
const triggerData = items.find(item => 
  item.json.message || 
  item.json.sessionId ||
  item.json.widgetId ||
  item.json.conversationId
) || items[0] || {};

// Find agent output (from "AI Agent")
const agentData = items.find(item => 
  item.json.output
) || items[0] || {};

// Extract widgetId - check multiple possible locations
const widgetId = triggerData.json?.widgetId || 
                 triggerData.json?.widget_id ||
                 '';

// Extract conversationId
const conversationId = triggerData.json?.conversationId || 
                      triggerData.json?.conversation_id ||
                      '';

// Extract content from agent output
const content = agentData.json?.output || 
                agentData.json?.content || 
                '';

// CRITICAL: If widgetId is missing, we can't make the API call
if (!widgetId) {
  // Log all available data for debugging
  const allFields = items.map(item => ({
    keys: Object.keys(item.json || {}),
    sample: item.json
  }));
  
  throw new Error(
    `Missing widgetId in webhook payload. ` +
    `Available fields in trigger: ${JSON.stringify(Object.keys(triggerData.json || {}))}. ` +
    `All items: ${JSON.stringify(allFields)}`
  );
}

if (!conversationId) {
  throw new Error(
    `Missing conversationId. ` +
    `Available fields: ${JSON.stringify(Object.keys(triggerData.json || {}))}`
  );
}

if (!content) {
  throw new Error(
    `Missing content from AI Agent. ` +
    `Agent data: ${JSON.stringify(agentData.json || {})}`
  );
}

// Return formatted data for HTTP Request node
return {
  widgetId: widgetId,
  conversationId: conversationId,
  role: "assistant",
  content: content
};
