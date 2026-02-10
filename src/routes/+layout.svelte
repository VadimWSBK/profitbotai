<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';

	let { data, children } = $props();
	const isEmbed = $derived($page.url.pathname.startsWith('/embed'));
	const isAuthPage = $derived(
		$page.url.pathname === '/login' ||
			$page.url.pathname === '/auth/signup' ||
			$page.url.pathname.startsWith('/auth/')
	);

	let sidebarExpanded = $state(false);
	onMount(() => {
		sidebarExpanded = localStorage.getItem('sidebarExpanded') === 'true';
	});
	function toggleSidebar() {
		sidebarExpanded = !sidebarExpanded;
		localStorage.setItem('sidebarExpanded', String(sidebarExpanded));
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if isEmbed}
	<div class="min-h-screen bg-transparent" style="background: transparent !important; background-color: transparent !important;">
		{@render children()}
	</div>
{:else if isAuthPage}
	<div class="min-h-screen bg-gray-100 flex items-center justify-center p-4">
		{@render children()}
	</div>
{:else}
<div class="app-layout flex h-screen min-h-0 overflow-hidden bg-gray-50">
	<!-- Sidebar: fixed height, scrollable nav, expand/collapse -->
	<aside
		class="flex h-screen flex-col bg-gray-900 text-gray-400 shrink-0 transition-[width] duration-200 ease-out {sidebarExpanded ? 'w-52' : 'w-16'}"
	>
		<a href="/" class="shrink-0 flex items-center justify-center py-4 border-b border-gray-800 {sidebarExpanded ? 'px-3' : 'px-0'}" title="ProfitBot">
			{#if sidebarExpanded}
				<img src="/fonts/Roboto/PROFITBOT._LOGO_inverted.svg" alt="ProfitBot" class="h-8 w-auto max-w-full object-contain" />
			{:else}
				<img src={favicon} alt="ProfitBot" class="h-8 w-8 object-contain" />
			{/if}
		</a>
		<nav class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hide py-4 flex flex-col items-stretch {sidebarExpanded ? 'px-3' : 'px-0 items-center'}">
			<a href="/" class="flex items-center gap-3 rounded-lg py-3 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} hover:bg-gray-800 hover:text-white transition-colors opacity-60" title="Stream">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Stream</span>{/if}
			</a>
			<a href="/" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} transition-colors {($page.url.pathname === '/' ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Dashboard">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Dashboard</span>{/if}
			</a>
			<a href="/widgets" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} transition-colors {(($page.url.pathname as string).startsWith('/widgets') ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Widgets">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Widgets</span>{/if}
			</a>
			{#if data.role === 'admin'}
				<a href="/analytics" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} hover:bg-gray-800 hover:text-white transition-colors" title="Analytics">
					<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16"/></svg>
					{#if sidebarExpanded}<span class="text-sm font-medium truncate">Analytics</span>{/if}
				</a>
			{/if}
			<a href="/messages" class="relative flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} transition-colors {($page.url.pathname === '/messages' ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Messages">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Messages</span>{/if}
				{#if data.unreadCount > 0}
					<span class="absolute top-2 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-medium text-white ring-2 ring-gray-900">
						{data.unreadCount > 99 ? '99+' : data.unreadCount}
					</span>
				{/if}
			</a>
			<a href="/contacts" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} transition-colors {(($page.url.pathname as string) === '/contacts' ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Contacts">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Contacts</span>{/if}
			</a>
			<a href="/leadflow" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} transition-colors {(($page.url.pathname as string) === '/leadflow' ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Leadflow">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Leadflow</span>{/if}
			</a>
			<a href="/quote" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} transition-colors {(($page.url.pathname as string) === '/quote' ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Quote">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Quote</span>{/if}
			</a>
			<a href="/forms" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} transition-colors {(($page.url.pathname as string).startsWith('/forms') ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Forms">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Forms</span>{/if}
			</a>
			<a href="/workflows" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} transition-colors {(($page.url.pathname as string).startsWith('/workflows') ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Workflows">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Workflows</span>{/if}
			</a>
			<a href="/agents" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} transition-colors {(($page.url.pathname as string).startsWith('/agents') ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Agents">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Agents</span>{/if}
			</a>
			<a href="/templates" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} transition-colors {(($page.url.pathname as string).startsWith('/templates') ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Templates">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Templates</span>{/if}
			</a>
			<a href="/email" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} transition-colors {(($page.url.pathname as string).startsWith('/email') ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Email">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Email</span>{/if}
			</a>
			<a href="/products" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} transition-colors {(($page.url.pathname as string).startsWith('/products') ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Products">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Products</span>{/if}
			</a>
			<a href="/settings/diy-kit-builders" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} transition-colors {(($page.url.pathname as string).startsWith('/settings/diy-kit-builders') ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="DIY Kit Builder">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">DIY Kit Builder</span>{/if}
			</a>
			<div class="flex-1 min-h-4"></div>
			<a href="/team" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} transition-colors {(($page.url.pathname as string) === '/team' ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Team">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Team</span>{/if}
			</a>
			<a href="/integrations" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} transition-colors {(($page.url.pathname as string) === '/integrations' ? 'bg-gray-800 text-white' : 'hover:bg-gray-800 hover:text-white')}" title="Integrations">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Integrations</span>{/if}
			</a>
			<a href="/settings" class="flex items-center gap-3 rounded-lg py-3 mt-1 {sidebarExpanded ? 'px-3' : 'px-3 justify-center'} hover:bg-gray-800 hover:text-white transition-colors" title="Settings">
				<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
				{#if sidebarExpanded}<span class="text-sm font-medium truncate">Settings</span>{/if}
			</a>
		</nav>
		<button
			type="button"
			onclick={toggleSidebar}
			class="shrink-0 flex items-center justify-center w-full py-3 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors border-t border-gray-800"
			aria-label={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
		>
			<svg class="w-5 h-5 transition-transform duration-200 {sidebarExpanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7M18 19l-7-7 7-7"/>
			</svg>
			{#if sidebarExpanded}<span class="ml-2 text-sm font-medium">Collapse</span>{/if}
		</button>
	</aside>

	<!-- Main content wrapper: overflow-hidden so it never extends past viewport -->
	<div class="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
		<!-- Header -->
		<header class="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shrink-0">
			<h2 class="text-lg font-medium text-gray-800">
				{data.user
					? `Hello, ${(data.displayName && data.displayName.trim()) || data.user.email?.split('@')[0] || 'User'} 👋`
					: 'Dashboard'}
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
					{#if data.avatarUrl}
						<img
							src={data.avatarUrl}
							alt="Profile"
							class="w-9 h-9 rounded-full object-cover border border-gray-200"
							title={data.user.email ?? ''}
						/>
					{:else}
						<div
							class="w-9 h-9 rounded-full bg-amber-600 flex items-center justify-center text-white font-semibold text-sm"
							title={data.user.email ?? ''}
						>
							{(data.user.email ?? 'U').charAt(0).toUpperCase()}
						</div>
					{/if}
				{/if}
			</div>
		</header>

		<!-- Page content: flex column so pages can fill viewport height (e.g. Contacts list) -->
		<main class="flex-1 min-h-0 flex flex-col overflow-auto p-6">
			<div class="flex-1 min-h-0 flex flex-col">
				{@render children()}
			</div>
		</main>
	</div>
</div>
{/if}
