// Fixed Code node - properly extracts widgetId from trigger
// Place AFTER "Respond to Webhook" node

// Get all input items
const items = $input.all();

// Debug: Log what we're receiving (remove after fixing)
console.log('All items:', JSON.stringify(items.map(item => item.json), null, 2));

// Find trigger data - it should have widgetId, conversationId, sessionId, message
const triggerData = items.find(item => 
  item.json.widgetId || 
  item.json.conversationId || 
  item.json.sessionId ||
  item.json.message
) || items[0] || {};

// Find agent output - should have 'output' field
const agentData = items.find(item => 
  item.json.output
) || items[0] || {};

// Extract values - check multiple possible locations
const widgetId = triggerData.json?.widgetId || 
                 triggerData.json?.widget_id || 
                 items.find(item => item.json.widgetId)?.json?.widgetId ||
                 '';

const conversationId = triggerData.json?.conversationId || 
                      triggerData.json?.conversation_id ||
                      items.find(item => item.json.conversationId)?.json?.conversationId ||
                      '';

const content = agentData.json?.output || 
                agentData.json?.content || 
                triggerData.json?.output ||
                '';

// Validate required fields
if (!widgetId) {
  throw new Error(`Missing widgetId. Available fields: ${JSON.stringify(Object.keys(triggerData.json || {}))}`);
}

if (!conversationId) {
  throw new Error(`Missing conversationId. Available fields: ${JSON.stringify(Object.keys(triggerData.json || {}))}`);
}

if (!content) {
  throw new Error(`Missing content. Agent data: ${JSON.stringify(agentData.json || {})}`);
}

// Return formatted data for HTTP Request node
return {
  widgetId: widgetId,
  conversationId: conversationId,
  role: "assistant",
  content: content
};
