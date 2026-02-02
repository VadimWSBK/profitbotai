<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NodeProps } from '@xyflow/svelte';
	import { FileText, Mail, Webhook, Sparkles, Send } from '@lucide/svelte';

	let { data }: NodeProps = $props();
	const label = $derived(data?.label ?? 'Action');
	const actionType = $derived(data?.actionType ?? '');
	const enabled = $derived(data?.enabled !== false);
	const subLabel = $derived(enabled ? (actionType || 'Choose action') : 'Disabled');
	const ActionIcon = $derived(
		actionType === 'Outbound webhook' ? Webhook
			: actionType === 'Send email' ? Mail
			: actionType === 'Send message (chat)' ? Send
			: actionType === 'AI' ? Sparkles
			: FileText
	);
</script>

<div class="rounded-lg border-2 {enabled ? 'border-amber-500 bg-amber-50' : 'border-gray-300 bg-gray-100'} px-4 py-3 min-w-[180px] shadow-sm {enabled ? '' : 'opacity-80'}">
	<Handle type="target" position={Position.Left} class="!w-3 !h-3 !bg-amber-500 !border-2 !border-white" />
	<Handle type="source" position={Position.Right} class="!w-3 !h-3 !bg-amber-500 !border-2 !border-white" />
	<div class="flex items-center gap-2">
		<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full {enabled ? 'bg-amber-500 text-white' : 'bg-gray-400 text-white'}" aria-hidden="true">
			<ActionIcon class="w-4 h-4" />
		</span>
		<div>
			<p class="font-semibold {enabled ? 'text-amber-900' : 'text-gray-600'} text-sm">{label}</p>
			<p class="text-xs {enabled ? 'text-amber-700' : 'text-gray-500'}">{subLabel}</p>
		</div>
	</div>
</div>
