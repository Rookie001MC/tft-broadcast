<script>
	import { resolve } from '$app/paths';
	import { getPageMetaContext } from '$lib/context/pageMetaContext.js';
	import LiveControls from '$lib/components/admin/LiveControls.svelte';
	import TournamentSelector from '$lib/components/admin/TournamentSelector.svelte';
	import WinnerBoardComposer from '$lib/components/admin/WinnerBoardComposer.svelte';

	let { data, form = null } = $props();
	let selectedBoardOverride = $state('');
	let selectedBoardId = $derived(
		form?.action === 'saveBoard'
			? (form.board?.id ?? '')
			: data.drafts.some((draft) => draft.id === selectedBoardOverride)
				? selectedBoardOverride
				: ''
	);

	const pageMeta = getPageMetaContext();
	pageMeta.title = 'Graphics';
	pageMeta.description = 'Compose, preview, publish, and hide tournament winner graphics.';
</script>

<div class="mx-auto max-w-[1700px] space-y-6 pb-16">
	<header class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<p class="text-sm font-semibold text-primary-600-400">Broadcast output</p>
			<h1 class="h1">Graphics</h1>
			<p class="mt-2 max-w-3xl text-surface-600-400">
				Build from the pinned roster and catalog, inspect the exact output, then deliberately
				publish it.
			</p>
		</div>
		<a class="btn preset-tonal-tertiary" href={resolve('/gfx')} target="_blank" rel="noreferrer"
			>Open broadcast canvas</a
		>
	</header>
	<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
		<TournamentSelector
			tournaments={data.tournaments}
			selectedTournament={data.selectedTournament}
			action={resolve('/admin/graphics')}
		/>
	</section>
	{#if data.selectedTournament}
		<WinnerBoardComposer
			tournament={data.selectedTournament}
			roster={data.roster}
			activeCatalog={data.activeCatalog}
			drafts={data.drafts}
			{form}
			{selectedBoardId}
			onBoardSelect={(id) => (selectedBoardOverride = id)}
		/>
		<LiveControls {selectedBoardId} liveBoard={data.liveBoard} {form} />
	{:else}<div class="rounded-container preset-tonal-warning p-5">
			Create or select a tournament before composing graphics.
		</div>{/if}
</div>
