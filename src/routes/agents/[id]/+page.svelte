<script lang="ts">
	import { AGENT_TOOL_IDS, AGENT_TOOL_LABELS, DEFAULT_AGENT_TOOLS } from '$lib/agent-tools';
	import type { AgentToolId } from '$lib/agent-tools';
	import { getModels } from '$lib/llm-providers';
	import type { WebhookTrigger } from '$lib/widget-config';

	function slugFromName(name: string): string {
		const base = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'trigger';
		return base;
	}

	type AgentData = {
		id: string;
		name: string;
		description: string;
		systemPrompt: string;
		allowedTools?: string[];
		chatBackend?: string;
		n8nWebhookUrl?: string;
		llmProvider?: string;
		llmModel?: string;
		llmFallbackProvider?: string;
		llmFallbackModel?: string;
		webhookTriggers?: WebhookTrigger[];
		botRole?: string;
		botTone?: string;
		botInstructions?: string;
		agentTakeoverTimeoutMinutes?: number;
		createdAt: string;
		updatedAt: string;
	};

	let { data } = $props();
	const agentId = $derived((data.agentId as string) ?? '');
	const initial = $derived((data.initial as AgentData) ?? null);
	const llmKeysAvailable = $derived((data.llmKeysAvailable as string[]) ?? []);
	const origin = $derived((data.origin as string) ?? '');
	const chatwootWebhookUrl = $derived(agentId && origin ? `${origin}/api/webhooks/chatwoot/${agentId}` : '');

	let name = $state('');
	let description = $state('');
	let systemPrompt = $state('');
	let allowedTools = $state<Set<string>>(new Set(DEFAULT_AGENT_TOOLS));
	let chatBackend = $state<'n8n' | 'direct'>('direct');
	let n8nWebhookUrl = $state('');
	let llmProvider = $state('');
	let llmModel = $state('');
	let llmFallbackProvider = $state('');
	let llmFallbackModel = $state('');
	let agentTakeoverTimeoutMinutes = $state(5);
	let webhookTriggers = $state<WebhookTrigger[]>([]);
	let botRole = $state('');
	let botTone = $state('');
	let botInstructions = $state('');
	let saving = $state(false);
	let error = $state<string | null>(null);
	let trainStatus = $state<{ configured: boolean; documentCount: number } | null>(null);
	let trainUploading = $state(false);
	let trainScraping = $state(false);
	let trainUploadFile = $state<File | null>(null);
	let trainScrapeUrl = $state('');

	type AgentRuleRow = { id: string; content: string; tags: string[] };
	let agentRules = $state<AgentRuleRow[]>([]);
	let rulesLoading = $state(true);
	let ruleSaving = $state<string | null>(null);

	type AgentTab = 'tools' | 'connect' | 'train' | 'chatwoot';
	let activeTab = $state<AgentTab>('train');
	let chatwootCopyDone = $state(false);

	$effect(() => {
		const init = initial;
		if (init) {
			name = init.name;
			description = init.description;
			systemPrompt = init.systemPrompt;
			allowedTools = new Set(Array.isArray(init.allowedTools) ? init.allowedTools : DEFAULT_AGENT_TOOLS);
			chatBackend = (init.chatBackend === 'n8n' ? 'n8n' : 'direct') as 'n8n' | 'direct';
			n8nWebhookUrl = init.n8nWebhookUrl ?? '';
			llmProvider = init.llmProvider ?? '';
			llmModel = init.llmModel ?? '';
			llmFallbackProvider = init.llmFallbackProvider ?? '';
			llmFallbackModel = init.llmFallbackModel ?? '';
			agentTakeoverTimeoutMinutes = typeof init.agentTakeoverTimeoutMinutes === 'number' ? init.agentTakeoverTimeoutMinutes : 5;
			webhookTriggers = Array.isArray(init.webhookTriggers) ? init.webhookTriggers : [];
			botRole = init.botRole ?? '';
			botTone = init.botTone ?? '';
			botInstructions = init.botInstructions ?? '';
		}
	});

	function toggleTool(id: AgentToolId) {
		const next = new Set(allowedTools);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		allowedTools = next;
	}

	function addTrigger() {
		const name = 'New trigger';
		const id = slugFromName(name);
		const existingIds = new Set(webhookTriggers.map((t) => t.id));
		let uniqueId = id;
		let n = 1;
		while (existingIds.has(uniqueId)) {
			uniqueId = `${id}_${n}`;
			n += 1;
		}
		webhookTriggers = [
			...webhookTriggers,
			{ id: uniqueId, name, description: '', webhookUrl: '', enabled: true }
		];
	}

	function removeTrigger(index: number) {
		webhookTriggers = webhookTriggers.filter((_, i) => i !== index);
	}

	async function fetchTrainStatus() {
		if (!agentId) return;
		try {
			const res = await fetch(`/api/agents/${agentId}/train`);
			const data = await res.json().catch(() => ({}));
			trainStatus = { configured: data.configured ?? false, documentCount: data.documentCount ?? 0 };
		} catch {
			trainStatus = { configured: false, documentCount: 0 };
		}
	}

	async function fetchRules() {
		if (!agentId) return;
		rulesLoading = true;
		try {
			const res = await fetch(`/api/agents/${agentId}/rules`);
			const data = await res.json().catch(() => ({}));
			const list = Array.isArray(data.rules) ? data.rules : [];
			agentRules = list.map((r: { id: string; content: string; tags?: string[] }) => ({
				id: r.id,
				content: r.content ?? '',
				tags: Array.isArray(r.tags) ? r.tags : []
			}));
		} catch {
			agentRules = [];
		} finally {
			rulesLoading = false;
		}
	}

	function addRule() {
		agentRules = [
			...agentRules,
			{ id: `new-${Date.now()}`, content: '', tags: [] }
		];
	}

	function removeRule(index: number) {
		const r = agentRules[index];
		if (r.id.startsWith('new-')) {
			agentRules = agentRules.filter((_, i) => i !== index);
			return;
		}
		if (confirm('Delete this rule?')) {
			fetch(`/api/agents/${agentId}/rules/${r.id}`, { method: 'DELETE' }).then((res) => {
				if (res.ok) agentRules = agentRules.filter((_, i) => i !== index);
			});
		}
	}

	async function saveRule(index: number) {
		const r = agentRules[index];
		const content = r.content.trim();
		if (!content) return;
		ruleSaving = r.id;
		try {
			const isNew = r.id.startsWith('new-');
			const url = isNew
				? `/api/agents/${agentId}/rules`
				: `/api/agents/${agentId}/rules/${r.id}`;
			const method = isNew ? 'POST' : 'PATCH';
			const body = isNew
				? JSON.stringify({ content, tags: r.tags })
				: JSON.stringify({ content, tags: r.tags });
			const res = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Failed to save rule');
			if (isNew && data.id) {
				agentRules = agentRules.map((x, i) =>
					i === index ? { ...x, id: data.id } : x
				);
			}
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to save rule');
		} finally {
			ruleSaving = null;
		}
	}

	function parseTagsInput(val: string): string[] {
		return val
			.split(/[\s,;]+/)
			.map((t) => t.trim().toLowerCase())
			.filter(Boolean);
	}

	async function trainUpload() {
		if (!trainUploadFile || !agentId) return;
		trainUploading = true;
		try {
			const form = new FormData();
			form.append('file', trainUploadFile);
			const res = await fetch(`/api/agents/${agentId}/train/upload`, { method: 'POST', body: form });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Upload failed');
			alert(`Added ${data.chunks ?? 0} chunks to the knowledge base.`);
			trainUploadFile = null;
			fetchTrainStatus();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Upload failed');
		} finally {
			trainUploading = false;
		}
	}

	async function copyChatwootUrl() {
		if (!chatwootWebhookUrl) return;
		try {
			await navigator.clipboard.writeText(chatwootWebhookUrl);
			chatwootCopyDone = true;
			setTimeout(() => (chatwootCopyDone = false), 2000);
		} catch {
			// fallback: select and show copied in UI still works if we focus the input
		}
	}

	async function trainScrape() {
		const url = trainScrapeUrl.trim();
		if (!url || !agentId) return;
		trainScraping = true;
		try {
			const res = await fetch(`/api/agents/${agentId}/train/scrape`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || 'Scrape failed');
			alert(`Added ${data.chunks ?? 0} chunks to the knowledge base.`);
			trainScrapeUrl = '';
			fetchTrainStatus();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Scrape failed');
		} finally {
			trainScraping = false;
		}
	}

	async function save() {
		error = null;
		const trimmed = name.trim();
		if (!trimmed) {
			error = 'Name is required';
			return;
		}
		saving = true;
		try {
			const res = await fetch(`/api/agents/${agentId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: trimmed,
					description: description.trim(),
					system_prompt: systemPrompt.trim(),
					allowed_tools: Array.from(allowedTools),
					chatBackend,
					n8nWebhookUrl: n8nWebhookUrl.trim(),
					llmProvider: llmProvider.trim(),
					llmModel: llmModel.trim(),
					llmFallbackProvider: llmFallbackProvider.trim(),
					llmFallbackModel: llmFallbackModel.trim(),
					webhookTriggers,
					botRole: botRole.trim(),
					botTone: botTone.trim(),
					botInstructions: botInstructions.trim(),
					agentTakeoverTimeoutMinutes
				})
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(result.error || 'Failed to save');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save';
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		if (agentId) {
			fetchTrainStatus();
			fetchRules();
		}
	});
</script>

<svelte:head>
	<title>{initial?.name ?? 'Agent'} – ProfitBot</title>
</svelte:head>

<div class="max-w-2xl mx-auto">
	<header class="flex flex-wrap items-start justify-between gap-4 mb-6">
		<div class="flex-1 min-w-0">
			<a href="/agents" class="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block">← Back to Agents</a>
			<h1 class="text-2xl font-bold text-gray-900 mb-1">Edit Agent</h1>
			<input
				type="text"
				class="w-full max-w-md text-lg font-medium text-gray-700 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-amber-500 focus:outline-none px-0 py-1"
				placeholder="Agent name"
				bind:value={name}
				aria-label="Agent name"
			/>
			<p class="text-gray-500 mt-1 text-sm">
				Use this agent in workflow actions or assign it to widgets so they share the same training.
			</p>
		</div>
		<button
			type="button"
			onclick={save}
			disabled={saving}
			class="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors shrink-0"
		>
			{saving ? 'Saving…' : 'Save'}
		</button>
	</header>

	<div class="flex gap-6 border-b border-gray-200 mb-6" role="tablist" aria-label="Agent settings">
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'tools'}
			aria-controls="panel-tools"
			id="tab-tools"
			class="pb-3 text-sm font-medium border-b-2 transition-colors {activeTab === 'tools' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
			onclick={() => (activeTab = 'tools')}
		>
			Tools
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'connect'}
			aria-controls="panel-connect"
			id="tab-connect"
			class="pb-3 text-sm font-medium border-b-2 transition-colors {activeTab === 'connect' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
			onclick={() => (activeTab = 'connect')}
		>
			Connect
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'train'}
			aria-controls="panel-train"
			id="tab-train"
			class="pb-3 text-sm font-medium border-b-2 transition-colors {activeTab === 'train' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
			onclick={() => (activeTab = 'train')}
		>
			Train Bot
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'chatwoot'}
			aria-controls="panel-chatwoot"
			id="tab-chatwoot"
			class="pb-3 text-sm font-medium border-b-2 transition-colors {activeTab === 'chatwoot' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
			onclick={() => (activeTab = 'chatwoot')}
		>
			Chatwoot
		</button>
	</div>

	<form onsubmit={(e) => { e.preventDefault(); save(); }} class="space-y-6">
		{#if error}
			<div class="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
		{/if}

		{#if activeTab === 'tools'}
			<div id="panel-tools" role="tabpanel" aria-labelledby="tab-tools" class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
				<h2 class="text-lg font-semibold text-gray-900 mb-2">Tools</h2>
				<p class="text-sm text-gray-500 mb-4">
					When this agent is used with autonomy enabled, it can call these tools. Enable only the tools you want this agent to use.
				</p>
				<div class="flex flex-wrap gap-3">
					{#each AGENT_TOOL_IDS as id}
						<label class="flex items-center gap-2 cursor-pointer">
							<input
								type="checkbox"
								checked={allowedTools.has(id)}
								onchange={() => toggleTool(id)}
								class="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
							/>
							<span class="text-sm font-medium text-gray-700">{AGENT_TOOL_LABELS[id]}</span>
						</label>
					{/each}
				</div>
			</div>
		{:else if activeTab === 'connect'}
			<div id="panel-connect" role="tabpanel" aria-labelledby="tab-connect" class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
				<h2 class="text-lg font-semibold text-gray-900 mb-2">Connect</h2>
				<p class="text-sm text-gray-500 mb-4">Use an n8n webhook or Direct LLM (API keys in Settings). Widgets that use this agent will use this configuration.</p>
				<label class="block mb-4">
					<span class="text-sm font-medium text-gray-700 mb-2 block">Backend</span>
					<select bind:value={chatBackend} class="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm">
						<option value="n8n">n8n Webhook</option>
						<option value="direct">Direct LLM</option>
					</select>
				</label>
				{#if chatBackend === 'n8n'}
					<label class="block">
						<span class="text-sm font-medium text-gray-700 mb-1">n8n Webhook URL</span>
						<input type="url" bind:value={n8nWebhookUrl} class="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" placeholder="https://your-n8n.com/webhook/..." />
					</label>
				{:else}
					{#if llmKeysAvailable.length === 0}
						<p class="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">Add at least one LLM API key in <a href="/settings" class="underline font-medium">Settings</a> to use Direct LLM.</p>
					{:else}
					<div class="space-y-4">
						<label class="block">
							<span class="text-sm font-medium text-gray-700 mb-1">Primary LLM</span>
							<select bind:value={llmProvider} class="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm">
								<option value="">— Select —</option>
								{#each llmKeysAvailable as pid}
									<option value={pid}>{pid === 'openai' ? 'OpenAI' : pid === 'anthropic' ? 'Anthropic' : pid === 'google' ? 'Google (Gemini)' : pid}</option>
								{/each}
							</select>
						</label>
						{#if llmProvider}
							<label class="block">
								<span class="text-sm font-medium text-gray-700 mb-1">Primary model</span>
								<select bind:value={llmModel} class="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono">
									{#each getModels(llmProvider) as model}
										<option value={model}>{model}</option>
									{/each}
								</select>
							</label>
						{/if}
						<label class="block">
							<span class="text-sm font-medium text-gray-700 mb-1">Fallback LLM (optional)</span>
							<select bind:value={llmFallbackProvider} class="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm">
								<option value="">— None —</option>
								{#each llmKeysAvailable.filter((p) => p !== llmProvider) as pid}
									<option value={pid}>{pid === 'openai' ? 'OpenAI' : pid === 'anthropic' ? 'Anthropic' : pid === 'google' ? 'Google (Gemini)' : pid}</option>
								{/each}
							</select>
						</label>
						{#if llmFallbackProvider}
							<label class="block">
								<span class="text-sm font-medium text-gray-700 mb-1">Fallback model</span>
								<select bind:value={llmFallbackModel} class="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono">
									{#each getModels(llmFallbackProvider) as model}
										<option value={model}>{model}</option>
									{/each}
								</select>
							</label>
						{/if}
						<label class="block">
							<span class="text-sm font-medium text-gray-700 mb-1">Live agent timeout (minutes)</span>
							<p class="text-xs text-gray-500 mb-1">If a live agent hasn&apos;t replied in this many minutes, the AI takes over again.</p>
							<input type="number" min="1" max="120" bind:value={agentTakeoverTimeoutMinutes} class="w-full max-w-[120px] px-3 py-2 border border-gray-300 rounded-lg text-sm" />
						</label>
						<div class="mt-4 pt-4 border-t border-gray-200">
							<h4 class="text-sm font-semibold text-gray-900 mb-1">Webhook triggers</h4>
							<p class="text-xs text-gray-500 mb-3">When the AI recognises the user&apos;s intent, it calls the matching webhook and uses the result in the reply.</p>
							<div class="space-y-4">
								{#each webhookTriggers as trigger, i}
									<div class="border border-gray-200 rounded-lg p-4 bg-white space-y-3">
										<div class="flex items-center justify-between gap-2">
											<label class="block flex-1 min-w-0">
												<span class="text-xs font-medium text-gray-500">Name</span>
												<input type="text" bind:value={trigger.name} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-0.5" placeholder="e.g. Roof quote" />
											</label>
											<label class="block w-32 shrink-0">
												<span class="text-xs font-medium text-gray-500">ID (slug)</span>
												<input type="text" bind:value={trigger.id} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono mt-0.5" placeholder="roof_quote" />
											</label>
											<label class="flex items-center gap-2 pt-6">
												<input type="checkbox" bind:checked={trigger.enabled} class="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
												<span class="text-xs font-medium text-gray-600">Enabled</span>
											</label>
											<button type="button" class="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 shrink-0" title="Remove trigger" onclick={() => removeTrigger(i)}>🗑</button>
										</div>
										<label class="block">
											<span class="text-xs font-medium text-gray-500">Description (for AI to recognise intent)</span>
											<textarea bind:value={trigger.description} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-0.5 min-h-[60px]" placeholder="e.g. User asks for a roof sealing quote" rows="2"></textarea>
										</label>
										<label class="block">
											<span class="text-xs font-medium text-gray-500">Webhook URL</span>
											<input type="url" bind:value={trigger.webhookUrl} class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono mt-0.5" placeholder="https://your-n8n.com/webhook/..." />
										</label>
									</div>
								{/each}
								<button type="button" onclick={addTrigger} class="text-sm text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1">+ Add trigger</button>
							</div>
						</div>
					</div>
					{/if}
				{/if}
			</div>
		{:else if activeTab === 'chatwoot'}
			<div id="panel-chatwoot" role="tabpanel" aria-labelledby="tab-chatwoot" class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
				<h2 class="text-lg font-semibold text-gray-900 mb-2">Chatwoot</h2>
				<p class="text-sm text-gray-500 mb-4">
					Use this webhook URL in Chatwoot when adding a bot (Settings → Bots → Add Bot). Chatwoot will send messages here and this agent will reply. Set <code class="text-xs bg-gray-100 px-1 rounded">CHATWOOT_BOT_ACCESS_TOKEN</code> and <code class="text-xs bg-gray-100 px-1 rounded">CHATWOOT_BASE_URL</code> in your app env.
				</p>
				<div class="flex flex-wrap items-center gap-2">
					<input
						type="text"
						readonly
						value={chatwootWebhookUrl}
						class="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono bg-gray-50"
						aria-label="Chatwoot webhook URL"
					/>
					<button
						type="button"
						onclick={copyChatwootUrl}
						class="px-4 py-2 rounded-lg text-sm font-medium transition-colors {chatwootCopyDone ? 'bg-green-600 text-white' : 'bg-amber-600 hover:bg-amber-700 text-white'}"
					>
						{chatwootCopyDone ? 'Copied!' : 'Copy URL'}
					</button>
				</div>
			</div>
		{:else if activeTab === 'train'}
			<div id="panel-train" role="tabpanel" aria-labelledby="tab-train" class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
				<h2 class="text-lg font-semibold text-gray-900 mb-1">Train Bot</h2>
				<p class="text-sm text-gray-500 mb-6">
					Define how the bot should act and add knowledge. When this agent is used by a widget, these instructions and the knowledge base are used.
				</p>

				<div class="border border-gray-200 rounded-lg p-4 mb-6 bg-gray-50/50">
					<h4 class="text-sm font-semibold text-gray-900 mb-3">Bot instructions (role, tone, rules)</h4>
					<p class="text-xs text-gray-500 mb-4">Sent with every message. Keep Role and Tone short; move CRM, sales behavior, product details into Rules—they're retrieved by relevance, reducing tokens per request.</p>
					<div class="space-y-4">
						<label class="block">
							<div class="flex items-center justify-between gap-2 mb-1">
								<span class="text-sm font-medium text-gray-700">Role</span>
								<span class="text-xs {botRole.length > 800 ? 'text-amber-600 font-medium' : 'text-gray-500'}">
									{botRole.length} chars (~{Math.ceil(botRole.length / 4)} tokens)
									{#if botRole.length > 800}
										— trim for lower cost
									{/if}
								</span>
							</div>
							<textarea bind:value={botRole} placeholder="e.g. You are a helpful sales assistant for NetZero Coating. Help with DIY quotes and Done For You installation." class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-[120px] font-mono {botRole.length > 800 ? 'border-amber-400' : ''}" rows="4"></textarea>
							{#if botRole.length > 800}
								<p class="mt-1 text-xs text-amber-700">Role is long. Move CRM rules, sales behavior, product principles to Rules below—add as separate rules with tags like crm, sales, product.</p>
							{:else}
								<p class="mt-1 text-xs text-gray-500">2–4 sentences. Who the bot is. Put detailed policies in Rules.</p>
							{/if}
							<button
								type="button"
								onclick={() => (botRole = 'You are a knowledgeable sales and support assistant. Help with DIY product quotes and Done For You installation. Follow the rules below.')}
								class="mt-1 text-xs text-amber-600 hover:text-amber-700 font-medium"
							>
								Use compact template
							</button>
						</label>
						<label class="block">
							<div class="flex items-center justify-between gap-2 mb-1">
								<span class="text-sm font-medium text-gray-700">Tone</span>
								<span class="text-xs {botTone.length > 300 ? 'text-amber-600 font-medium' : 'text-gray-500'}">
									{botTone.length} chars (~{Math.ceil(botTone.length / 4)} tokens)
									{#if botTone.length > 300}
										— keep brief
									{/if}
								</span>
							</div>
							<textarea bind:value={botTone} placeholder="e.g. Professional, friendly, concise. Australian English." class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-[80px] font-mono {botTone.length > 300 ? 'border-amber-400' : ''}" rows="2"></textarea>
							{#if botTone.length > 300}
								<p class="mt-1 text-xs text-amber-700">Tone is long. Use 1–2 lines; move style details to Rules if needed.</p>
							{:else}
								<p class="mt-1 text-xs text-gray-500">1–2 lines. How the bot should sound.</p>
							{/if}
						</label>
						<div class="border-t border-gray-200 pt-4 mt-4">
							<h4 class="text-sm font-semibold text-gray-900 mb-2">Instructions / rules (RAG)</h4>
							<p class="text-xs text-gray-500 mb-3">
								Add rules one by one. Each rule is embedded and retrieved at chat time when relevant—only matching rules are sent to the AI.
							</p>
							{#if rulesLoading}
								<p class="text-sm text-gray-500">Loading rules…</p>
							{:else}
								<div class="space-y-4">
									{#each agentRules as rule, i}
										<div class="border border-gray-200 rounded-lg p-4 bg-white space-y-3">
											<div class="flex items-start justify-between gap-2">
												<label class="block flex-1 min-w-0">
													<span class="text-xs font-medium text-gray-500">Rule description</span>
													<textarea
														bind:value={rule.content}
														class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-0.5 min-h-[80px]"
														placeholder="e.g. NetZero Coating reflects up to 90% of solar heat."
														rows="3"
													></textarea>
												</label>
												<button
													type="button"
													class="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 shrink-0"
													title="Remove rule"
													onclick={() => removeRule(i)}
												>
													🗑
												</button>
											</div>
											<div class="flex flex-wrap items-center gap-2">
												<span class="text-xs font-medium text-gray-500 shrink-0">Tags (comma-separated):</span>
												<input
													type="text"
													value={rule.tags.join(', ')}
													oninput={(e) => (rule.tags = parseTagsInput((e.currentTarget as HTMLInputElement).value))}
													class="flex-1 min-w-[150px] px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
													placeholder="e.g. product, pricing, coverage"
												/>
												<button
													type="button"
													disabled={!rule.content.trim() || ruleSaving === rule.id}
													onclick={() => saveRule(i)}
													class="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
												>
													{ruleSaving === rule.id ? 'Saving…' : rule.id.startsWith('new-') ? 'Add rule' : 'Update'}
												</button>
											</div>
										</div>
									{/each}
									<button
										type="button"
										onclick={addRule}
										class="text-sm text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1"
									>
										+ Add rule
									</button>
								</div>
							{/if}
						</div>
						<label class="block mt-4">
							<div class="flex items-center justify-between gap-2 mb-1">
								<span class="text-sm font-medium text-gray-700">Additional instructions (optional)</span>
								<span class="text-xs text-gray-500">{botInstructions.length} chars (~{Math.ceil(botInstructions.length / 4)} tokens)</span>
							</div>
							<textarea bind:value={botInstructions} placeholder="e.g. Keep replies under 3 sentences. Always ask for roof size." class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-[80px] font-mono" rows="3"></textarea>
							<p class="mt-1 text-xs text-gray-500">Short, always-applicable rules. Put detailed policies in Rules above.</p>
						</label>
					</div>
				</div>

				<h4 class="text-sm font-semibold text-gray-800 mb-2">Knowledge base (RAG)</h4>
				<p class="text-gray-500 text-sm mb-4">
					Add knowledge from PDFs or web pages. Content is chunked, embedded (OpenAI or Gemini), and stored for this agent. Widgets using this agent can answer from this data.
				</p>
				{#if trainStatus && !trainStatus.configured}
					<p class="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm mb-6">
						Add an API key in <strong>Settings → LLM keys</strong> (Google or OpenAI), or set <code class="bg-amber-100 px-1 rounded">GEMINI_API_KEY</code>/<code class="bg-amber-100 px-1 rounded">OPENAI_API_KEY</code> in <code class="bg-amber-100 px-1 rounded">.env</code>.
					</p>
				{/if}
				{#if trainStatus}
					<p class="text-sm text-gray-600 mb-6">Knowledge base: <strong>{trainStatus.documentCount}</strong> chunk(s) stored for this agent.</p>
				{/if}
				<div class="space-y-6">
					<div>
						<h4 class="text-sm font-medium text-gray-800 mb-2">Upload PDF</h4>
						<div class="flex flex-wrap items-end gap-3">
							<label class="flex-1 min-w-[200px]">
								<span class="sr-only">Choose PDF</span>
								<input
									type="file"
									accept="application/pdf"
									class="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-amber-50 file:text-amber-800 file:font-medium"
									onchange={(e) => (trainUploadFile = (e.currentTarget.files ?? [])[0] ?? null)}
								/>
							</label>
							<button
								type="button"
								disabled={!trainUploadFile || trainUploading || !trainStatus?.configured}
								onclick={trainUpload}
								class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:pointer-events-none text-white font-medium rounded-lg"
							>
								{trainUploading ? 'Uploading…' : 'Add to knowledge base'}
							</button>
						</div>
					</div>
					<div>
						<h4 class="text-sm font-medium text-gray-800 mb-2">Scrape a webpage</h4>
						<div class="flex flex-wrap gap-3">
							<input
								type="url"
								bind:value={trainScrapeUrl}
								placeholder="https://example.com/page"
								class="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm"
							/>
							<button
								type="button"
								disabled={!trainScrapeUrl.trim() || trainScraping || !trainStatus?.configured}
								onclick={trainScrape}
								class="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:pointer-events-none text-white font-medium rounded-lg"
							>
								{trainScraping ? 'Scraping…' : 'Add to knowledge base'}
							</button>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</form>
</div>
