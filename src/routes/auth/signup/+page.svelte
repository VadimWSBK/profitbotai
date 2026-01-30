<script lang="ts">
	let { data, form } = $props();
</script>

<div class="w-full max-w-sm mx-auto">
	<div class="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
		<div class="text-center mb-8">
			<h1 class="text-2xl font-bold text-gray-900">Create account</h1>
			<p class="text-gray-500 mt-1">Sign up for ProfitBot</p>
		</div>

		{#if form?.message}
			<div
				class="mb-4 p-3 rounded-lg text-sm {form.message.startsWith('Error')
					? 'bg-red-50 text-red-700'
					: 'bg-emerald-50 text-emerald-700'}"
			>
				{form.message}
			</div>
		{/if}

		<form
			method="POST"
			action="/auth/signup?/signup"
			class="space-y-4"
		>
			<div>
				<label for="email" class="block text-sm font-medium text-gray-700 mb-1">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none"
					placeholder="you@example.com"
				/>
			</div>
			<div>
				<label for="password" class="block text-sm font-medium text-gray-700 mb-1">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="new-password"
					required
					minlength="6"
					class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none"
					placeholder="At least 6 characters"
				/>
			</div>
			<button
				type="submit"
				class="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors"
			>
				Sign up
			</button>
		</form>

		<p class="mt-6 text-center text-sm text-gray-500">
			Already have an account?
			<a href="/login" class="font-medium text-amber-600 hover:text-amber-700">Sign in</a>
		</p>
	</div>
</div>
