<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NodeProps } from '@xyflow/svelte';

	let { data }: NodeProps = $props();
	const label = $derived(data?.label ?? 'Condition');
	const conditionType = $derived(data?.conditionType ?? 'If/Else');
</script>

<div class="rounded-lg border-2 border-blue-500 bg-blue-50 px-4 py-3 min-w-[180px] shadow-sm">
	<Handle type="target" position={Position.Left} class="!w-3 !h-3 !bg-blue-500 !border-2 !border-white" />
	<Handle type="source" position={Position.Right} id="yes" class="!top-1/3 !w-3 !h-3 !bg-blue-500 !border-2 !border-white" />
	<Handle type="source" position={Position.Right} id="no" class="!top-2/3 !w-3 !h-3 !bg-blue-500 !border-2 !border-white" />
	<div class="flex items-center gap-2">
		<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white" aria-hidden="true">
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
		</span>
		<div>
			<p class="font-semibold text-blue-900 text-sm">{label}</p>
			<p class="text-xs text-blue-700">{conditionType}</p>
		</div>
	</div>
	<div class="mt-2 flex justify-between text-[10px] font-medium text-blue-600">
		<span>Yes</span>
		<span>No</span>
	</div>
</div>
