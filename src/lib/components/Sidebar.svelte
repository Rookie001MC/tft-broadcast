<script>
	import { page } from '$app/state';
	import { Navigation } from '@skeletonlabs/skeleton-svelte';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import UsersIcon from '@lucide/svelte/icons/users';
	import TrophyIcon from '@lucide/svelte/icons/trophy';
	import SwordsIcon from '@lucide/svelte/icons/swords';
	import MonitorPlayIcon from '@lucide/svelte/icons/monitor-play';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import { Image } from '@lucide/svelte';

	const navGroups = [
		{
			label: 'Main',
			items: [
				{ href: '/admin', label: 'Dashboard', icon: LayoutDashboardIcon },
				{ href: '/admin/players', label: 'Players', icon: UsersIcon },
				{ href: '/admin/tournaments', label: 'Tournaments', icon: TrophyIcon },
				{ href: '/admin/game-resources', label: 'Game Resources', icon: Image }
			]
		},
		{
			label: 'Broadcast',
			items: [
				{ href: '/admin/graphics', label: 'Graphics', icon: MonitorPlayIcon },
				{ href: '/admin/settings', label: 'Settings', icon: SettingsIcon }
			]
		}
	];

	const currentPath = $derived(page.url.pathname);

	/**
	 * @param {string} href
	 * @returns {boolean}
	 */
	function isActive(href) {
		if (href === '/admin') return currentPath === '/admin';
		return currentPath.startsWith(href);
	}
</script>

<Navigation
	layout="sidebar"
	class="flex h-full w-56 shrink-0 flex-col border-r border-surface-200-800 preset-filled-surface-50-950"
>
	<Navigation.Content class="flex-1 overflow-y-auto px-3 py-4">
		{#each navGroups as group (group.label)}
			<Navigation.Group>
				<Navigation.Label
					class="mb-1 px-2 text-xs font-semibold tracking-wider text-surface-400-600 uppercase"
				>
					{group.label}
				</Navigation.Label>

				{#each group.items as item (item.href)}
					{@const active = isActive(item.href)}
					<Navigation.TriggerAnchor
						href={item.href}
						class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
							{active ? 'preset-filled-primary-500' : 'text-surface-700-300 hover:preset-tonal-primary'}"
						aria-current={active ? 'page' : undefined}
					>
						<item.icon class="size-4 shrink-0" />
						{item.label}
					</Navigation.TriggerAnchor>
				{/each}
			</Navigation.Group>
		{/each}
	</Navigation.Content>
</Navigation>
