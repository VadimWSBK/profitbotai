<script lang="ts">
	import { useSvelteFlow } from '@xyflow/svelte';

	type NodeType = 'trigger' | 'action' | 'condition';

	let {
		isDraggingFromSidebar = false,
		onDrop
	}: {
		isDraggingFromSidebar: boolean;
		onDrop: (type: NodeType, position: { x: number; y: number }) => void;
	} = $props();

	const { screenToFlowPosition } = useSvelteFlow();

	function handleDragOver(e: DragEvent) {
		if (!e.dataTransfer) return;
		if (e.dataTransfer.types.includes('application/x-profitbot-node-type')) {
			e.preventDefault();
			e.dataTransfer.dropEffect = 'move';
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		if (!e.dataTransfer) return;
		const type = e.dataTransfer.getData('application/x-profitbot-node-type') as NodeType | '';
		if (type !== 'trigger' && type !== 'action' && type !== 'condition') return;
		const position = screenToFlowPosition({ x: e.clientX, y: e.clientY }, { snapToGrid: true });
		onDrop(type, position);
	}
</script>

<div
	class="flow-drop-zone"
	class:active={isDraggingFromSidebar}
	ondragover={handleDragOver}
	ondrop={handleDrop}
	role="presentation"
	aria-hidden="true"
></div>

<style>
	.flow-drop-zone {
		position: absolute;
		inset: 0;
		z-index: 10;
		pointer-events: none;
	}
	.flow-drop-zone.active {
		pointer-events: auto;
	}
</style>
