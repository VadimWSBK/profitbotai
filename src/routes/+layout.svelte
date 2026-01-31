<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/stores';

	let { data, children } = $props();
	const isEmbed = $derived($page.url.pathname.startsWith('/embed'));
	const isAuthPage = $derived(
		$page.url.pathname === '/login' ||
			$page.url.pathname === '/auth/signup' ||
			$page.url.pathname.startsWith('/auth/')
	);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if isEmbed}
	<div class="min-h-screen bg-transparent">
		{@render children()}
	</div>
{:else if isAuthPage}
	<div class="min-h-screen bg-gray-100 flex items-center justify-center p-4">
		{@render children()}
	</div>
{:else}
<div class="flex min-h-screen bg-gray-50">
	<!-- Sidebar -->
	<aside class="w-16 flex flex-col items-center py-4 bg-gray-900 text-gray-400 shrink-0">
		<a href="/" class="p-3 rounded-lg hover:bg-gray-800 hover:text-white transition-colors opacity-60" title="Stream">
			<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
		</a>
		<a href="/" class="p-3 rounded-lg mt-1 transition-colors {($page.url.pathname === '/' ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Dashboard">
			<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>
		</a>
		{#if data.role === 'admin'}
			<a href="/analytics" class="p-3 rounded-lg hover:bg-gray-800 hover:text-white transition-colors mt-1" title="Analytics">
				<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16"/></svg>
			</a>
		{/if}
		<a href="/cards" class="p-3 rounded-lg hover:bg-gray-800 hover:text-white transition-colors mt-1" title="Cards">
			<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
		</a>
		<a href="/devices" class="p-3 rounded-lg hover:bg-gray-800 hover:text-white transition-colors mt-1" title="Devices">
			<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
		</a>
		<a href="/messages" class="relative p-3 rounded-lg mt-1 transition-colors {($page.url.pathname === '/messages' ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Messages">
			<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
			{#if data.unreadCount > 0}
				<span class="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-medium text-white ring-2 ring-gray-900">
					{data.unreadCount > 99 ? '99+' : data.unreadCount}
				</span>
			{/if}
		</a>
		<div class="flex-1"></div>
		<a href="/settings" class="p-3 rounded-lg hover:bg-gray-800 hover:text-white transition-colors" title="Settings">
			<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
		</a>
	</aside>

	<!-- Main content wrapper -->
	<div class="flex-1 flex flex-col min-w-0">
		<!-- Header -->
		<header class="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shrink-0">
			<h2 class="text-lg font-medium text-gray-800">
				{data.user ? `Hello, ${data.user.email?.split('@')[0] ?? 'User'} 👋` : 'Dashboard'}
			</h2>
			<div class="flex items-center gap-3">
				{#if data.user}
					<span class="text-sm text-gray-500 capitalize">{data.role ?? 'user'}</span>
					<a
						href="/auth/logout"
						class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
					>
						Sign out
					</a>
					<div
						class="w-9 h-9 rounded-full bg-amber-600 flex items-center justify-center text-white font-semibold text-sm"
						title={data.user.email ?? ''}
					>
						{(data.user.email ?? 'U').charAt(0).toUpperCase()}
					</div>
				{/if}
			</div>
		</header>

		<!-- Page content -->
		<main class="flex-1 overflow-auto p-6">
			{@render children()}
		</main>
	</div>
</div>
{/if}
