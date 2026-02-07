// Updated Code node - prepares data for HTTP Request node
// This should be placed AFTER "Respond to Webhook" node

// Get data from merged inputs
const items = $input.all();
const triggerData = items.find(item => item.json.conversationId) || items[0] || {};
const agentData = items.find(item => item.json.output) || items[0] || {};

// Also try to get widgetId from trigger data
const widgetId = triggerData.json.widgetId || items.find(item => item.json.widgetId)?.json?.widgetId || '';

// Return data structure for HTTP Request node
return {
  widgetId: widgetId,
  conversationId: triggerData.json.conversationId || "",
  role: "assistant",
  content: agentData.json.output || agentData.json.content || ""
};
