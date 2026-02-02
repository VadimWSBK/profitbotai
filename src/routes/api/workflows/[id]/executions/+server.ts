import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseClient } from '$lib/supabase.server';

/**
 * GET /api/workflows/[id]/executions – list executions for this workflow (user must own workflow).
 * Query: limit (default 50), offset (default 0).
 */
export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const workflowId = event.params.id;
	if (!workflowId) return json({ error: 'Missing workflow id' }, { status: 400 });

	const limit = Math.min(Number(event.url.searchParams.get('limit')) || 50, 100);
	const offset = Math.max(0, Number(event.url.searchParams.get('offset')) || 0);

	const supabase = getSupabaseClient(event);

	// Verify user can access this workflow (RLS on workflow_executions will also filter, but we need workflow to exist)
	const { data: workflow, error: wErr } = await supabase
		.from('workflows')
		.select('id')
		.eq('id', workflowId)
		.single();
	if (wErr || !workflow) return json({ error: 'Workflow not found' }, { status: 404 });

	const { data: executions, error } = await supabase
		.from('workflow_executions')
		.select('id, workflow_id, trigger_type, trigger_payload, status, error_message, started_at, finished_at')
		.eq('workflow_id', workflowId)
		.order('started_at', { ascending: false })
		.range(offset, offset + limit - 1);

	if (error) return json({ error: error.message }, { status: 500 });

	// Get step counts per execution
	const executionIds = (executions ?? []).map((e) => e.id);
	const { data: stepCounts } = await supabase
		.from('workflow_execution_steps')
		.select('execution_id')
		.in('execution_id', executionIds);
	const countByExecution = (stepCounts ?? []).reduce(
		(acc, row) => {
			acc[row.execution_id] = (acc[row.execution_id] ?? 0) + 1;
			return acc;
		},
		{} as Record<string, number>
	);

	const list = (executions ?? []).map((e) => ({
		...e,
		step_count: countByExecution[e.id] ?? 0
	}));

	return json({ executions: list });
};
