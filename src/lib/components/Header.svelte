<script>
	import { resolve } from '$app/paths';
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import CircleUserIcon from '@lucide/svelte/icons/circle-user';
	import siteConfig from '$lib/config.js';
	import { Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import { authClient } from '$lib/auth-client.js';

	/** @type {{ headerTitle?: string }} */
	let { headerTitle } = $props();

	const session = authClient.useSession();
</script>

<AppBar class="shrink-0 border-b border-surface-200-800 preset-filled-surface-100-900">
	<AppBar.Toolbar class="grid-cols-[auto_1fr_auto]">
		<!-- Brand -->
		<AppBar.Lead>
			<a href={resolve('/admin')} class="flex items-center gap-2.5 no-underline">
				<img src="/dark-mode.png" alt="Logo USEC" class="size-10" />
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
				<Popover>
					<Popover.Trigger
						type="button"
						class="btn-icon hover:preset-tonal-primary"
						aria-label="User profile"
					>
						<CircleUserIcon class="size-5" />
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner>
							<Popover.Content class="max-w-md card bg-surface-200-800 p-4 shadow-xl">
								<div class="space-y-4">
									{#if $session.isPending}
										<p>Loading...</p>
									{:else if $session.data}
										<div class="flex flex-col">
											<Popover.Title>{$session.data.user.name}</Popover.Title>
											<Popover.Description>
												<p class="text-surface-400-800 text-sm">{$session.data.user.email}</p>
											</Popover.Description>
										</div>
									{/if}
									<hr class="border-surface-500" />

									<form method="POST" action={`${resolve('/admin/settings')}?/logout`}>
										<button
											type="submit"
											class="btn hover:preset-tonal-error"
											aria-label="Sign out"
										>
											<LogOutIcon class="size-5" />
											<span class="ml-2">Sign out</span>
										</button>
									</form>
								</div>
							</Popover.Content>
						</Popover.Positioner>
					</Portal>
				</Popover>
			</div>
		</AppBar.Trail>
	</AppBar.Toolbar>
</AppBar>
