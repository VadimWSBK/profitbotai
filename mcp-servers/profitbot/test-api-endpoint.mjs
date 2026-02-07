#!/usr/bin/env node
/**
 * Test script to verify the MCP API endpoint returns Shopify tools
 * 
 * Usage:
 *   MCP_API_KEY=your_key node test-api-endpoint.mjs
 */

const MCP_API_KEY = process.env.MCP_API_KEY;
const PROFITBOT_API_URL = process.env.PROFITBOT_API_URL || 'https://app.profitbot.ai';

if (!MCP_API_KEY) {
  console.error('❌ Error: MCP_API_KEY environment variable is required');
  console.log('\nUsage:');
  console.log('  MCP_API_KEY=your_key node test-api-endpoint.mjs');
  process.exit(1);
}

async function testAPI() {
  console.log('Testing MCP API endpoint...\n');
  console.log(`API URL: ${PROFITBOT_API_URL}/api/mcp`);
  console.log(`API Key: ${MCP_API_KEY.substring(0, 10)}...\n`);

  try {
    // Test 1: List all tools
    console.log('Test 1: Listing all available tools...');
    const listToolsResponse = await fetch(`${PROFITBOT_API_URL}/api/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MCP-API-Key': MCP_API_KEY,
      },
      body: JSON.stringify({ action: 'list_tools' }),
    });

    if (!listToolsResponse.ok) {
      const errorText = await listToolsResponse.text();
      console.error(`❌ API request failed: ${listToolsResponse.status}`);
      console.error(`   Response: ${errorText}`);
      process.exit(1);
    }

    const listToolsData = await listToolsResponse.json();
    
    if (!listToolsData.success) {
      console.error(`❌ API returned error: ${listToolsData.error}`);
      process.exit(1);
    }

    const tools = listToolsData.data?.tools || [];
    console.log(`✅ Found ${tools.length} tools\n`);

    // Check for Shopify tools
    const shopifyTools = [
      'shopify_list_orders',
      'shopify_search_orders',
      'shopify_get_order',
      'shopify_cancel_order',
      'shopify_refund_order',
      'shopify_list_customers',
      'shopify_get_customer',
      'shopify_get_customer_orders',
      'shopify_list_products',
      'shopify_get_statistics',
    ];

    console.log('Checking for Shopify tools:\n');
    let allFound = true;
    for (const tool of shopifyTools) {
      if (tools.includes(tool)) {
        console.log(`  ✅ ${tool}`);
      } else {
        console.log(`  ❌ ${tool} - MISSING!`);
        allFound = false;
      }
    }

    console.log('\n' + '='.repeat(60));
    if (allFound) {
      console.log('✅ SUCCESS: All Shopify tools are available via the API!');
      console.log('\nThe API endpoint is working correctly.');
      console.log('If OpenClaw still can\'t see the tools, restart the MCP server.');
    } else {
      console.log('❌ FAILURE: Some Shopify tools are missing from the API response.');
      console.log('\nThis indicates the API endpoint needs to be updated.');
    }

    // Test 2: Try calling shopify_get_statistics (will fail if Shopify not connected, but should not be "tool not found")
    console.log('\n' + '='.repeat(60));
    console.log('Test 2: Testing shopify_get_statistics call...');
    
    const statsResponse = await fetch(`${PROFITBOT_API_URL}/api/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MCP-API-Key': MCP_API_KEY,
      },
      body: JSON.stringify({ 
        action: 'shopify_get_statistics',
        days: 30 
      }),
    });

    const statsData = await statsResponse.json();
    
    if (statsResponse.status === 400 && statsData.error?.includes('Shopify is not connected')) {
      console.log('✅ Tool exists! (Shopify not connected, which is expected)');
      console.log('   Error message:', statsData.error);
    } else if (statsResponse.status === 400 && statsData.error?.includes('Unknown action')) {
      console.log('❌ Tool not found! The API doesn\'t recognize shopify_get_statistics');
      console.log('   Error:', statsData.error);
    } else if (statsData.success) {
      console.log('✅ Tool works! Statistics:', JSON.stringify(statsData.data, null, 2));
    } else {
      console.log('⚠️  Unexpected response:', statsData);
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testAPI();
