# Shopify postMessage Integration Guide

The ProfitBot chat widget supports bidirectional communication with Shopify stores using the `postMessage` API. This allows your Shopify store to send context (product pages, cart data, etc.) to the widget, and the widget can notify Shopify of events (chat opened, messages sent, etc.).

## How It Works

The widget iframe listens for messages from the parent page (Shopify) and can send messages back. The embed script automatically forwards messages between Shopify and the widget iframe.

## Widget → Shopify Messages

The widget sends these messages to Shopify:

### `profitbot-ready`
Sent when the widget is loaded and ready.

```javascript
{
  type: 'profitbot-ready',
  widgetId: 'your-widget-id',
  sessionId: 'session-id',
  timestamp: 1234567890
}
```

### `profitbot-chat-opened`
Sent when the chat window is opened.

```javascript
{
  type: 'profitbot-chat-opened',
  widgetId: 'your-widget-id',
  sessionId: 'session-id',
  data: {
    context: { /* Shopify context if available */ }
  },
  timestamp: 1234567890
}
```

### `profitbot-chat-closed`
Sent when the chat window is closed.

```javascript
{
  type: 'profitbot-chat-closed',
  widgetId: 'your-widget-id',
  sessionId: 'session-id',
  timestamp: 1234567890
}
```

### `profitbot-message-sent`
Sent when a user sends a message in the chat.

```javascript
{
  type: 'profitbot-message-sent',
  widgetId: 'your-widget-id',
  sessionId: 'session-id',
  data: {
    message: 'User message text',
    context: { /* Shopify context if available */ }
  },
  timestamp: 1234567890
}
```

### `profitbot-context-request`
Sent when the widget requests context from Shopify.

```javascript
{
  type: 'profitbot-context-request',
  widgetId: 'your-widget-id',
  sessionId: 'session-id',
  timestamp: 1234567890
}
```

## Shopify → Widget Messages

Shopify can send these messages to the widget:

### `shopify-context`
Send page context (product, collection, cart, etc.) to the widget.

```javascript
window.postMessage({
  type: 'shopify-context',
  data: {
    page: 'product', // 'home' | 'product' | 'collection' | 'cart' | 'checkout' | 'other'
    productId: '123',
    productTitle: 'Cool Product',
    productPrice: '$99.99',
    collectionId: '456',
    cartTotal: 199.98,
    cartItemCount: 2,
    currency: 'USD',
    visitorId: 'visitor-123'
  }
}, '*');
```

### `shopify-cart-update`
Send cart updates to the widget.

```javascript
window.postMessage({
  type: 'shopify-cart-update',
  data: {
    cartTotal: 149.99,
    cartItemCount: 3,
    currency: 'USD'
  }
}, '*');
```

### `shopify-page-view`
Notify widget of page navigation.

```javascript
window.postMessage({
  type: 'shopify-page-view',
  data: {
    page: 'product',
    productId: '123',
    productTitle: 'Cool Product'
  }
}, '*');
```

### `shopify-product-view`
Notify widget when a product is viewed.

```javascript
window.postMessage({
  type: 'shopify-product-view',
  data: {
    productId: '123',
    productTitle: 'Cool Product',
    productPrice: '$99.99',
    productHandle: 'cool-product'
  }
}, '*');
```

## Shopify Implementation Example

Add this to your Shopify theme (e.g., in `theme.liquid` or a custom section):

```javascript
<script>
(function() {
  // Listen for widget events
  window.addEventListener('message', function(event) {
    // Verify origin for security (in production, check against your widget domain)
    // if (event.origin !== 'https://app.profitbot.ai') return;
    
    if (event.data && event.data.type) {
      switch(event.data.type) {
        case 'profitbot-ready':
          console.log('ProfitBot widget is ready', event.data);
          // Send initial context
          sendShopifyContext();
          break;
        case 'profitbot-chat-opened':
          console.log('Chat opened', event.data);
          // Track analytics, etc.
          break;
        case 'profitbot-message-sent':
          console.log('Message sent', event.data);
          // Track user engagement
          break;
      }
    }
  });
  
  // Send Shopify context to widget
  function sendShopifyContext() {
    var context = {
      page: getCurrentPage(),
      currency: Shopify.currency?.active || 'USD'
    };
    
    // Add product context if on product page
    if (context.page === 'product' && window.ShopifyAnalytics?.meta?.product) {
      var product = window.ShopifyAnalytics.meta.product;
      context.productId = product.id;
      context.productTitle = product.title;
      context.productPrice = product.price;
    }
    
    // Add cart context
    fetch('/cart.js')
      .then(r => r.json())
      .then(cart => {
        context.cartTotal = cart.total_price / 100;
        context.cartItemCount = cart.item_count;
        
        window.postMessage({
          type: 'shopify-context',
          data: context
        }, '*');
      })
      .catch(() => {
        window.postMessage({
          type: 'shopify-context',
          data: context
        }, '*');
      });
  }
  
  function getCurrentPage() {
    if (window.location.pathname === '/') return 'home';
    if (window.location.pathname.startsWith('/products/')) return 'product';
    if (window.location.pathname.startsWith('/collections/')) return 'collection';
    if (window.location.pathname === '/cart') return 'cart';
    if (window.location.pathname.startsWith('/checkouts/')) return 'checkout';
    return 'other';
  }
  
  // Send context on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sendShopifyContext);
  } else {
    sendShopifyContext();
  }
  
  // Send context on cart updates (if using AJAX cart)
  document.addEventListener('cart:updated', function() {
    sendShopifyContext();
  });
  
  // Send context on product page view
  if (window.location.pathname.startsWith('/products/')) {
    window.postMessage({
      type: 'shopify-product-view',
      data: {
        productId: window.ShopifyAnalytics?.meta?.product?.id,
        productTitle: window.ShopifyAnalytics?.meta?.product?.title,
        productPrice: window.ShopifyAnalytics?.meta?.product?.price
      }
    }, '*');
  }
})();
</script>
```

## Security Considerations

1. **Origin Verification**: In production, verify `event.origin` matches your widget domain:
   ```javascript
   if (event.origin !== 'https://app.profitbot.ai') return;
   ```

2. **Message Validation**: Always validate message structure before processing:
   ```javascript
   if (!event.data || typeof event.data !== 'object' || !event.data.type) return;
   ```

3. **Sensitive Data**: Don't send sensitive customer data (passwords, payment info) via postMessage.

## Use Cases

- **Product Context**: Send product info when user is viewing a product page
- **Cart Tracking**: Update widget with cart value and item count
- **Analytics**: Track when users open chat or send messages
- **Personalization**: Use Shopify context to personalize chat responses
- **Abandoned Cart**: Trigger chat when cart value exceeds threshold

## Testing

1. Open browser DevTools → Console
2. Check for `[ProfitBot]` log messages
3. Test sending messages from Shopify console:
   ```javascript
   window.postMessage({
     type: 'shopify-context',
     data: { page: 'product', productId: '123' }
   }, '*');
   ```
4. Verify widget receives and processes the context

## Troubleshooting

- **Messages not received**: Check browser console for errors, verify iframe is loaded
- **Origin errors**: Ensure origin verification allows your widget domain
- **Context not updating**: Verify message format matches expected structure
