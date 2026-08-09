<script>
	import { resolve } from '$app/paths';
	import { getPageMetaContext } from '$lib/context/pageMetaContext.js';
	import TrophyIcon from '@lucide/svelte/icons/trophy';
	import UsersIcon from '@lucide/svelte/icons/users';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import MonitorPlayIcon from '@lucide/svelte/icons/monitor-play';

	let { data } = $props();

	const pageMeta = getPageMetaContext();
	pageMeta.title = 'Dashboard';
	pageMeta.description = 'Overview of tournament, player, catalog, and broadcast readiness.';

	const selectedQuery = $derived(
		data.selectedTournament ? `?tournament=${encodeURIComponent(data.selectedTournament.id)}` : ''
	);
	const cards = $derived([
		{
			title: 'Tournaments',
			value: data.tournaments.length,
			detail: data.selectedTournament?.name ?? 'Create the first tournament',
			route: '/admin/tournaments',
			query: selectedQuery,
			icon: TrophyIcon
		},
		{
			title: 'Reusable players',
			value: data.players.length,
			detail: data.selectedTournament
				? `${data.roster.length} on the selected roster`
				: 'No roster selected',
			route: '/admin/players',
			query: '',
			icon: UsersIcon
		},
		{
			title: 'Game resources',
			value: data.activeCatalog.champions.length + data.activeCatalog.augments.length,
			detail: data.activeCatalog.snapshot
				? `${data.activeCatalog.snapshot.patchLabel} · ${data.activeCatalog.snapshot.locale}`
				: 'Catalog sync required',
			route: '/admin/game-resources',
			query: selectedQuery,
			icon: DatabaseIcon
		},
		{
			title: 'Broadcast',
			value: data.liveBoard ? 'Live' : 'Hidden',
			detail: data.liveBoard?.winner.displayName ?? 'Compose and publish from Graphics',
			route: '/admin/graphics',
			query: selectedQuery,
			icon: MonitorPlayIcon
		}
	]);
</script>

<div class="mx-auto max-w-7xl space-y-8 pb-16">
	<header>
		<p class="text-sm font-semibold text-primary-600-400">Production control</p>
		<h1 class="h1">Dashboard</h1>
		<p class="mt-2 max-w-3xl text-surface-600-400">
			A quick readiness overview. Detailed management now lives in the dedicated admin sections.
		</p>
	</header>

	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		{#each cards as card (card.title)}
			<a
				href={resolve(/** @type {any} */ (`${card.route}${card.query}`))}
				class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5 no-underline transition hover:-translate-y-0.5 hover:shadow-lg"
			>
				<div class="flex items-start justify-between gap-4">
					<div>
						<p class="text-sm font-medium text-surface-600-400">{card.title}</p>
						<p class="mt-2 text-3xl font-bold">{card.value}</p>
					</div>
					<span class="rounded-base preset-tonal-primary p-2"><card.icon class="size-5" /></span>
				</div>
				<p class="mt-4 truncate text-sm text-surface-500" title={card.detail}>{card.detail}</p>
			</a>
		{/each}
	</div>

	<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-6">
		<h2 class="h3">Production flow</h2>
		<ol class="mt-4 grid gap-3 md:grid-cols-4">
			{#each ['Create a tournament', 'Build its player roster', 'Pin a game catalog', 'Compose and publish graphics'] as step, index (step)}
				<li class="flex gap-3 rounded-container bg-surface-100-900 p-4">
					<span
						class="flex size-7 shrink-0 items-center justify-center rounded-full preset-filled-primary-500 text-sm font-bold"
						>{index + 1}</span
					>
					<span class="font-medium">{step}</span>
				</li>
			{/each}
		</ol>
	</section>
</div>
