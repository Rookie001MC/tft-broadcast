<script>
	import { resolve } from '$app/paths';
	import { getPageMetaContext } from '$lib/context/pageMetaContext.js';
	import CatalogManager from '$lib/components/admin/CatalogManager.svelte';
	import TournamentSelector from '$lib/components/admin/TournamentSelector.svelte';

	let { data, form = null } = $props();

	const pageMeta = getPageMetaContext();
	pageMeta.title = 'Game Resources';
	pageMeta.description = 'Synchronize and inspect tournament-pinned TFT catalog resources.';
</script>

<div class="mx-auto max-w-[1700px] space-y-6 pb-16">
	<header>
		<p class="text-sm font-semibold text-primary-600-400">Catalog management</p>
		<h1 class="h1">Game Resources</h1>
		<p class="mt-2 max-w-3xl text-surface-600-400">
			Pin the champion and augment data used by a tournament's broadcast graphics.
		</p>
	</header>
	<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
		<TournamentSelector
			tournaments={data.tournaments}
			selectedTournament={data.selectedTournament}
			action={resolve('/admin/game-resources')}
		/>
	</section>
	{#if data.selectedTournament}<CatalogManager
			tournament={data.selectedTournament}
			activeCatalog={data.activeCatalog}
			{form}
		/>{:else}<div class="rounded-container preset-tonal-warning p-5">
			Create or select a tournament before syncing game resources.
		</div>{/if}
</div>
