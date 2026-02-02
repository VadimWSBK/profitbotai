<script lang="ts">
	let { data } = $props();
</script>

<div class="max-w-5xl mx-auto">
	<h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
	<p class="text-gray-500 mt-0.5 mb-8">Overview of your activity and key metrics</p>

	<!-- Stats placeholder: graphs and stats will go here -->
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<div class="flex items-center gap-3">
				<div class="w-12 h-12 rounded-lg bg-amber-100 flex items-center justify-center">
					<svg class="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
				</div>
				<div>
					<p class="text-sm font-medium text-gray-500">Total messages sent</p>
					<p class="text-2xl font-bold text-gray-900">—</p>
				</div>
			</div>
			<p class="text-xs text-gray-400 mt-3">Coming soon</p>
		</div>
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<div class="flex items-center gap-3">
				<div class="w-12 h-12 rounded-lg bg-emerald-100 flex items-center justify-center">
					<svg class="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
				</div>
				<div>
					<p class="text-sm font-medium text-gray-500">Quotes sent</p>
					<p class="text-2xl font-bold text-gray-900">—</p>
				</div>
			</div>
			<p class="text-xs text-gray-400 mt-3">Coming soon</p>
		</div>
		<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
			<div class="flex items-center gap-3">
				<div class="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
					<svg class="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
				</div>
				<div>
					<p class="text-sm font-medium text-gray-500">Total quoted amount</p>
					<p class="text-2xl font-bold text-gray-900">—</p>
				</div>
			</div>
			<p class="text-xs text-gray-400 mt-3">Coming soon</p>
		</div>
	</div>

	<!-- Graphs placeholder -->
	<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
		<h2 class="text-lg font-semibold text-gray-800 mb-2">Charts & trends</h2>
		<p class="text-gray-500 text-sm">Graphs and detailed stats will appear here.</p>
		<div class="mt-6 h-48 rounded-lg bg-gray-50 border border-dashed border-gray-200 flex items-center justify-center">
			<span class="text-sm text-gray-400">Charts coming soon</span>
		</div>
	</div>
</div>
