import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/workflows/[id]/executions/[executionId] – get one execution with its steps (user must own workflow).
 */
export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const workflowId = event.params.id;
	const executionId = event.params.executionId;
	if (!workflowId || !executionId) return json({ error: 'Missing id or execution id' }, { status: 400 });

	const supabase = getSupabaseClient(event);

	const { data: execution, error: execErr } = await supabase
		.from('workflow_executions')
		.select('id, workflow_id, trigger_type, trigger_payload, status, error_message, started_at, finished_at')
		.eq('id', executionId)
		.eq('workflow_id', workflowId)
		.single();

	if (execErr || !execution) return json({ error: 'Execution not found' }, { status: 404 });

	const { data: steps, error: stepsErr } = await supabase
		.from('workflow_execution_steps')
		.select('id, node_id, node_label, action_type, status, error_message, output, started_at, finished_at')
		.eq('execution_id', executionId)
		.order('started_at', { ascending: true });

	if (stepsErr) return json({ error: stepsErr.message }, { status: 500 });

	return json({
		execution: {
			...execution,
			steps: steps ?? []
		}
	});
};
