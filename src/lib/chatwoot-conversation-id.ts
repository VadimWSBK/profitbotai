/** Synthetic id for Chatwoot conversations in the Messages list */
export function chatwootConversationId(accountId: number, conversationId: number): string {
	return `chatwoot-${accountId}-${conversationId}`;
}

export function parseChatwootConversationId(id: string): { accountId: number; conversationId: number } | null {
	const m = id.match(/^chatwoot-(\d+)-(\d+)$/);
	if (!m) return null;
	return { accountId: Number(m[1]), conversationId: Number(m[2]) };
}
