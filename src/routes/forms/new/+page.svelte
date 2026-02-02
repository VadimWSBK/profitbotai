<script lang="ts">
	import { enhance } from '$app/forms';
	let submitting = $state(false);
</script>

<svelte:head>
	<title>New form – ProfitBot</title>
</svelte:head>

<div class="max-w-md mx-auto text-center py-12">
	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			return () => {
				submitting = false;
			};
		}}
	>
		<button
			type="submit"
			disabled={submitting}
			class="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
		>
			{submitting ? 'Creating…' : 'Create form'}
		</button>
	</form>
</div>
