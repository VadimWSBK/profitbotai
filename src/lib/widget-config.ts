/**
 * Widget customization config – matches n8n chat widget options.
 * Used for live preview and embed code generation.
 */

export type BubbleBorderRadius = 'circle' | 'rounded' | 'none';
export type WindowBorderRadius = 'rounded' | 'none';

export interface BubbleConfig {
	borderRadiusStyle: BubbleBorderRadius;
	backgroundColor: string;
	customIconUrl: string;
	customIconSize: number; // 0–100 %
	customIconBorderRadius: number;
	colorOfInternalIcons: string;
	bubbleSizePx: number;
	rightPositionPx: number;
	bottomPositionPx: number;
	autoOpenBotWindow: boolean;
}

export interface TooltipConfig {
	displayTooltip: boolean;
	hideTooltipOnMobile: boolean;
	message: string;
	backgroundColor: string;
	textColor: string;
	fontSizePx: number;
}

export interface BotMessageSettings {
	backgroundColor: string;
	textColor: string;
	showAvatar: boolean;
	avatarUrl: string;
	showCopyToClipboardIcon: boolean;
}

export interface WindowConfig {
	borderRadiusStyle: WindowBorderRadius;
	avatarSize: number;
	avatarBorderRadius: number;
	messageBorderRadius: number;
	backgroundColor: string;
	showTitleSection: boolean;
	title: string;
	titleAvatarUrl: string;
	// Content & behavior
	welcomeMessage: string;
	customErrorMessage: string;
	starterPrompts: string[];
	starterPromptFontSizePx: number;
	// Starter prompt button colors
	starterPromptBackgroundColor: string;
	starterPromptTextColor: string;
	starterPromptBorderColor: string;
	renderHtmlInBotResponses: boolean;
	clearChatOnReload: boolean;
	showScrollbar: boolean;
	heightPx: number;
	widthPx: number;
	fontSizePx: number;
	botMessageSettings: BotMessageSettings;
	// Header bar
	headerBackgroundColor: string;
	headerTextColor: string;
	headerIconColor: string;
	// Input area
	inputPlaceholder: string;
	inputBackgroundColor: string;
	inputBorderColor: string;
	inputPlaceholderColor: string;
	inputTextColor: string;
	// Send button
	sendButtonBackgroundColor: string;
	sendButtonIconColor: string;
	// Footer
	footerText: string;
	footerBackgroundColor: string;
	footerTextColor: string;
	// Border between sections
	sectionBorderColor: string;
}

/** Bot personality / instructions sent to n8n so the AI Agent can use them (role, tone, rules). */
export interface BotInstructionsConfig {
	/** Who the bot is, e.g. "You are a helpful sales assistant for NetZero Coating." */
	role: string;
	/** How to sound, e.g. "Professional and friendly", "Casual and concise" */
	tone: string;
	/** Extra rules: what to do/avoid, length, language, etc. */
	instructions: string;
}

/** How the widget gets chat replies: n8n webhook or Direct LLM (our backend). */
export type ChatBackend = 'n8n' | 'direct';

/** One webhook trigger: when the AI recognises this intent, call the webhook and use the result in the reply. */
export interface WebhookTrigger {
	/** Unique id used for intent classification (e.g. "roof_quote", "order_status"). */
	id: string;
	/** Display name (e.g. "Roof quote", "Order status"). */
	name: string;
	/** Description for the AI to recognise user intent (e.g. "User asks for a roof sealing quote or cost by area in sqm"). */
	description: string;
	/** Full URL to call (e.g. n8n webhook). POST body: { message, sessionId, conversationId, widgetId }. */
	webhookUrl: string;
	/** Whether this trigger is active. */
	enabled: boolean;
}

export interface WidgetConfig {
	name: string;
	displayMode: 'popup' | 'standalone' | 'embedded';
	bubble: BubbleConfig;
	tooltip: TooltipConfig;
	window: WindowConfig;
	bot: BotInstructionsConfig;
	/** 'n8n' = use n8nWebhookUrl; 'direct' = use our API + user's LLM keys */
	chatBackend: ChatBackend;
	n8nWebhookUrl: string;
	n8nWorkflowId?: string;
	/** When chatBackend is 'direct': primary and optional fallback LLM */
	llmProvider?: string;
	llmModel?: string;
	llmFallbackProvider?: string;
	llmFallbackModel?: string;
	/** Minutes of no live-agent reply before AI takes over again (direct only). Default 5. */
	agentTakeoverTimeoutMinutes?: number;
	/** Webhook triggers: when AI recognises intent, call the webhook and use the result in the reply (direct only). */
	webhookTriggers?: WebhookTrigger[];
	/** Optional agent id: use this agent's system prompt and training (direct only). */
	agentId?: string;
	/** When widget uses an agent: system prompt from agent (Supabase), sent with each message to n8n. */
	agentSystemPrompt?: string;
	/** When true, the agent can use tools: search contacts, generate quote, send email (direct only, no workflow required). */
	agentAutonomy?: boolean;
}

export const defaultBubbleConfig: BubbleConfig = {
	borderRadiusStyle: 'rounded',
	backgroundColor: '#ffc8b8',
	customIconUrl: 'https://www.svgrepo.com/show/362552/chat-centered-dots-bold.svg',
	customIconSize: 60,
	customIconBorderRadius: 15,
	colorOfInternalIcons: '#373434',
	bubbleSizePx: 50,
	rightPositionPx: 20,
	bottomPositionPx: 20,
	autoOpenBotWindow: false
};

export const defaultTooltipConfig: TooltipConfig = {
	displayTooltip: true,
	hideTooltipOnMobile: false,
	message: 'Hi {first_name} 👋 Let\'s Chat.',
	backgroundColor: '#fff9f6',
	textColor: '#1c1c1c',
	fontSizePx: 15
};

export const defaultBotMessageSettings: BotMessageSettings = {
	backgroundColor: '#f36539',
	textColor: '#fafafa',
	showAvatar: true,
	avatarUrl: 'https://www.svgrepo.com/show/334455/bot.svg',
	showCopyToClipboardIcon: false
};

export const defaultWindowConfig: WindowConfig = {
	borderRadiusStyle: 'rounded',
	avatarSize: 40,
	avatarBorderRadius: 25,
	messageBorderRadius: 6,
	backgroundColor: '#ffffff',
	showTitleSection: true,
	title: 'N8N Chat UI Bot',
	titleAvatarUrl: 'https://www.svgrepo.com/show/362552/chat-centered-dots-bold.svg',
	welcomeMessage: 'Hello! This is the default welcome message.',
	customErrorMessage: 'Please connect me to n8n first',
	starterPrompts: ['Who are you?', 'What do you do?'],
	starterPromptFontSizePx: 15,
	starterPromptBackgroundColor: '#f3f4f6',
	starterPromptTextColor: '#1c1c1c',
	starterPromptBorderColor: '#d1d5db',
	renderHtmlInBotResponses: false,
	clearChatOnReload: false,
	showScrollbar: false,
	heightPx: 600,
	widthPx: 400,
	fontSizePx: 16,
	botMessageSettings: defaultBotMessageSettings,
	headerBackgroundColor: '#ffedea',
	headerTextColor: '#1c1c1c',
	headerIconColor: '#374151',
	footerText: 'Free customizable chat widget for n8n | n8nchatui.com',
	inputPlaceholder: 'Type your query',
	inputBackgroundColor: '#ffffff',
	inputBorderColor: '#d1d5db',
	inputPlaceholderColor: '#9ca3af',
	inputTextColor: '#1c1c1c',
	sendButtonBackgroundColor: '#84cc16',
	sendButtonIconColor: '#ffffff',
	footerBackgroundColor: '#ffffff',
	footerTextColor: '#6b7280',
	sectionBorderColor: '#e5e7eb'
};

export const defaultBotInstructionsConfig: BotInstructionsConfig = {
	role: '',
	tone: '',
	instructions: ''
};

export const defaultWidgetConfig: WidgetConfig = {
	name: 'My Chat Widget',
	displayMode: 'popup',
	bubble: defaultBubbleConfig,
	tooltip: defaultTooltipConfig,
	window: defaultWindowConfig,
	bot: defaultBotInstructionsConfig,
	chatBackend: 'n8n',
	n8nWebhookUrl: '',
	llmProvider: '',
	llmModel: '',
	llmFallbackProvider: '',
	llmFallbackModel: '',
	agentTakeoverTimeoutMinutes: 5,
	webhookTriggers: [],
	agentId: '',
	agentAutonomy: false
};
