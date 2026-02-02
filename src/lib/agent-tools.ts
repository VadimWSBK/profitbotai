/**
 * Canonical list of agent tool ids and labels for UI (toggles) and filtering.
 * Used by agent-tools.server.ts and agent edit page.
 */

export const AGENT_TOOL_IDS = [
	'search_contacts',
	'get_current_contact',
	'create_contact',
	'update_contact',
	'delete_contact',
	'generate_quote',
	'send_email',
	'send_message',
	'get_leadflow_stages',
	'get_contact_lead_stage',
	'move_contact_to_stage'
] as const;

export type AgentToolId = (typeof AGENT_TOOL_IDS)[number];

export const AGENT_TOOL_LABELS: Record<AgentToolId, string> = {
	search_contacts: 'Search contacts',
	get_current_contact: 'Get current contact',
	create_contact: 'Create contact',
	update_contact: 'Update contact',
	delete_contact: 'Delete contact',
	generate_quote: 'Create quote',
	send_email: 'Send email',
	send_message: 'Send chat message',
	get_leadflow_stages: 'Get leadflow stages',
	get_contact_lead_stage: 'Get contact lead stage',
	move_contact_to_stage: 'Move contact to leadflow stage'
};

/** Default tools when creating a new agent (search, get contact, quote, email). */
export const DEFAULT_AGENT_TOOLS: AgentToolId[] = [
	'search_contacts',
	'get_current_contact',
	'generate_quote',
	'send_email'
];
