<script>
	import { getPageMetaContext } from '$lib/context/pageMetaContext.js';
	import LogOutIcon from '@lucide/svelte/icons/log-out';

	let { data, form = null } = $props();
	const pageMeta = getPageMetaContext();
	pageMeta.title = 'Settings';
	pageMeta.description = 'Manage TFT match routing and operator session controls.';
</script>

<div class="mx-auto max-w-4xl space-y-6 pb-16">
	<header>
		<p class="text-sm font-semibold text-primary-600-400">Administration</p>
		<h1 class="h1">Settings</h1>
		<p class="mt-2 text-surface-600-400">Account information and operator session controls.</p>
	</header>
	<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-6">
		<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">TFT Match API</p>
		<h2 class="mt-1 h3">Platform routing</h2>
		<p class="mt-2 text-surface-600-400">
			Choose the one platform region used for optional TFT match imports. Changes apply without a
			server restart.
		</p>
		<form method="POST" action="?/saveTftRegion" class="mt-6 flex flex-wrap items-end gap-3">
			<label class="label min-w-64 flex-1">
				<span class="label-text">TFT platform region</span>
				<select
					class="select"
					name="region"
					value={form?.action === 'saveTftRegion'
						? (form.tftMatchSettings?.region ?? data.tftMatchSettings.region ?? '')
						: (data.tftMatchSettings.region ?? '')}
				>
					{#each data.tftPlatformRegionOptions as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</label>
			<button class="btn preset-tonal-primary" type="submit">Save region</button>
		</form>
		{#if form?.action === 'saveTftRegion' && form.message}
			<p class="mt-4 rounded-container preset-tonal-error p-4" role="alert">{form.message}</p>
		{/if}
	</section>
	{#if data.user}
		<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-6">
			<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">
				Signed-in operator
			</p>
			<h2 class="mt-1 h3">{data.user.name}</h2>
			<p class="mt-1 text-surface-600-400">{data.user.email}</p>
			<hr class="my-6 border-surface-200-800" />
			<form method="POST" action="?/logout">
				<button class="btn preset-tonal-error" type="submit"
					><LogOutIcon class="size-4" /> Sign out</button
				>
			</form>
		</section>
	{/if}
</div>
