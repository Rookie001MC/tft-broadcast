<script>
	/** @type {import('./$types').PageProps} */
	let { form } = $props();
</script>

<svelte:head>
	<title>Set up operator access | TFT Broadcast</title>
	<meta
		name="description"
		content="Create the first operator account for the TFT broadcast control room."
	/>
</svelte:head>

<div class="grid min-h-screen place-items-center bg-surface-50-950 px-4 py-12">
	<section
		class="w-full max-w-md space-y-0 overflow-hidden card preset-outlined-surface-200-800"
		aria-labelledby="setup-title"
	>
		<!-- Header -->
		<header class="border-b border-surface-200-800 p-8 pb-6">
			<p class="mb-2 font-mono text-xs font-semibold tracking-widest text-primary-500 uppercase">
				Control room · First run
			</p>
			<h1 id="setup-title" class="h2">Create operator access</h1>
			<p class="mt-1 text-sm text-surface-600-400">
				This account controls tournament data and on-air graphics. Registration closes after setup.
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
				<label class="label" for="name">
					<span class="label-text">Operator name</span>
					<input
						class="input"
						id="name"
						name="name"
						type="text"
						autocomplete="name"
						placeholder="Jane Doe"
						required
					/>
				</label>

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
						autocomplete="new-password"
						placeholder="••••••••"
						minlength="12"
						aria-describedby="password-hint"
						required
					/>
					<span id="password-hint" class="text-surface-500-400 text-xs">
						Use at least 12 characters.
					</span>
				</label>

				<button type="submit" class="btn w-full preset-filled-primary-500">
					Create operator account
				</button>
			</form>
		</div>
	</section>
</div>
