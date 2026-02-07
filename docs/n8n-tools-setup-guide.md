# n8n Tools Setup Guide for AI Agent

This guide shows you how to set up all the tools your AI Agent needs as separate HTTP Request nodes. This approach gives you more control and is easier to debug than using the MCP API.

## Required Tools

You need to create these HTTP Request nodes and add them as Tools to your AI Agent:

1. **Get current contact**
2. **Update contact**
3. **Get product pricing**
4. **Create DIY checkout**
5. **Send email**
6. **Create discount**

---

## 1. Get Current Contact

**Tool name:** `Get current contact`

**Description:** Get the current contact for this conversation (name, email, phone, address, roof size in square meters). ALWAYS call this tool BEFORE generating a DIY checkout or quote to check if the customer's roof size is already saved. If roof size is missing, ask the customer for it before calling Create DIY checkout.

**HTTP Request Node:**
- **Method:** `GET`
- **URL:** `https://app.profitbot.ai/api/widgets/{{ $('When chat message received').item.json.widgetId }}/contacts?conversationId={{ $('When chat message received').item.json.conversationId }}`
- **Headers:** `X-API-Key: <your SIGNED_URL_API_KEY>`
- **Authentication:** None

**Returns:** `{ contact: { name, email, phone, address, roofSizeSqm, ... } }` or `{ contact: null }`

---

## 2. Update Contact

**Tool name:** `Update contact`

**Description:** Update the current contact's information. Use this tool immediately when the customer provides their name, email, address, phone number, or roof size. Always call "Get current contact" first to avoid overwriting existing information with empty values. Only update fields that the customer has actually provided.

**HTTP Request Node:**
- **Method:** `PATCH`
- **URL:** `https://app.profitbot.ai/api/widgets/{{ $('When chat message received').item.json.widgetId }}/contacts`
- **Headers:** 
  - `Content-Type: application/json`
  - `X-API-Key: <your SIGNED_URL_API_KEY>`
- **Body (JSON):** Click **fx** button and enter:
  ```javascript
  {
    "conversationId": $('When chat message received').item.json.conversationId || "",
    "name": $json.name || null,
    "email": $json.email || null,
    "phone": $json.phone || null,
    "street_address": $json.street_address || null,
    "city": $json.city || null,
    "state": $json.state || null,
    "postcode": $json.postcode || null,
    "country": $json.country || null,
    "roof_size_sqm": $json.roof_size_sqm || null
  }
  ```
  (The AI Agent will pass only the fields that need updating)

**Parameters the AI can pass:**
- `conversationId` (required)
- `name` (optional)
- `email` (optional)
- `phone` (optional)
- `street_address` (optional)
- `city` (optional)
- `state` (optional)
- `postcode` (optional)
- `country` (optional)
- `roof_size_sqm` (optional)

---

## 3. Get Product Pricing

**Tool name:** `Get product pricing`

**Description:** Get current DIY product pricing (bucket sizes, prices, coverage in m²). ALWAYS call this tool BEFORE generating a DIY checkout or quote to get current pricing and product variants. The product has a coverage of 0.5L per square metre (1L covers 2 m²). Use this information when explaining coverage to customers.

**HTTP Request Node:**
- **Method:** `GET`
- **URL:** `https://app.profitbot.ai/api/widgets/{{ $('When chat message received').item.json.widgetId }}/product-pricing`
- **Headers:** `X-API-Key: <your SIGNED_URL_API_KEY>`
- **Authentication:** None

**Returns:** `{ products: [ { name, sizeLitres, price, currency, coverageSqm }, ... ] }`

---

## 4. Create DIY Checkout

**Tool name:** `Create DIY checkout`

**Description:** Generate a DIY checkout link with product pricing for the customer's roof. REQUIRES roof_size_sqm (roof size in square meters) - this is mandatory. Before calling this tool, you MUST first call "Get current contact" to check if roofSizeSqm is already saved. If not, ask the customer for their roof size and save it using "Update contact" before calling this tool. Pass `roof_size_sqm` (required) and optionally `discount_percent` (10 or 15) if a discount was created earlier. The tool calculates bucket counts automatically (1L covers 2 m²). Returns a checkout URL and product breakdown.

**HTTP Request Node:**
- **Method:** `POST`
- **URL:** `https://app.profitbot.ai/api/widgets/{{ $('When chat message received').item.json.widgetId }}/diy-checkout`
- **Headers:** 
  - `Content-Type: application/json`
  - `X-API-Key: <your SIGNED_URL_API_KEY>`
- **Body (JSON):** Click **fx** button and enter:
  ```javascript
  {
    "conversationId": $('When chat message received').item.json.conversationId || "",
    "roof_size_sqm": $json.roof_size_sqm || null,
    "discount_percent": $json.discount_percent || null
  }
  ```

**Parameters the AI can pass:**
- `roof_size_sqm` (required) - Roof size in square meters
- `discount_percent` (optional) - 10 or 15
- `conversationId` (optional) - Used to pre-fill contact email

**Returns:** `{ checkoutUrl, lineItemsUI, summary }`

---

## 5. Send Email

**Tool name:** `Send email`

**Description:** Send an email to the current contact for this conversation. Use this tool when the customer asks to receive something by email (e.g. quote link, DIY checkout link, follow-up, summary) or when you've generated a quote or checkout link and want to send it to them. Pass the conversation ID from the chat trigger, and provide subject and body (plain text or simple HTML). Include the quote or checkout URL in the email body. The email is sent using the ProfitBot user's connected Resend account to the contact's email for this conversation. Get the contact first if you need their name for the body.

**HTTP Request Node:**
- **Method:** `POST`
- **URL:** `https://app.profitbot.ai/api/conversations/{{ $('When chat message received').item.json.conversationId }}/send-email`
- **Headers:** 
  - `Content-Type: application/json`
  - `X-API-Key: <your SIGNED_URL_API_KEY>`
- **Body (JSON):** Click **fx** button and enter:
  ```javascript
  {
    "subject": $json.subject || "",
    "body": $json.body || ""
  }
  ```

**Parameters the AI can pass:**
- `subject` (required) - Email subject
- `body` (required) - Email body (plain text or HTML)

---

## 6. Create Discount

**Tool name:** `Create discount`

**Description:** Create a 10% or 15% discount for the customer. Use when the customer asks for a discount. Pass `discount_percent` 10 for a first request, or 15 if they ask for more. Returns a code (CHAT10 or CHAT15) and a message to tell the customer. You must then use the same discount_percent when calling the Create DIY checkout tool so the checkout link includes the discount.

**HTTP Request Node:**
- **Method:** `POST`
- **URL:** `https://app.profitbot.ai/api/widgets/{{ $('When chat message received').item.json.widgetId }}/create-discount`
- **Headers:** 
  - `Content-Type: application/json`
  - `X-API-Key: <your SIGNED_URL_API_KEY>`
- **Body (JSON):** Click **fx** button and enter:
  ```javascript
  {
    "discount_percent": $json.discount_percent || 10
  }
  ```

**Parameters the AI can pass:**
- `discount_percent` (required) - 10 or 15

**Returns:** `{ discountPercent, code, message }`

---

## Adding Tools to AI Agent

1. Create all the HTTP Request nodes above
2. In your **AI Agent** node, go to the **Tools** section
3. Add each HTTP Request node as a tool
4. Make sure each tool has:
   - A clear **Tool name** (e.g., "Get current contact")
   - A detailed **Description** (copy from above)
   - Proper **Parameters** defined (so the AI knows what to pass)

## Why Separate Tools Instead of MCP API?

- **More control**: Each tool is independent and easier to debug
- **Better error messages**: You can see exactly which tool failed
- **Flexibility**: Easy to modify individual tools without affecting others
- **DIY checkout support**: MCP API doesn't support DIY checkout
- **Update contact support**: MCP API doesn't support updating contacts

The MCP API is useful for widget/lead management, but for chat interactions, separate HTTP Request tools work better.
