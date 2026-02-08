/**
 * Native embed script - fully functional widget without iframe
 * Uses scoped CSS (data-profitbot-id attribute) for CSS isolation instead of Shadow DOM.
 * Includes: chat, messages, polling, streaming with character buffer,
 * checkout previews, tooltips, avatars, copy-to-clipboard, scroll FAB,
 * reduced-motion support, mobile full-screen with safe areas, etc.
 * 
 * This file now imports from modular source files for better maintainability.
 * The modules are combined into a single embeddable script at build time.
 */
import { EMBED_SCRIPT } from './modules/index.js';

export const GET = () => {
	return new Response(EMBED_SCRIPT, {
		headers: {
			'Content-Type': 'application/javascript; charset=utf-8',
			'Cache-Control': 'public, max-age=300'
		}
	});
};
