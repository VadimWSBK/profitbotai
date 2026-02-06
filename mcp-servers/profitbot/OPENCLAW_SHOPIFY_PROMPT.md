# OpenClaw Prompt: Shopify Integration via ProfitBot MCP

Use this prompt to notify OpenClaw about the new Shopify tools available through the ProfitBot MCP connection.

---

## Prompt for OpenClaw

```
I have connected Shopify to my ProfitBot MCP server. The ProfitBot MCP server now has access to Shopify tools that allow me to manage orders, customers, and products in my Shopify store.

**Shopify Integration Status:**
- Shopify is connected to my ProfitBot workspace
- The MCP server has access to Shopify Admin API through the connected store
- All Shopify operations are scoped to my workspace's Shopify store

**Available Shopify Tools:**

### Order Management Tools

1. **`shopify_list_orders`** - List recent orders from Shopify
   - Parameters: `limit` (optional, default: 10, max: 250)
   - Returns: List of recent orders with details like order number, email, status, total price, etc.
   - Example: "Show me the last 20 orders from Shopify"

2. **`shopify_search_orders`** - Search for orders by query (order number, email, customer name, etc.)
   - Parameters: `query` (required - search term), `limit` (optional, default: 10, max: 50)
   - Returns: Matching orders based on the search query
   - Example: "Search for orders with email john@example.com"

3. **`shopify_get_order`** - Get detailed information about a specific order
   - Parameters: `orderId` (required - numeric Shopify order ID)
   - Returns: Full order details including line items, customer info, financial status, fulfillment status
   - Example: "Get details for order ID 12345"

4. **`shopify_cancel_order`** - Cancel a Shopify order
   - Parameters: 
     - `orderId` (required - numeric Shopify order ID)
     - `reason` (optional - cancellation reason)
     - `notify` (optional - boolean, send cancellation email to customer)
     - `restock` (optional - boolean, restock inventory)
   - Returns: Success confirmation
   - Example: "Cancel order 12345 and notify the customer"

5. **`shopify_refund_order`** - Refund a Shopify order in full
   - Parameters:
     - `orderId` (required - numeric Shopify order ID)
     - `notify` (optional - boolean, send refund notification email)
     - `note` (optional - refund note/reason)
   - Returns: Success confirmation
   - Example: "Refund order 12345 and notify the customer"

6. **`shopify_get_customer_orders`** - Get all orders for a specific customer
   - Parameters: `customerId` (required - numeric Shopify customer ID)
   - Returns: List of all orders for that customer
   - Example: "Show me all orders for customer ID 67890"

### Customer Management Tools

7. **`shopify_list_customers`** - List customers from Shopify store
   - Parameters: `limit` (optional, default: 50, max: 250), `pageInfo` (optional - for pagination)
   - Returns: List of customers with contact information
   - Example: "List the first 100 customers from Shopify"

8. **`shopify_get_customer`** - Get detailed information about a specific customer
   - Parameters: `customerId` (required - numeric Shopify customer ID)
   - Returns: Customer details including email, name, phone, address, order count, total spent
   - Example: "Get details for customer ID 67890"

### Product & Analytics Tools

9. **`shopify_list_products`** - List products from Shopify store
   - Parameters: `limit` (optional, default: 100, max: 250)
   - Returns: List of products with images, variants, and pricing
   - Example: "Show me all products in the store"

10. **`shopify_get_statistics`** - Get store statistics (orders, revenue, AOV)
    - Parameters: `days` (optional, default: 30, max: 365)
    - Returns: Statistics including total orders, total revenue, average order value, currency, and recent orders
    - Example: "Show me store statistics for the last 60 days"

**How to Use These Tools:**

When a user asks about Shopify orders, customers, or store information, use the appropriate Shopify tool:

- **To check order status**: Use `shopify_search_orders` or `shopify_get_order`
- **To cancel an order**: Use `shopify_cancel_order` with the order ID
- **To refund an order**: Use `shopify_refund_order` with the order ID
- **To find customer orders**: Use `shopify_get_customer_orders` with customer ID
- **To look up a customer**: Use `shopify_search_orders` by email or `shopify_list_customers` and filter
- **To get store stats**: Use `shopify_get_statistics`

**Important Notes:**
- All Shopify tools require Shopify to be connected in ProfitBot Settings → Integrations
- Order IDs and Customer IDs are numeric values from Shopify
- When canceling or refunding orders, you can optionally notify the customer and restock inventory
- The tools automatically use the Shopify store connected to the workspace
- If Shopify is not connected, tools will return an error asking to connect Shopify first

**Example Workflows:**

1. **Customer asks to cancel their order:**
   - Search for the order using `shopify_search_orders` with their email or order number
   - Once found, use `shopify_cancel_order` with the order ID
   - Confirm cancellation with the customer

2. **Customer requests a refund:**
   - Find the order using `shopify_get_order` or `shopify_search_orders`
   - Use `shopify_refund_order` with the order ID
   - Optionally include a note explaining the refund reason

3. **Check order status:**
   - Use `shopify_search_orders` to find the order
   - Or use `shopify_get_order` if you have the order ID
   - Report back the financial status, fulfillment status, and order details

4. **Look up customer history:**
   - Find the customer ID using `shopify_list_customers` or `shopify_search_orders`
   - Use `shopify_get_customer_orders` to see all their orders
   - Provide a summary of their purchase history

Please acknowledge that you understand these Shopify tools are now available and demonstrate by listing the available Shopify tools.
```

---

## Quick Test Commands

Once OpenClaw acknowledges the Shopify tools, try these commands:

### Test Order Lookup
```
Search for orders with email test@example.com
```

### Test Order Details
```
Get details for order ID [use a real order ID from your store]
```

### Test Store Statistics
```
Show me store statistics for the last 30 days
```

### Test Customer Lookup
```
List the first 10 customers from Shopify
```

---

## Example Interactions

**User**: "I want to cancel my order #1234"

**OpenClaw**: 
1. Calls `shopify_search_orders` with query "1234"
2. Finds the order and gets order ID
3. Calls `shopify_cancel_order` with orderId, notify: true
4. Confirms: "I've cancelled your order #1234 and sent you a confirmation email."

---

**User**: "Can you refund order 5678? The customer changed their mind."

**OpenClaw**:
1. Calls `shopify_refund_order` with orderId: 5678, notify: true, note: "Customer requested refund"
2. Confirms: "I've processed a full refund for order 5678 and notified the customer."

---

**User**: "What's the status of order #9999?"

**OpenClaw**:
1. Calls `shopify_search_orders` with query "9999" or `shopify_get_order` with orderId: 9999
2. Reports: "Order #9999 is currently [financial_status] with [fulfillment_status] fulfillment. Total: $X.XX"

---

## Troubleshooting

**"Shopify is not connected"**
- The workspace needs to connect Shopify in ProfitBot Settings → Integrations
- The Shopify store must be connected before these tools will work

**"Order not found"**
- Verify the order ID is correct (must be numeric)
- Try using `shopify_search_orders` instead to find the order by email or order number

**"Customer not found"**
- Customer IDs are numeric Shopify customer IDs
- Use `shopify_list_customers` to find the customer ID first
- Or search orders by email to find the customer ID

---

## Tool Reference Summary

| Tool Name | Purpose | Key Parameters |
|-----------|---------|----------------|
| `shopify_list_orders` | List recent orders | `limit` |
| `shopify_search_orders` | Search orders | `query`, `limit` |
| `shopify_get_order` | Get order details | `orderId` |
| `shopify_cancel_order` | Cancel order | `orderId`, `reason`, `notify`, `restock` |
| `shopify_refund_order` | Refund order | `orderId`, `notify`, `note` |
| `shopify_get_customer_orders` | Get customer's orders | `customerId` |
| `shopify_list_customers` | List customers | `limit`, `pageInfo` |
| `shopify_get_customer` | Get customer details | `customerId` |
| `shopify_list_products` | List products | `limit` |
| `shopify_get_statistics` | Get store stats | `days` |
