<script>
	import { resolve } from '$app/paths';
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import CircleUserIcon from '@lucide/svelte/icons/circle-user';
	import TvIcon from '@lucide/svelte/icons/tv-2';
	import siteConfig from '$lib/config.js';

	/** @type {{ headerTitle?: string }} */
	let { headerTitle } = $props();
</script>

<AppBar class="shrink-0 border-b border-surface-200-800 preset-filled-surface-100-900">
	<AppBar.Toolbar class="grid-cols-[auto_1fr_auto]">
		<!-- Brand -->
		<AppBar.Lead>
			<a href={resolve('/admin')} class="flex items-center gap-2.5 no-underline">
				<span
					class="text-on-primary-token flex size-8 items-center justify-center rounded-lg bg-primary-500"
				>
					<TvIcon class="size-4" />
				</span>
				<span class="hidden text-sm font-bold tracking-wide sm:block">
					{siteConfig.siteName}
				</span>
			</a>
		</AppBar.Lead>

		<!-- Current page title -->
		<AppBar.Headline>
			{#if headerTitle}
				<h1 class="text-base font-semibold">{headerTitle}</h1>
			{/if}
		</AppBar.Headline>

		<!-- User actions -->
		<AppBar.Trail>
			<div class="flex items-center gap-1">
				<button type="button" class="btn-icon hover:preset-tonal-primary" aria-label="User profile">
					<CircleUserIcon class="size-5" />
				</button>
				<form method="POST" action="?/logout">
					<button type="submit" class="btn-icon hover:preset-tonal-error" aria-label="Sign out">
						<LogOutIcon class="size-5" />
					</button>
				</form>
			</div>
		</AppBar.Trail>
	</AppBar.Toolbar>
</AppBar>
