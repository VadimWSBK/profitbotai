<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NodeProps } from '@xyflow/svelte';
	import { ClipboardList, Webhook, MessageCircle, Mail } from '@lucide/svelte';

	let { data }: NodeProps = $props();
	const label = $derived(data?.label ?? 'Trigger');
	const triggerType = $derived(data?.triggerType ?? '');
	const messageIntent = $derived(data?.messageIntent as string | undefined);
	const subLabel = $derived(
		triggerType === 'Message in the chat' && messageIntent
			? messageIntent
			: triggerType || 'Choose trigger'
	);
	const TriggerIcon = $derived(
		triggerType === 'Inbound webhook' ? Webhook
			: triggerType === 'Message in the chat' ? MessageCircle
			: triggerType === 'Email received' ? Mail
			: ClipboardList
	);
</script>

<div class="rounded-lg border-2 border-emerald-500 bg-emerald-50 px-4 py-3 min-w-[180px] shadow-sm">
	<Handle type="source" position={Position.Right} class="!w-3 !h-3 !bg-emerald-500 !border-2 !border-white" />
	<div class="flex items-center gap-2">
		<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white" aria-hidden="true">
			<TriggerIcon class="w-4 h-4" />
		</span>
		<div>
			<p class="font-semibold text-emerald-900 text-sm">{label}</p>
			<p class="text-xs text-emerald-700">{subLabel}</p>
		</div>
	</div>
</div>
