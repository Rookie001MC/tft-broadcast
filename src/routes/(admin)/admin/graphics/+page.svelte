<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { getPageMetaContext } from '$lib/context/pageMetaContext.js';
	import ResetRequiredDialog from '$lib/components/admin/ResetRequiredDialog.svelte';
	import WinnerBoardComposer from '$lib/components/admin/WinnerBoardComposer.svelte';

	let { data, form = null } = $props();

	const pageMeta = getPageMetaContext();
	pageMeta.title = 'Graphics';
	pageMeta.description = 'Compose, preview, and control the saved tournament winner graphic.';

	let selectedTournamentId = $state(untrack(() => data.selectedTournament?.id ?? ''));
	let pendingTournamentId = $state('');
	let tournamentResetOpen = $state(false);
	/** @type {HTMLSelectElement | null} */
	let tournamentSelect = $state(null);

	/** @param {string | null} nextTournamentId @returns {import('svelte/attachments').Attachment<HTMLElement>} */
	function navigateAfterReset(nextTournamentId) {
		return () => {
			if (!nextTournamentId) return;
			goto(
				resolve(
					/** @type {any} */ (`/admin/graphics?tournament=${encodeURIComponent(nextTournamentId)}`)
				),
				{
					replaceState: true,
					invalidateAll: true
				}
			);
		};
	}

	/** @param {Event & { currentTarget: HTMLSelectElement }} event */
	function changeTournament(event) {
		const nextTournamentId = event.currentTarget.value;
		if (!nextTournamentId || nextTournamentId === data.selectedTournament?.id) return;
		if (data.savedBoard) {
			pendingTournamentId = nextTournamentId;
			selectedTournamentId = data.selectedTournament?.id ?? '';
			tournamentSelect = event.currentTarget;
			tournamentResetOpen = true;
			return;
		}
		goto(
			resolve(
				/** @type {any} */ (`/admin/graphics?tournament=${encodeURIComponent(nextTournamentId)}`)
			)
		);
	}

	/** @param {SubmitEvent} event */
	function submitTournamentSelection(event) {
		if (data.savedBoard) event.preventDefault();
	}
</script>

<div
	class="mx-auto max-w-[1700px] space-y-6 pb-16"
	{@attach navigateAfterReset(
		form?.action === 'resetBoard' ? (form.nextTournamentId ?? null) : null
	)}
>
	<header>
		<div>
			<p class="text-sm font-semibold text-primary-600-400">Broadcast output</p>
			<h1 class="h1">Graphics</h1>
			<p class="mt-2 max-w-3xl text-surface-600-400">
				Build from the pinned roster and catalog, inspect the exact output, then deliberately
				publish it.
			</p>
		</div>
	</header>
	<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
		<form
			method={data.savedBoard ? 'POST' : 'GET'}
			action={data.savedBoard ? '?/resetAndSelectTournament' : resolve('/admin/graphics')}
			onsubmit={submitTournamentSelection}
			class="flex flex-wrap items-end gap-3"
		>
			<label class="label min-w-64 flex-1">
				<span class="label-text">Tournament scope</span>
				<select
					class="select"
					name={data.savedBoard ? 'nextTournamentId' : 'tournament'}
					bind:value={selectedTournamentId}
					onchange={changeTournament}
				>
					<option value=""
						>{data.tournaments.length ? 'Select a tournament' : 'No tournaments yet'}</option
					>
					{#each data.tournaments as tournament (tournament.id)}<option value={tournament.id}
							>{tournament.name}</option
						>{/each}
				</select>
			</label>
			<button class="btn preset-tonal-primary" type="submit" disabled={!data.tournaments.length}
				>{data.savedBoard ? 'Reset and load' : 'Load'}</button
			>
		</form>
	</section>
	{#if form?.action === 'resetAndSelectTournament' && form.message}<p
			class="rounded-container preset-tonal-error p-4"
			role="alert"
		>
			{form.message}
		</p>{/if}
	{#if data.selectedTournament}
		{#key `${data.selectedTournament.id}:${data.savedBoard?.updatedAt ?? 'empty'}`}
			<WinnerBoardComposer
				tournament={data.selectedTournament}
				roster={data.roster}
				activeCatalog={data.activeCatalog}
				savedBoard={data.savedBoard}
				tftMatchApi={data.tftMatchApi}
				livePublicationId={data.livePublicationId}
				{form}
			/>
		{/key}
	{:else}<div class="rounded-container preset-tonal-warning p-5">
			Create or select a tournament before composing graphics.
		</div>{/if}
</div>

<ResetRequiredDialog
	open={tournamentResetOpen}
	title="Reset before changing tournament?"
	description="The saved winner board belongs to this tournament. Reset it before loading another tournament scope."
	confirmAction={`?tournament=${encodeURIComponent(data.selectedTournament?.id ?? '')}&/resetBoard`}
	hiddenInputs={{ nextTournamentId: pendingTournamentId }}
	invokingControl={tournamentSelect}
	onclose={() => {
		tournamentResetOpen = false;
		pendingTournamentId = '';
		selectedTournamentId = data.selectedTournament?.id ?? '';
	}}
/>
