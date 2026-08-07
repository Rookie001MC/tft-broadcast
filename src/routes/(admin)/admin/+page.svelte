<script>
	import { resolve } from '$app/paths';
	import { getPageMetaContext } from '$lib/context/pageMetaContext.js';
	import TournamentControls from '$lib/components/admin/TournamentControls.svelte';
	import PlayerImportPanel from '$lib/components/admin/PlayerImportPanel.svelte';
	import RosterManager from '$lib/components/admin/RosterManager.svelte';
	import WinnerBoardComposer from '$lib/components/admin/WinnerBoardComposer.svelte';
	import LiveControls from '$lib/components/admin/LiveControls.svelte';

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
	pageMeta.title = 'Dashboard';
	pageMeta.description =
		'VNUHCM - University of Science Esports Club - Teamfight Tactics Winner Broadcast Graphics Control';
</script>

<div class="mx-auto max-w-[1700px] space-y-6 pb-16">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<p class="text-sm font-semibold text-primary-600-400">Production control</p>
			<h1 class="h1">Dashboard</h1>
			<p class="mt-2 max-w-3xl text-surface-600-400">
				Build from a pinned tournament roster and catalog, review the exact output, then
				deliberately publish it to the broadcast route.
			</p>
		</div>
		<a class="btn preset-tonal-tertiary" href={resolve('/gfx')} target="_blank" rel="noreferrer"
			>Open broadcast canvas</a
		>
	</div>

	{#if form?.message && !['saveBoard', 'publishBoard', 'hideBoard', 'createPlayer', 'addRosterPlayers', 'removeRosterPlayer', 'moveRosterPlayer'].includes(form.action)}
		<div class="rounded-container preset-tonal-error p-4" role="alert">{form.message}</div>
	{/if}

	<TournamentControls
		tournaments={data.tournaments}
		selectedTournament={data.selectedTournament}
		activeCatalog={data.activeCatalog}
		{form}
	/>
	<PlayerImportPanel {form} importPreview={data.importPreview} />
	<RosterManager
		tournament={data.selectedTournament}
		players={data.players}
		roster={data.roster}
		{form}
	/>
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
</div>
