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
		configFields: [
			{ id: 'apiKey', label: 'API Key', type: 'password' as const, placeholder: 're_xxxxxxxxxx...' }
		]
	}
] as const;

export type IntegrationId = (typeof INTEGRATIONS)[number]['id'];

export function getIntegration(id: string) {
	return INTEGRATIONS.find((i) => i.id === id);
}
