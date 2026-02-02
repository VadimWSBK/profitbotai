<script lang="ts">
	import { page } from '$app/stores';

	const status = $derived($page.status ?? 500);
	const message = $derived($page.error?.message ?? (status === 404 ? 'Form not found' : 'Something went wrong. Please try again later.'));
</script>

<div class="min-h-[400px] w-full max-w-lg mx-auto p-6 bg-white rounded-2xl shadow-lg flex flex-col items-center justify-center text-center">
	<p class="text-gray-500 text-sm mb-2">Error {status}</p>
	<p class="text-gray-900 font-medium">{message}</p>
</div>
