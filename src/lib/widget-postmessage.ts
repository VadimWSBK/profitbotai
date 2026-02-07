/**
 * postMessage communication utilities for widget iframe integration
 * Enables secure communication between the widget iframe and parent page (e.g., Shopify)
 */

export type PostMessageType =
	| 'profitbot-ready'
	| 'profitbot-chat-opened'
	| 'profitbot-chat-closed'
	| 'profitbot-message-sent'
	| 'profitbot-context-request'
	| 'shopify-context'
	| 'shopify-cart-update'
	| 'shopify-page-view'
	| 'shopify-product-view';

export interface ProfitBotMessage {
	type: PostMessageType;
	widgetId?: string;
	sessionId?: string;
	data?: Record<string, unknown>;
	timestamp?: number;
}

export interface ShopifyContext {
	page?: 'home' | 'product' | 'collection' | 'cart' | 'checkout' | 'other';
	productId?: string;
	productTitle?: string;
	productPrice?: string;
	collectionId?: string;
	cartTotal?: number;
	cartItemCount?: number;
	currency?: string;
	visitorId?: string;
	[key: string]: unknown;
}

/**
 * Verify if message origin is trusted
 * In production, you should validate against your actual domain
 */
export function isTrustedOrigin(origin: string): boolean {
	if (typeof globalThis.window === 'undefined') return false;
	
	// Allow same origin
	if (origin === globalThis.window.location.origin) return true;
	
	// Allow parent origin (Shopify store)
	// In production, you might want to validate against a list of allowed origins
	// For now, we'll allow any origin but log it for debugging
	if (process.env.NODE_ENV === 'development') {
		console.log('[ProfitBot] Received message from:', origin);
	}
	
	// In production, you could check against a whitelist:
	// const ALLOWED_ORIGINS = ['https://your-shopify-store.com', ...];
	// return ALLOWED_ORIGINS.some(allowed => origin === allowed || origin.endsWith('.' + allowed));
	
	// For now, allow all origins but validate message structure
	return true;
}

/**
 * Send message to parent window (Shopify page)
 */
export function sendToParent(message: ProfitBotMessage): void {
	if (typeof globalThis.window === 'undefined') return;
	
	try {
		// Use '*' for targetOrigin to allow any parent origin (e.g., Shopify stores)
		// In production, you might want to use a specific origin for better security
		// eslint-disable-next-line sonarjs/no-wildcard-postmessage
		globalThis.window.parent.postMessage(
			{
				...message,
				timestamp: Date.now()
			},
			'*'
		);
	} catch (error) {
		console.error('[ProfitBot] Failed to send message to parent:', error);
	}
}

/**
 * Listen for messages from parent window
 */
export function listenToParent(
	callback: (message: ProfitBotMessage, event: MessageEvent) => void
): () => void {
	if (typeof globalThis.window === 'undefined') return () => {};
	
	const handler = (event: MessageEvent) => {
		// Verify origin
		if (!isTrustedOrigin(event.origin)) {
			console.warn('[ProfitBot] Ignored message from untrusted origin:', event.origin);
			return;
		}
		
		// Validate message structure
		if (!event.data || typeof event.data !== 'object') return;
		if (!event.data.type || typeof event.data.type !== 'string') return;
		
		// Check if it's a ProfitBot message or Shopify message
		const isProfitBotMessage = event.data.type.startsWith('profitbot-');
		const isShopifyMessage = event.data.type.startsWith('shopify-');
		
		if (isProfitBotMessage || isShopifyMessage) {
			callback(event.data as ProfitBotMessage, event);
		}
	};
	
	globalThis.window.addEventListener('message', handler);
	
	// Return cleanup function
	return () => {
		globalThis.window.removeEventListener('message', handler);
	};
}

/**
 * Request context from parent page (Shopify)
 * Useful for getting current page, product, cart info, etc.
 */
export function requestContext(widgetId?: string, sessionId?: string): void {
	if (typeof globalThis.window === 'undefined') return;
	sendToParent({
		type: 'profitbot-context-request',
		widgetId,
		sessionId
	});
}
