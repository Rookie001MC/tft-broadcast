<script>
	import { getPageMetaContext } from '$lib/context/pageMetaContext.js';
	import LogOutIcon from '@lucide/svelte/icons/log-out';

	let { data } = $props();
	const pageMeta = getPageMetaContext();
	pageMeta.title = 'Settings';
	pageMeta.description = 'Review the current operator account and session controls.';
</script>

<div class="mx-auto max-w-4xl space-y-6 pb-16">
	<header>
		<p class="text-sm font-semibold text-primary-600-400">Administration</p>
		<h1 class="h1">Settings</h1>
		<p class="mt-2 text-surface-600-400">Account information and operator session controls.</p>
	</header>
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
