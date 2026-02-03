/**
 * Available third-party integrations for ProfitBot.
 * Used in Integrations page for connect/disconnect UI.
 */

export const INTEGRATIONS = [
	{
		id: 'resend',
		name: 'Resend',
		description: 'Send transactional emails (quotes, follow-ups, etc.) via Resend.',
		icon: 'mail',
		oauth: false,
		configFields: [
			{ id: 'apiKey', label: 'API Key', type: 'password' as const, placeholder: 're_xxxxxxxxxx...' },
			{
				id: 'fromEmail',
				label: 'From email (verified domain)',
				type: 'text' as const,
				placeholder: 'quotes@rs.yourdomain.com'
			}
		]
	},
	{
		id: 'shopify',
		name: 'Shopify',
		description: 'Manage orders, create draft orders, cancel and refund via Shopify. Connect your store with one click.',
		icon: 'bolt',
		oauth: true,
		configFields: [{ id: 'shopDomain', label: 'Shop domain', type: 'text' as const, placeholder: 'your-store.myshopify.com' }]
	}
] as const;

export type IntegrationId = (typeof INTEGRATIONS)[number]['id'];

export function getIntegration(id: string) {
	return INTEGRATIONS.find((i) => i.id === id);
}
