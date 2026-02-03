/**
 * Run a workflow server-side (e.g. when "Message in the chat" / "Customer requests quote" or "Form submit" trigger fires).
 * Executes actions in order: Generate quote → Send email, etc.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { chatWithLlm } from '$lib/chat-llm.server';
import { generateQuoteForConversation, generateQuoteForForm } from '$lib/quote-pdf.server';
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
	contact: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null; roof_size_sqm?: number | null };
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

/** Derive first/last name from full name (first word = first name, rest = last name). */
function splitName(fullName: string): { first_name: string; last_name: string } {
	const trimmed = (fullName ?? '').trim();
	const parts = trimmed.split(/\s+/).filter(Boolean);
	const first_name = parts[0] ?? '';
	const last_name = parts.slice(1).join(' ') ?? '';
	return { first_name, last_name };
}

/** Substitute {{contact.name}}, {{contact.first_name}}, {{contact.last_name}}, {{contact.email}}, etc. in a prompt string. */
function substitutePrompt(
	template: string,
	contact: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null },
	extras: Record<string, string> = {}
): string {
	let out = template;
	const fullName = (contact?.name ?? '').trim();
	const { first_name, last_name } = splitName(contact?.name ?? '');
	const map: Record<string, string> = {
		'contact.name': fullName,
		'contact.first_name': first_name,
		'contact.last_name': last_name,
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

/** Replace [[link text]] with markdown [link text](url) when url is provided. */
function replaceBracketLinks(text: string, url: string): string {
	return text.replace(/\[\[([^\]]*)\]\]/g, (_, linkText: string) =>
		url ? `[${linkText.trim() || 'Link'}](${url})` : (linkText?.trim() || '')
	);
}

/**
 * Add a tag to a contact's tags array (append if not already present).
 */
async function addTagToContact(
	admin: SupabaseClient,
	contactId: string,
	tagName: string
): Promise<{ ok: boolean; error?: string }> {
	const trimmed = (tagName ?? '').trim();
	if (!trimmed) return { ok: false, error: 'Tag name is empty' };
	const { data: row, error: fetchErr } = await admin
		.from('contacts')
		.select('tags')
		.eq('id', contactId)
		.single();
	if (fetchErr || !row) return { ok: false, error: fetchErr?.message ?? 'Contact not found' };
	const raw = (row as { tags: unknown }).tags;
	const tags: string[] = Array.isArray(raw) ? (raw as unknown[]).filter((t): t is string => typeof t === 'string') : [];
	if (tags.includes(trimmed)) return { ok: true };
	const { error: updateErr } = await admin
		.from('contacts')
		.update({ tags: [...tags, trimmed] })
		.eq('id', contactId);
	if (updateErr) return { ok: false, error: updateErr.message };
	return { ok: true };
}

/**
 * Insert an assistant message into a conversation (for "Send message (chat)" action).
 */
async function insertAssistantMessage(
	admin: SupabaseClient,
	conversationId: string,
	content: string
): Promise<{ ok: boolean; error?: string }> {
	const { error } = await admin.from('widget_conversation_messages').insert({
		conversation_id: conversationId,
		role: 'assistant',
		content
	});
	if (error) return { ok: false, error: error.message };
	return { ok: true };
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
 * Start a workflow execution log row. Returns execution id.
 */
type WorkflowTriggerType = 'form_submit' | 'message_in_chat' | 'email_received' | 'tag_added';

async function startWorkflowExecution(
	admin: SupabaseClient,
	workflowId: string,
	triggerType: WorkflowTriggerType,
	triggerPayload: Record<string, unknown>
): Promise<string> {
	const { data, error } = await admin
		.from('workflow_executions')
		.insert({
			workflow_id: workflowId,
			trigger_type: triggerType,
			trigger_payload: triggerPayload,
			status: 'running'
		})
		.select('id')
		.single();
	if (error) {
		console.error('[run-workflow] startWorkflowExecution:', error);
		return '';
	}
	return (data?.id as string) ?? '';
}

/**
 * Finish a workflow execution (success or error).
 */
async function finishWorkflowExecution(
	admin: SupabaseClient,
	executionId: string,
	status: 'success' | 'error',
	errorMessage?: string | null
): Promise<void> {
	if (!executionId) return;
	await admin
		.from('workflow_executions')
		.update({ status, error_message: errorMessage ?? null, finished_at: new Date().toISOString() })
		.eq('id', executionId);
}

/**
 * Log one workflow step (node) execution.
 */
async function logWorkflowStep(
	admin: SupabaseClient,
	executionId: string,
	opts: {
		nodeId: string;
		nodeLabel?: string;
		actionType?: string;
		status: 'success' | 'error' | 'skipped';
		errorMessage?: string | null;
		output?: Record<string, unknown> | null;
	}
): Promise<void> {
	if (!executionId) return;
	await admin.from('workflow_execution_steps').insert({
		execution_id: executionId,
		node_id: opts.nodeId,
		node_label: opts.nodeLabel ?? null,
		action_type: opts.actionType ?? null,
		status: opts.status,
		error_message: opts.errorMessage ?? null,
		output: opts.output ?? null,
		finished_at: new Date().toISOString()
	});
}

/**
 * Run the quote workflow: execute actions in order (Generate quote, then Send email).
 * Returns webhookResult and quoteEmailSent for the chat to inject into the LLM prompt.
 */
export async function runQuoteWorkflow(
	admin: SupabaseClient,
	workflow: { id: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] },
	ctx: WorkflowRunContext
): Promise<WorkflowRunResult> {
	const actions = getActionNodesInOrder(workflow.nodes, workflow.edges);
	let signedUrl: string | undefined;
	let quoteEmailSent: boolean | null = null;
	const contact = ctx.contact;
	let contactId: string | null = null;
	const { data: contactRow } = await admin
		.from('contacts')
		.select('id')
		.eq('conversation_id', ctx.conversationId)
		.eq('widget_id', ctx.widgetId)
		.maybeSingle();
	if (contactRow) contactId = (contactRow as { id: string }).id;

	const executionId = await startWorkflowExecution(admin, workflow.id, 'message_in_chat', {
		conversation_id: ctx.conversationId,
		widget_id: ctx.widgetId,
		contact_email: contact?.email ?? null
	});

	let runError: string | null = null;
	try {
		for (const node of actions) {
			const actionType = (node.data?.actionType as string) ?? '';
			const nodeLabel = (node.data?.label as string) ?? node.id;
			try {
				if (actionType === 'Generate quote') {
					const roofFromCtx = ctx.extractedRoofSize ?? (ctx.contact?.roof_size_sqm != null ? Number(ctx.contact.roof_size_sqm) : undefined);
					const extracted = roofFromCtx != null ? { roofSize: roofFromCtx } : null;
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
							p_pdf_url: gen.storagePath,
							p_total: gen.total ?? null,
						});
						if (appendErr) console.error('[run-workflow] append_pdf_quote_to_contact:', appendErr);
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Generate quote',
							status: 'success',
							output: { signedUrl: true }
						});
					} else {
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Generate quote',
							status: 'error',
							errorMessage: gen.error ?? 'No PDF URL returned'
						});
					}
				} else if (actionType === 'Send email' && signedUrl) {
					// Only send when workflow has subject/body configured (no default "quote is ready" email)
					const data = node.data ?? {};
					const emailToRaw = (data.emailTo as string) ?? '{{contact.email}}';
					const toEmail = substitutePrompt(emailToRaw, contact, {}).trim().toLowerCase() || (contact?.email ?? '').trim().toLowerCase();
					const subjectRaw = (data.emailSubject as string) ?? '';
					const bodyRaw = (data.emailBody as string) ?? '';
					const subject = subjectRaw.trim() ? substitutePrompt(subjectRaw, contact, { 'quote.downloadUrl': signedUrl }) : undefined;
					const body = bodyRaw.trim() ? substitutePrompt(bodyRaw, contact, { 'quote.downloadUrl': signedUrl }) : undefined;
					if (toEmail && body) {
						const { data: contactRow } = await admin.from('contacts').select('id').eq('conversation_id', ctx.conversationId).maybeSingle();
						const emailResult = await sendQuoteEmail(admin, ctx.ownerId, {
							toEmail,
							quoteDownloadUrl: signedUrl,
							customerName: contact?.name ?? null,
							customSubject: subject,
							customBody: body,
							contactId: contactRow?.id ?? null,
							conversationId: ctx.conversationId
						});
						quoteEmailSent = emailResult.sent;
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Send email',
							status: emailResult.sent ? 'success' : 'error',
							errorMessage: emailResult.sent ? null : emailResult.error ?? undefined,
							output: { emailSent: emailResult.sent }
						});
					} else {
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Send email',
							status: 'skipped',
							errorMessage: !toEmail ? 'No recipient' : !body ? 'No email body configured' : null
						});
					}
				} else if (actionType === 'Send message (chat)') {
					const chatMessageRaw = (node.data?.chatMessage as string) ?? '';
					const messageTrimmed = chatMessageRaw.trim();
					if (messageTrimmed) {
						const substituted = substitutePrompt(messageTrimmed, contact, {
							'quote.downloadUrl': signedUrl ?? ''
						});
						const content = replaceBracketLinks(substituted, signedUrl ?? '');
						const result = await insertAssistantMessage(admin, ctx.conversationId, content);
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Send message (chat)',
							status: result.ok ? 'success' : 'error',
							errorMessage: result.ok ? null : result.error ?? undefined,
							output: result.ok ? { sent: true } : undefined
						});
					} else {
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Send message (chat)',
							status: 'skipped',
							errorMessage: 'No message configured'
						});
					}
				} else if (actionType === 'Add tag' && contactId) {
					const addTagName = ((node.data?.addTagName as string) ?? '').trim();
					if (addTagName) {
						const result = await addTagToContact(admin, contactId, addTagName);
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Add tag',
							status: result.ok ? 'success' : 'error',
							errorMessage: result.ok ? null : result.error ?? undefined,
							output: result.ok ? { tag: addTagName } : undefined
						});
					} else {
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Add tag',
							status: 'skipped',
							errorMessage: 'No tag name configured'
						});
					}
				} else {
					await logWorkflowStep(admin, executionId, {
						nodeId: node.id,
						nodeLabel,
						actionType: actionType || undefined,
						status: 'skipped',
						errorMessage: actionType === 'Send email' && !signedUrl ? 'Generate quote did not produce a URL' : null
					});
				}
			} catch (nodeErr) {
				const errMsg = nodeErr instanceof Error ? nodeErr.message : String(nodeErr);
				runError = errMsg;
				await logWorkflowStep(admin, executionId, {
					nodeId: node.id,
					nodeLabel,
					actionType: actionType || undefined,
					status: 'error',
					errorMessage: errMsg
				});
				break;
			}
		}
	} finally {
		await finishWorkflowExecution(
			admin,
			executionId,
			runError ? 'error' : 'success',
			runError
		);
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

export type FormRunContext = {
	formId: string;
	ownerId: string;
	contact: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null };
	contactId?: string | null;
	roofSize?: number;
};

export type FormRunResult = { pdfUrl?: string };

/**
 * Find a live workflow whose trigger is "Form submit" and formId matches.
 */
export async function getFormWorkflow(
	admin: SupabaseClient,
	formId: string
): Promise<{ id: string; name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[]; widgetId: string } | null> {
	const { data: formRow } = await admin.from('quote_forms').select('user_id').eq('id', formId).single();
	if (!formRow?.user_id) return null;
	const ownerId = formRow.user_id as string;
	const { data: widgets } = await admin.from('widgets').select('id').eq('created_by', ownerId);
	if (!widgets?.length) return null;
	const widgetIds = widgets.map((w) => w.id);
	const { data: rows } = await admin.from('workflows').select('id, name, widget_id, nodes, edges').eq('status', 'live').in('widget_id', widgetIds);
	if (!rows?.length) return null;
	for (const row of rows) {
		const nodes = (row.nodes as WorkflowNode[]) ?? [];
		const trigger = nodes.find((n) => n.type === 'trigger');
		if (!trigger) continue;
		const data = trigger.data ?? {};
		const triggerType = (data.triggerType as string) ?? '';
		const triggerFormId = (data.formId as string) ?? '';
		if (triggerType === 'Form submit' && triggerFormId === formId) {
			return {
				id: row.id,
				name: row.name ?? 'Workflow',
				nodes,
				edges: (row.edges as WorkflowEdge[]) ?? [],
				widgetId: row.widget_id as string
			};
		}
	}
	return null;
}

export type EmailReceivedContext = {
	widgetId: string;
	ownerId: string;
	contactId: string;
	conversationId: string | null;
	contact: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null };
	inboundSubject?: string;
	inboundBody?: string;
};

/**
 * Find live workflows whose trigger is "Email received" and widgetId matches.
 */
export async function getEmailReceivedWorkflows(
	admin: SupabaseClient,
	widgetId: string
): Promise<{ id: string; name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[]; widgetId: string }[]> {
	const { data: rows } = await admin
		.from('workflows')
		.select('id, name, widget_id, nodes, edges')
		.eq('widget_id', widgetId)
		.eq('status', 'live');
	if (!rows?.length) return [];
	const out: { id: string; name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[]; widgetId: string }[] = [];
	for (const row of rows) {
		const nodes = (row.nodes as WorkflowNode[]) ?? [];
		const trigger = nodes.find((n) => n.type === 'trigger');
		if (!trigger) continue;
		const data = trigger.data ?? {};
		const triggerType = (data.triggerType as string) ?? '';
		const triggerWidgetId = (data.widgetId as string) ?? '';
		if (triggerType === 'Email received' && triggerWidgetId === widgetId) {
			out.push({
				id: row.id,
				name: (row.name as string) ?? 'Workflow',
				nodes,
				edges: (row.edges as WorkflowEdge[]) ?? [],
				widgetId: row.widget_id as string
			});
		}
	}
	return out;
}

export type TagAddedContext = {
	widgetId: string;
	ownerId: string;
	contactId: string;
	conversationId: string | null;
	contact: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null };
	tagAdded: string;
};

/**
 * Find live workflows whose trigger is "Tag added" and widgetId matches; optionally filter by tag.
 */
export async function getTagAddedWorkflows(
	admin: SupabaseClient,
	widgetId: string,
	tagAdded?: string
): Promise<{ id: string; name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[]; widgetId: string }[]> {
	const { data: rows } = await admin
		.from('workflows')
		.select('id, name, widget_id, nodes, edges')
		.eq('widget_id', widgetId)
		.eq('status', 'live');
	if (!rows?.length) return [];
	const out: { id: string; name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[]; widgetId: string }[] = [];
	for (const row of rows) {
		const nodes = (row.nodes as WorkflowNode[]) ?? [];
		const trigger = nodes.find((n) => n.type === 'trigger');
		if (!trigger) continue;
		const data = trigger.data ?? {};
		const triggerType = (data.triggerType as string) ?? '';
		const triggerWidgetId = (data.widgetId as string) ?? '';
		const tagFilter = (data.tagAddedFilter as string) ?? '';
		if (triggerType !== 'Tag added' || triggerWidgetId !== widgetId) continue;
		if (tagFilter && tagAdded !== undefined && tagFilter !== tagAdded) continue;
		out.push({
			id: row.id,
			name: (row.name as string) ?? 'Workflow',
			nodes,
			edges: (row.edges as WorkflowEdge[]) ?? [],
			widgetId: row.widget_id as string
		});
	}
	return out;
}

/**
 * Run a tag-added-triggered workflow: execute actions (Add tag, Send email, etc.).
 */
export async function runTagAddedWorkflow(
	admin: SupabaseClient,
	workflow: { id: string; widgetId: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] },
	ctx: TagAddedContext
): Promise<{ success: boolean; error?: string }> {
	const actions = getActionNodesInOrder(workflow.nodes, workflow.edges);
	const contact = ctx.contact;

	const executionId = await startWorkflowExecution(admin, workflow.id, 'tag_added', {
		contact_id: ctx.contactId,
		conversation_id: ctx.conversationId,
		widget_id: ctx.widgetId,
		tag_added: ctx.tagAdded
	});

	let runError: string | null = null;
	try {
		for (const node of actions) {
			const actionType = (node.data?.actionType as string) ?? '';
			const nodeLabel = (node.data?.label as string) ?? node.id;
			try {
				if (actionType === 'Add tag') {
					const addTagName = ((node.data?.addTagName as string) ?? '').trim();
					if (addTagName) {
						const result = await addTagToContact(admin, ctx.contactId, addTagName);
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Add tag',
							status: result.ok ? 'success' : 'error',
							errorMessage: result.ok ? null : result.error ?? undefined,
							output: result.ok ? { tag: addTagName } : undefined
						});
					} else {
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Add tag',
							status: 'skipped',
							errorMessage: 'No tag name configured'
						});
					}
				} else if (actionType === 'Send email') {
					const data = node.data ?? {};
					const emailToRaw = (data.emailTo as string) ?? '{{contact.email}}';
					const toEmail = substitutePrompt(emailToRaw, contact, {}).trim().toLowerCase() || (contact?.email ?? '').trim().toLowerCase();
					const subjectRaw = (data.emailSubject as string) ?? '';
					const bodyRaw = (data.emailBody as string) ?? '';
					const subject = subjectRaw.trim() ? substitutePrompt(subjectRaw, contact, {}) : undefined;
					const body = bodyRaw.trim() ? substitutePrompt(bodyRaw, contact, {}) : undefined;
					if (toEmail && body) {
						const emailResult = await sendQuoteEmail(admin, ctx.ownerId, {
							toEmail,
							quoteDownloadUrl: '',
							customerName: contact?.name ?? null,
							customSubject: subject ?? '',
							customBody: body,
							contactId: ctx.contactId,
							conversationId: ctx.conversationId ?? undefined
						});
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Send email',
							status: emailResult.sent ? 'success' : 'error',
							errorMessage: emailResult.sent ? null : emailResult.error ?? undefined,
							output: { emailSent: emailResult.sent }
						});
					} else {
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Send email',
							status: 'skipped',
							errorMessage: !toEmail ? 'No recipient' : 'No email body configured'
						});
					}
				} else if (actionType === 'Send message (chat)' && ctx.conversationId) {
					const chatMessageRaw = (node.data?.chatMessage as string) ?? '';
					const messageTrimmed = chatMessageRaw.trim();
					if (messageTrimmed) {
						const substituted = substitutePrompt(messageTrimmed, contact, {});
						const content = replaceBracketLinks(substituted, '');
						const { error: msgErr } = await admin.from('widget_conversation_messages').insert({
							conversation_id: ctx.conversationId,
							role: 'assistant',
							content
						});
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Send message (chat)',
							status: msgErr ? 'error' : 'success',
							errorMessage: msgErr?.message ?? null,
							output: msgErr ? undefined : { sent: true }
						});
					} else {
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Send message (chat)',
							status: 'skipped',
							errorMessage: !messageTrimmed ? 'No message configured' : 'No conversation linked to contact'
						});
					}
				} else if (actionType !== 'Generate quote') {
					// Log other action types as skipped for tag-added context (e.g. Generate quote, Outbound webhook, AI)
					await logWorkflowStep(admin, executionId, {
						nodeId: node.id,
						nodeLabel,
						actionType: actionType || undefined,
						status: 'skipped',
						errorMessage: null
					});
				}
			} catch (stepErr) {
				runError = stepErr instanceof Error ? stepErr.message : String(stepErr);
				await logWorkflowStep(admin, executionId, {
					nodeId: node.id,
					nodeLabel,
					actionType,
					status: 'error',
					errorMessage: runError
				});
			}
		}
	} catch (e) {
		runError = e instanceof Error ? e.message : String(e);
	}
	await finishWorkflowExecution(admin, executionId, runError ? 'error' : 'success', runError ?? null);
	return runError ? { success: false, error: runError } : { success: true };
}

/**
 * Run an email-received-triggered workflow: execute actions (Send email, Send message chat, AI, etc.).
 */
export async function runEmailReceivedWorkflow(
	admin: SupabaseClient,
	workflow: { id: string; widgetId: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] },
	ctx: EmailReceivedContext
): Promise<{ success: boolean; error?: string }> {
	const actions = getActionNodesInOrder(workflow.nodes, workflow.edges);
	const contact = ctx.contact;
	let signedUrl: string | undefined;
	let lastAiResponse: string | undefined;

	const executionId = await startWorkflowExecution(admin, workflow.id, 'email_received', {
		contact_id: ctx.contactId,
		conversation_id: ctx.conversationId,
		widget_id: ctx.widgetId,
		inbound_subject: ctx.inboundSubject ?? null,
		inbound_body: ctx.inboundBody ?? null
	});

	let runError: string | null = null;
	try {
		for (const node of actions) {
			const actionType = (node.data?.actionType as string) ?? '';
			const nodeLabel = (node.data?.label as string) ?? node.id;
			try {
				if (actionType === 'Generate quote' && ctx.conversationId) {
					const gen = await generateQuoteForConversation(
						admin,
						ctx.conversationId,
						ctx.widgetId,
						contact,
						null,
						ctx.ownerId
					);
					if (gen.signedUrl) signedUrl = gen.signedUrl;
					await logWorkflowStep(admin, executionId, {
						nodeId: node.id,
						nodeLabel,
						actionType: 'Generate quote',
						status: gen.signedUrl ? 'success' : 'error',
						errorMessage: gen.signedUrl ? null : gen.error ?? undefined,
						output: gen.signedUrl ? { signedUrl: true } : undefined
					});
				} else if (actionType === 'Send email') {
					const data = node.data ?? {};
					const emailExtras: Record<string, string> = { 'quote.downloadUrl': signedUrl ?? '', 'ai.response': lastAiResponse ?? '' };
					const emailToRaw = (data.emailTo as string) ?? '{{contact.email}}';
					const toEmail = substitutePrompt(emailToRaw, contact, {}).trim().toLowerCase() || (contact?.email ?? '').trim().toLowerCase();
					const subjectRaw = (data.emailSubject as string) ?? '';
					const bodyRaw = (data.emailBody as string) ?? '';
					const subject = subjectRaw.trim() ? substitutePrompt(subjectRaw, contact, emailExtras) : undefined;
					const body = bodyRaw.trim() ? substitutePrompt(bodyRaw, contact, emailExtras) : undefined;
					if (toEmail && body) {
						const emailResult = await sendQuoteEmail(admin, ctx.ownerId, {
							toEmail,
							quoteDownloadUrl: signedUrl ?? '',
							customerName: contact?.name ?? null,
							customSubject: subject ?? '',
							customBody: body,
							contactId: ctx.contactId,
							conversationId: ctx.conversationId ?? undefined
						});
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Send email',
							status: emailResult.sent ? 'success' : 'error',
							errorMessage: emailResult.sent ? null : emailResult.error ?? undefined,
							output: { emailSent: emailResult.sent }
						});
					} else {
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Send email',
							status: 'skipped',
							errorMessage: !toEmail ? 'No recipient' : 'No email body configured'
						});
					}
				} else if (actionType === 'Send message (chat)' && ctx.conversationId) {
					const chatMessageRaw = (node.data?.chatMessage as string) ?? '';
					const messageTrimmed = chatMessageRaw.trim();
					if (messageTrimmed) {
						const chatExtras: Record<string, string> = { 'quote.downloadUrl': signedUrl ?? '', 'ai.response': lastAiResponse ?? '' };
						const substituted = substitutePrompt(messageTrimmed, contact, chatExtras);
						const content = replaceBracketLinks(substituted, signedUrl ?? '');
						const { error: msgErr } = await admin.from('widget_conversation_messages').insert({
							conversation_id: ctx.conversationId,
							role: 'assistant',
							content
						});
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Send message (chat)',
							status: msgErr ? 'error' : 'success',
							errorMessage: msgErr?.message ?? null,
							output: msgErr ? undefined : { sent: true }
						});
					} else {
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Send message (chat)',
							status: 'skipped',
							errorMessage: 'No message configured'
						});
					}
				} else if (actionType === 'AI') {
					// AI action: substitute placeholders, call LLM, store response for next steps ({{ai.response}})
					const data = node.data ?? {};
					const promptRaw = (data.aiPrompt as string) ?? '';
					const extras: Record<string, string> = {
						'inbound.subject': ctx.inboundSubject ?? '',
						'inbound.body': (ctx.inboundBody ?? '').slice(0, 500)
					};
					const prompt = substitutePrompt(promptRaw, contact, extras);
					const provider = (data.aiProvider as string)?.trim() || 'openai';
					const model = (data.aiModel as string)?.trim() || (provider === 'google' ? 'gemini-2.5-flash' : provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o-mini');
					const useIntegrated = (data.aiConnection as string) !== 'custom';
					let apiKey: string | null = null;
					if (useIntegrated) {
						const { data: key } = await admin.rpc('get_owner_llm_key_for_chat', {
							p_widget_id: ctx.widgetId,
							p_provider: provider
						});
						apiKey = key as string | null;
					} else {
						apiKey = (data.aiApiKey as string)?.trim() || null;
					}
					if (prompt.trim() && apiKey) {
						try {
							const response = await chatWithLlm(provider, model, apiKey, [{ role: 'user', content: prompt }]);
							lastAiResponse = (response ?? '').trim();
							await logWorkflowStep(admin, executionId, {
								nodeId: node.id,
								nodeLabel,
								actionType: 'AI',
								status: 'success',
								output: { responseLength: lastAiResponse.length }
							});
						} catch (aiErr) {
							const errMsg = aiErr instanceof Error ? aiErr.message : String(aiErr);
							runError = errMsg;
							await logWorkflowStep(admin, executionId, {
								nodeId: node.id,
								nodeLabel,
								actionType: 'AI',
								status: 'error',
								errorMessage: errMsg
							});
						}
					} else {
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'AI',
							status: 'skipped',
							errorMessage: !prompt.trim() ? 'No prompt configured' : 'No API key (add in Settings or use custom key)'
						});
					}
				} else if (actionType === 'Add tag') {
					const addTagName = ((node.data?.addTagName as string) ?? '').trim();
					if (addTagName) {
						const result = await addTagToContact(admin, ctx.contactId, addTagName);
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Add tag',
							status: result.ok ? 'success' : 'error',
							errorMessage: result.ok ? null : result.error ?? undefined,
							output: result.ok ? { tag: addTagName } : undefined
						});
					} else {
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Add tag',
							status: 'skipped',
							errorMessage: 'No tag name configured'
						});
					}
				} else if (actionType === 'Generate quote' && !ctx.conversationId) {
					await logWorkflowStep(admin, executionId, {
						nodeId: node.id,
						nodeLabel,
						actionType: 'Generate quote',
						status: 'skipped',
						errorMessage: 'No conversation linked to contact'
					});
				}
			} catch (stepErr) {
				runError = stepErr instanceof Error ? stepErr.message : String(stepErr);
				await logWorkflowStep(admin, executionId, {
					nodeId: node.id,
					nodeLabel,
					actionType,
					status: 'error',
					errorMessage: runError
				});
			}
		}
	} catch (e) {
		runError = e instanceof Error ? e.message : String(e);
	}
	await finishWorkflowExecution(admin, executionId, runError ? 'error' : 'success', runError ?? null);
	return runError ? { success: false, error: runError } : { success: true };
}

/**
 * Run a form-triggered workflow: execute actions in order.
 * Email is only sent when the workflow explicitly contains a "Send email" action (no hardcoded email).
 */
export async function runFormWorkflow(
	admin: SupabaseClient,
	workflow: { id: string; widgetId: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] },
	ctx: FormRunContext
): Promise<FormRunResult> {
	const actions = getActionNodesInOrder(workflow.nodes, workflow.edges);
	let signedUrl: string | undefined;
	const contact = ctx.contact;

	const executionId = await startWorkflowExecution(admin, workflow.id, 'form_submit', {
		form_id: ctx.formId,
		contact_email: contact?.email ?? null
	});

	let runError: string | null = null;
	try {
		for (const node of actions) {
			const actionType = (node.data?.actionType as string) ?? '';
			const nodeLabel = (node.data?.label as string) ?? node.id;
			try {
				if (actionType === 'Generate quote') {
					const gen = await generateQuoteForForm(
						admin,
						ctx.formId,
						ctx.ownerId,
						contact,
						ctx.roofSize
					);
					if (gen.signedUrl) signedUrl = gen.signedUrl;
					await logWorkflowStep(admin, executionId, {
						nodeId: node.id,
						nodeLabel,
						actionType: 'Generate quote',
						status: gen.signedUrl ? 'success' : 'error',
						errorMessage: gen.signedUrl ? null : gen.error ?? undefined,
						output: gen.signedUrl ? { signedUrl: true } : undefined
					});
				} else if (actionType === 'Send email') {
					// Only send when workflow has this action and has subject/body configured (no default "quote is ready" email)
					const data = node.data ?? {};
					const emailToRaw = (data.emailTo as string) ?? '{{contact.email}}';
					const toEmail = substitutePrompt(emailToRaw, contact, {}).trim().toLowerCase() || (contact?.email ?? '').trim().toLowerCase();
					const subjectRaw = (data.emailSubject as string) ?? '';
					const bodyRaw = (data.emailBody as string) ?? '';
					const subject = subjectRaw.trim() ? substitutePrompt(subjectRaw, contact, { 'quote.downloadUrl': signedUrl ?? '' }) : undefined;
					const body = bodyRaw.trim() ? substitutePrompt(bodyRaw, contact, { 'quote.downloadUrl': signedUrl ?? '' }) : undefined;
					if (toEmail && signedUrl && body) {
						const emailResult = await sendQuoteEmail(admin, ctx.ownerId, {
							toEmail,
							quoteDownloadUrl: signedUrl,
							customerName: contact?.name ?? null,
							customSubject: subject ?? '',
							customBody: body,
							contactId: ctx.contactId ?? null,
							conversationId: null
						});
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Send email',
							status: emailResult.sent ? 'success' : 'error',
							errorMessage: emailResult.sent ? null : emailResult.error ?? undefined,
							output: { emailSent: emailResult.sent }
						});
					} else {
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Send email',
							status: 'skipped',
							errorMessage: !toEmail ? 'No recipient' : !body ? 'No email body configured' : !signedUrl ? 'No quote URL' : null
						});
					}
				} else if (actionType === 'Send message (chat)') {
					const chatMessageRaw = (node.data?.chatMessage as string) ?? '';
					const messageTrimmed = chatMessageRaw.trim();
					if (!messageTrimmed) {
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Send message (chat)',
							status: 'skipped',
							errorMessage: 'No message configured'
						});
					} else {
						const toEmail = (contact?.email ?? '').trim().toLowerCase();
						const { data: contactRow } = toEmail
							? await admin
									.from('contacts')
									.select('conversation_id')
									.eq('widget_id', workflow.widgetId)
									.eq('email', toEmail)
									.not('conversation_id', 'is', null)
									.limit(1)
									.maybeSingle()
							: { data: null };
						const conversationId = contactRow?.conversation_id as string | undefined;
						if (conversationId) {
							const substituted = substitutePrompt(messageTrimmed, contact, {
								'quote.downloadUrl': signedUrl ?? ''
							});
							const content = replaceBracketLinks(substituted, signedUrl ?? '');
							const result = await insertAssistantMessage(admin, conversationId, content);
							await logWorkflowStep(admin, executionId, {
								nodeId: node.id,
								nodeLabel,
								actionType: 'Send message (chat)',
								status: result.ok ? 'success' : 'error',
								errorMessage: result.ok ? null : result.error ?? undefined,
								output: result.ok ? { sent: true } : undefined
							});
						} else {
							await logWorkflowStep(admin, executionId, {
								nodeId: node.id,
								nodeLabel,
								actionType: 'Send message (chat)',
								status: 'skipped',
								errorMessage: 'No chat conversation found for this contact'
							});
						}
					}
				} else if (actionType === 'Add tag' && ctx.contactId) {
					const addTagName = ((node.data?.addTagName as string) ?? '').trim();
					if (addTagName) {
						const result = await addTagToContact(admin, ctx.contactId, addTagName);
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Add tag',
							status: result.ok ? 'success' : 'error',
							errorMessage: result.ok ? null : result.error ?? undefined,
							output: result.ok ? { tag: addTagName } : undefined
						});
					} else {
						await logWorkflowStep(admin, executionId, {
							nodeId: node.id,
							nodeLabel,
							actionType: 'Add tag',
							status: 'skipped',
							errorMessage: 'No tag name configured'
						});
					}
				}
			} catch (nodeErr) {
				const errMsg = nodeErr instanceof Error ? nodeErr.message : String(nodeErr);
				runError = errMsg;
				await logWorkflowStep(admin, executionId, {
					nodeId: node.id,
					nodeLabel,
					actionType: actionType || undefined,
					status: 'error',
					errorMessage: errMsg
				});
				break;
			}
		}
	} finally {
		await finishWorkflowExecution(
			admin,
			executionId,
			runError ? 'error' : 'success',
			runError
		);
	}

	return { pdfUrl: signedUrl };
}
