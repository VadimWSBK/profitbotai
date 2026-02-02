import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Inbound webhook for workflow triggers.
 * POST /api/workflows/trigger/[workflowId]/[nodeId]
 *
 * Call this URL to start a workflow from an external system (e.g. Zapier, Make, or your own app).
 * Optional: send X-Webhook-Secret header or { "secret": "..." } in JSON body to validate
 * (validation requires workflows to be stored server-side; currently workflows are client-only).
 */
export const POST: RequestHandler = async ({ params }) => {
	const { workflowId, nodeId } = params;
	if (!workflowId || !nodeId) {
		return json({ error: 'Missing workflowId or nodeId' }, { status: 400 });
	}

	// When workflows are persisted server-side, validate secret here and enqueue workflow run
	// const secret = request.headers.get('X-Webhook-Secret') ?? (await request.json()).secret;
	// if (configuredSecret && secret !== configuredSecret) return json({ error: 'Invalid secret' }, { status: 401 });

	return json({
		received: true,
		workflowId,
		nodeId,
		message: 'Webhook received. Workflow execution will be supported when workflows are persisted.'
	});
};
