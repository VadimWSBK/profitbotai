// Code node that searches ALL items for widgetId
// Use this after Merge node

// Get all input items
const items = $input.all();

// Debug: Log all items to see what we have
console.log('Total items:', items.length);
items.forEach((item, index) => {
  console.log(`Item ${index}:`, Object.keys(item.json || {}));
});

// Search ALL items for widgetId and conversationId (from trigger)
let widgetId = '';
let conversationId = '';
let sessionId = '';

// Search all items for trigger data
for (const item of items) {
  const data = item.json || {};
  if (data.widgetId && !widgetId) {
    widgetId = data.widgetId;
  }
  if (data.conversationId && !conversationId) {
    conversationId = data.conversationId;
  }
  if (data.sessionId && !sessionId) {
    sessionId = data.sessionId;
  }
  // Also check for message field (indicates trigger data)
  if (data.message && !widgetId) {
    // This is likely trigger data, check for widgetId
    widgetId = data.widgetId || '';
    conversationId = data.conversationId || conversationId;
  }
}

// Search ALL items for agent output
let content = '';
for (const item of items) {
  const data = item.json || {};
  if (data.output && !content) {
    content = data.output;
  }
  if (data.content && !content) {
    content = data.content;
  }
}

// If still not found, check first item
if (!widgetId && items.length > 0) {
  const firstItem = items[0].json || {};
  widgetId = firstItem.widgetId || '';
  conversationId = firstItem.conversationId || conversationId;
}

// Validate
if (!widgetId) {
  // Show all available data for debugging
  const allData = items.map((item, idx) => ({
    index: idx,
    keys: Object.keys(item.json || {}),
    sample: Object.keys(item.json || {}).reduce((acc, key) => {
      const val = item.json[key];
      // Only show first 50 chars of values to avoid huge output
      acc[key] = typeof val === 'string' ? val.substring(0, 50) : val;
      return acc;
    }, {})
  }));
  
  throw new Error(
    `Missing widgetId! ` +
    `Searched ${items.length} items. ` +
    `Available data: ${JSON.stringify(allData, null, 2)}`
  );
}

if (!conversationId) {
  throw new Error(`Missing conversationId. Found widgetId: ${widgetId ? 'yes' : 'no'}`);
}

if (!content) {
  throw new Error(`Missing content from AI Agent`);
}

// Return formatted data
return {
  widgetId: widgetId,
  conversationId: conversationId,
  role: "assistant",
  content: content
};
