/**
 * Run a workflow server-side (e.g. when "Message in the chat" / "Customer requests quote" trigger fires).
 * Executes actions in order: Generate quote → Send email, etc.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { chatWithLlm } from '$lib/chat-llm.server';
import { generateQuoteForConversation } from '$lib/quote-pdf.server';
import { sendQuoteEmail } from '$lib/send-quote-email.server';

export type WorkflowNode = {
	id: string;
	type: string;
	data?: Record<string, unknown>;
	position?: { x: number; y: number };
};

export type WorkflowEdge = { id: string; source: string; target: string };

export type WorkflowRunContext = {
	conversationId: string;
	widgetId: string;
	ownerId: string;
	contact: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null };
	extractedRoofSize?: number;
};

export type WorkflowRunResult = {
	webhookResult: string;
	quoteEmailSent: boolean | null;
	triggerId: string;
	triggerName: string;
};

function getActionNodesInOrder(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
	const trigger = nodes.find((n) => n.type === 'trigger');
	if (!trigger) return [];
	const outEdges = new Map<string, string[]>();
	for (const e of edges) {
		if (!outEdges.has(e.source)) outEdges.set(e.source, []);
		outEdges.get(e.source)!.push(e.target);
	}
	const nodeById = new Map(nodes.map((n) => [n.id, n]));
	const order: WorkflowNode[] = [];
	const visited = new Set<string>();
	const queue: string[] = (outEdges.get(trigger.id) ?? []).slice();
	while (queue.length > 0) {
		const id = queue.shift()!;
		if (visited.has(id)) continue;
		visited.add(id);
		const node = nodeById.get(id);
		if (node && (node.type === 'action' || node.type === 'condition')) {
			order.push(node);
			for (const nextId of outEdges.get(id) ?? []) {
				if (!visited.has(nextId)) queue.push(nextId);
			}
		}
	}
	return order;
}

/** Substitute {{contact.name}}, {{contact.email}}, etc. in a prompt string. */
function substitutePrompt(
	template: string,
	contact: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null },
	extras: Record<string, string> = {}
): string {
	let out = template;
	const map: Record<string, string> = {
		'contact.name': (contact?.name ?? '').trim(),
		'contact.email': (contact?.email ?? '').trim(),
		'contact.phone': (contact?.phone ?? '').trim(),
		'contact.address': (contact?.address ?? '').trim(),
		...extras
	};
	for (const [key, value] of Object.entries(map)) {
		out = out.replace(new RegExp(`\\{\\{\\s*${key.replace(/\./g, '\\.')}\\s*\\}\\}`, 'gi'), value);
	}
	return out;
}

/**
 * Find a workflow for this widget that has trigger "Message in the chat" and messageIntent "Customer requests quote".
 */
export async function getQuoteWorkflowForWidget(
	admin: SupabaseClient,
	widgetId: string
): Promise<{ id: string; name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] } | null> {
	const { data: rows, error } = await admin
		.from('workflows')
		.select('id, name, nodes, edges')
		.eq('widget_id', widgetId)
		.eq('status', 'live')
		.limit(50);
	if (error || !rows?.length) return null;
	for (const row of rows) {
		const nodes = (row.nodes as WorkflowNode[]) ?? [];
		const trigger = nodes.find((n) => n.type === 'trigger');
		if (!trigger) continue;
		const data = trigger.data ?? {};
		const triggerType = (data.triggerType as string) ?? '';
		const messageIntent = (data.messageIntent as string) ?? '';
		if (
			triggerType === 'Message in the chat' &&
			(messageIntent === 'Customer requests quote' || messageIntent === 'When customer requests quote')
		) {
			return {
				id: row.id,
				name: row.name ?? 'Workflow',
				nodes,
				edges: (row.edges as WorkflowEdge[]) ?? []
			};
		}
	}
	return null;
}

/**
 * Run the quote workflow: execute actions in order (Generate quote, then Send email).
 * Returns webhookResult and quoteEmailSent for the chat to inject into the LLM prompt.
 */
export async function runQuoteWorkflow(
	admin: SupabaseClient,
	workflow: { nodes: WorkflowNode[]; edges: WorkflowEdge[] },
	ctx: WorkflowRunContext
): Promise<WorkflowRunResult> {
	const trigger = workflow.nodes.find((n) => n.type === 'trigger');
	const actions = getActionNodesInOrder(workflow.nodes, workflow.edges);
	let signedUrl: string | undefined;
	let quoteEmailSent: boolean | null = null;
	const contact = ctx.contact;

	for (const node of actions) {
		const actionType = (node.data?.actionType as string) ?? '';
		if (actionType === 'Generate quote') {
			const extracted =
				ctx.extractedRoofSize != null ? { roofSize: Number(ctx.extractedRoofSize) } : null;
			const gen = await generateQuoteForConversation(
				admin,
				ctx.conversationId,
				ctx.widgetId,
				contact,
				extracted,
				ctx.ownerId
			);
			if (gen.signedUrl && gen.storagePath) {
				signedUrl = gen.signedUrl;
				const { error: appendErr } = await admin.rpc('append_pdf_quote_to_contact', {
					p_conversation_id: ctx.conversationId,
					p_widget_id: ctx.widgetId,
					p_pdf_url: gen.storagePath
				});
				if (appendErr) console.error('[run-workflow] append_pdf_quote_to_contact:', appendErr);
			}
		} else if (actionType === 'Send email' && signedUrl) {
			const toEmail = (contact?.email ?? '').trim().toLowerCase();
			if (toEmail) {
				const emailResult = await sendQuoteEmail(admin, ctx.ownerId, {
					toEmail,
					quoteDownloadUrl: signedUrl,
					customerName: contact?.name ?? null
				});
				quoteEmailSent = emailResult.sent;
			}
		}
	}

	const emailInstruction =
		quoteEmailSent === true
			? ' In the same message, say they will also receive the quote by email, but give them the link above as a hyperlink in your response.'
			: ' Give them the link above as a hyperlink in your response. Do not say they will receive it by email.';
	const webhookResult =
		signedUrl != null
			? `A quote PDF has been generated. You MUST include this exact clickable link in your reply on a single line (no line break between the text and the URL): [Download Quote](${signedUrl}).${emailInstruction}`
			: '';

	// Use 'quote' / 'Quote' so chat prompt treats this as quote result (instruction with download link, etc.)
	return { webhookResult, quoteEmailSent, triggerId: 'quote', triggerName: 'Quote' };
}
