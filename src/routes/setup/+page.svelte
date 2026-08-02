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

<main class="grid min-h-screen place-items-center bg-slate-950 px-5 py-12 text-slate-100">
	<section
		class="w-full max-w-md overflow-hidden border border-slate-700 bg-slate-900 shadow-2xl shadow-cyan-950/30"
		aria-labelledby="setup-title"
	>
		<div class="border-l-4 border-cyan-400 px-7 py-6">
			<p class="font-mono text-xs font-semibold tracking-[0.22em] text-cyan-300 uppercase">
				Control room · First run
			</p>
			<h1 id="setup-title" class="mt-3 text-3xl font-black tracking-tight">
				Create operator access
			</h1>
			<p class="mt-2 text-sm leading-6 text-slate-400">
				This account controls tournament data and on-air graphics. Registration closes after setup.
			</p>
		</div>

		<div class="border-t border-slate-700 px-7 py-7">
			{#if form?.message}
				<p
					class="mb-5 border border-red-400/50 bg-red-950/60 px-4 py-3 text-sm text-red-100"
					role="alert"
				>
					{form.message}
				</p>
			{/if}

			<form method="POST" class="grid gap-5">
				<label class="grid gap-2 text-sm font-semibold text-slate-200" for="name">
					Operator name
					<input
						class="h-11 border border-slate-600 bg-slate-950 px-3 text-base text-white transition outline-none placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
						id="name"
						name="name"
						type="text"
						autocomplete="name"
						required
					/>
				</label>

				<label class="grid gap-2 text-sm font-semibold text-slate-200" for="email">
					Email
					<input
						class="h-11 border border-slate-600 bg-slate-950 px-3 text-base text-white transition outline-none placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
						id="email"
						name="email"
						type="email"
						autocomplete="email"
						required
					/>
				</label>

				<label class="grid gap-2 text-sm font-semibold text-slate-200" for="password">
					Password
					<input
						class="h-11 border border-slate-600 bg-slate-950 px-3 text-base text-white transition outline-none placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
						id="password"
						name="password"
						type="password"
						autocomplete="new-password"
						minlength="12"
						aria-describedby="password-hint"
						required
					/>
					<span id="password-hint" class="font-normal text-slate-500">
						Use at least 12 characters.
					</span>
				</label>

				<button
					class="mt-1 h-12 bg-cyan-400 px-4 font-black tracking-wide text-slate-950 uppercase transition hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300"
					type="submit"
				>
					Create operator account
				</button>
			</form>
		</div>
	</section>
</main>
