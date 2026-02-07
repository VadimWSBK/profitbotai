#!/usr/bin/env node
/**
 * Quick verification script to check if Shopify tools are in the MCP server
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const httpClientPath = join(__dirname, 'http-client.ts');
const content = readFileSync(httpClientPath, 'utf-8');

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

console.log('Checking for Shopify tools in http-client.ts...\n');

let allFound = true;
for (const tool of shopifyTools) {
  const inToolList = content.includes(`name: '${tool}'`);
  const inActionMap = content.includes(`${tool}: '${tool}'`);
  
  if (inToolList && inActionMap) {
    console.log(`✅ ${tool} - Found in tool list and action map`);
  } else {
    console.log(`❌ ${tool} - Missing!`);
    if (!inToolList) console.log(`   - Not in tool list`);
    if (!inActionMap) console.log(`   - Not in action map`);
    allFound = false;
  }
}

console.log('\n' + '='.repeat(50));
if (allFound) {
  console.log('✅ All Shopify tools are properly configured!');
  console.log('\n⚠️  IMPORTANT: Restart the MCP server in OpenClaw for changes to take effect.');
  console.log('   The server needs to be restarted to load the new tool definitions.');
} else {
  console.log('❌ Some tools are missing. Please check the file.');
}
