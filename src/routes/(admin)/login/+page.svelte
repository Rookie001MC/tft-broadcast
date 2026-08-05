<script>
	import { getPageMetaContext } from '$lib/context/pageMetaContext';
	/** @type {import('./$types').PageProps} */
	let { form } = $props();

	const pageMetaContext = getPageMetaContext();
	const pageMeta = {
		title: 'Operator Login',
		description: 'Sign in to the TFT broadcast control room.'
	};
	pageMetaContext.title = pageMeta.title;
	pageMetaContext.description = pageMeta.description;
</script>

<div class="grid min-h-screen place-items-center bg-surface-50-950 px-4 py-12">
	<section
		class="w-full max-w-md space-y-0 overflow-hidden card preset-outlined-surface-200-800"
		aria-labelledby="login-title"
	>
		<!-- Header -->
		<header class="border-b border-surface-200-800 p-8 pb-6">
			<p class="mb-2 font-mono text-xs font-semibold tracking-widest text-primary-500 uppercase">
				TFT Broadcast · Operator
			</p>
			<h1 id="login-title" class="h2">Enter the control room</h1>
			<p class="mt-1 text-sm text-surface-600-400">
				Sign in to manage tournament data and on-air graphics.
			</p>
		</header>

		<!-- Form body -->
		<div class="space-y-5 p-8">
			{#if form?.message}
				<aside class="card preset-tonal-error p-4 text-sm" role="alert">
					{form.message}
				</aside>
			{/if}

			<form method="POST" class="space-y-4">
				<label class="label" for="email">
					<span class="label-text">Email</span>
					<input
						class="input"
						id="email"
						name="email"
						type="email"
						autocomplete="email"
						placeholder="you@example.com"
						required
					/>
				</label>

				<label class="label" for="password">
					<span class="label-text">Password</span>
					<input
						class="input"
						id="password"
						name="password"
						type="password"
						autocomplete="current-password"
						placeholder="••••••••"
						required
					/>
				</label>

				<button type="submit" class="btn w-full preset-filled-primary-500"> Sign in </button>
			</form>
		</div>
	</section>
</div>
