<script>
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { tick } from 'svelte';
	import ResetRequiredDialog from '$lib/components/admin/ResetRequiredDialog.svelte';
	import RosterManager from '$lib/components/admin/RosterManager.svelte';
	import { getPageMetaContext } from '$lib/context/pageMetaContext.js';

	let { data, form = null } = $props();
	const pageMeta = getPageMetaContext();
	pageMeta.title = 'Tournaments';
	pageMeta.description = 'Create tournaments and maintain their identity and ordered rosters.';

	/** @type {string | null} */
	let submittingAction = $state(null);
	/** @type {any} */
	let pendingTournament = $state(null);
	/** @type {HTMLButtonElement | null} */
	let deleteInvoker = $state(null);
	let deleteOpen = $state(false);
	let resetRequired = $state(false);
	let handledResetResultKey = '';

	const resetResultKey = $derived(
		`${form?.action ?? ''}:${form?.result?.kind ?? ''}:${form?.tournamentId ?? ''}`
	);
	const deletionCompleted = $derived(
		['deleteTournament', 'confirmDeleteTournament'].includes(form?.action ?? '') &&
			form?.result?.deleted === true
	);

	/** @param {string} resultKey @returns {import('svelte/attachments').Attachment<HTMLElement>} */
	function showResetResult(resultKey) {
		return () => {
			if (
				form?.action === 'deleteTournament' &&
				form.result?.kind === 'reset_required' &&
				resultKey !== handledResetResultKey
			) {
				if (typeof form.tournamentId === 'string' && form.tournamentId) {
					pendingTournament = {
						id: form.tournamentId,
						name: typeof form.result.label === 'string' ? form.result.label : 'this tournament'
					};
					resetRequired = true;
					deleteOpen = true;
				}
				handledResetResultKey = resultKey;
			}
		};
	}

	/** @param {string} action @returns {import('@sveltejs/kit').SubmitFunction} */
	function trackSubmission(action) {
		return () => {
			submittingAction = action;
			return async ({ update }) => {
				await update({ reset: false });
				submittingAction = null;
			};
		};
	}

	/** @param {any} tournament @param {MouseEvent & { currentTarget: HTMLButtonElement }} event */
	function requestDelete(tournament, event) {
		pendingTournament = tournament;
		deleteInvoker = event.currentTarget;
		resetRequired = false;
		deleteOpen = true;
	}

	/** @type {import('@sveltejs/kit').SubmitFunction} */
	const submitDelete = () => {
		submittingAction = resetRequired ? 'confirmDeleteTournament' : 'deleteTournament';
		return async ({ result, update }) => {
			deleteOpen = false;
			await tick();
			await update({ reset: false });
			submittingAction = null;
			if (result.type === 'success' && result.data?.result?.kind === 'reset_required') {
				resetRequired = true;
				deleteOpen = true;
			}
		};
	};
</script>

<div class="mx-auto max-w-[1500px] space-y-6 pb-16" {@attach showResetResult(resetResultKey)}>
	<header>
		<p class="text-sm font-semibold text-primary-600-400">Event management</p>
		<h1 class="h1">Tournaments</h1>
		<p class="mt-2 max-w-3xl text-surface-600-400">
			Maintain event identity and each tournament's ordered player roster.
		</p>
	</header>

	{#if form?.message}<div class="rounded-container preset-tonal-error p-4" role="alert">
			{form.message}
		</div>
	{:else if form && (form.action === 'updateTournament' || (['deleteTournament', 'confirmDeleteTournament'].includes(form.action ?? '') && deletionCompleted))}<div
			class="rounded-container preset-tonal-success p-4"
			role="status"
		>
			{form.action === 'updateTournament' ? 'Tournament details saved.' : 'Tournament deleted.'}
		</div>{/if}

	<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
		<header class="mb-5">
			<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">New event</p>
			<h2 class="h3">Create tournament</h2>
		</header>
		<form
			method="POST"
			action="?/createTournament"
			class="flex max-w-2xl items-end gap-3"
			use:enhance={trackSubmission('createTournament')}
		>
			<label class="label min-w-0 flex-1"
				><span class="label-text">Tournament name</span><input
					class="input"
					name="name"
					required
					maxlength="100"
					placeholder="HCMUSEC TFT Finals"
					disabled={Boolean(submittingAction)}
				/></label
			>
			<button
				class="btn preset-filled-primary-500"
				type="submit"
				disabled={Boolean(submittingAction)}
				><PlusIcon class="size-4" />
				{submittingAction === 'createTournament' ? 'Creating…' : 'Create'}</button
			>
		</form>
	</section>

	<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
		<header class="mb-5 flex items-start justify-between gap-3">
			<div>
				<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">
					Event directory
				</p>
				<h2 class="h3">All tournaments</h2>
			</div>
			<span class="badge preset-tonal-surface">{data.tournaments.length} tournaments</span>
		</header>
		<div class="space-y-4">
			{#each data.tournaments as tournament (tournament.id)}
				<article
					class:preset-tonal-primary={tournament.id === data.selectedTournament?.id}
					class="rounded-container border border-surface-200-800 p-4"
				>
					<header class="mb-3 flex flex-wrap items-center justify-between gap-3">
						<div>
							<h3 class="h4">{tournament.name}</h3>
							<p class="text-xs text-surface-500">
								Updated {new Date(tournament.updatedAt).toLocaleString()}
							</p>
						</div>
						<div class="flex gap-2">
							<span class="badge preset-tonal-surface"
								>{tournament.activeCatalogSnapshotId
									? 'Catalog pinned'
									: 'Catalog not synced'}</span
							><a
								class="btn preset-tonal-primary btn-sm"
								href={resolve(
									/** @type {any} */ (
										`/admin/tournaments?tournament=${encodeURIComponent(tournament.id)}`
									)
								)}>Manage roster</a
							>
						</div>
					</header>
					<form
						method="POST"
						action="?/updateTournament"
						use:enhance={trackSubmission(`updateTournament:${tournament.id}`)}
						class="grid items-end gap-3 md:grid-cols-[1fr_1fr_auto_auto]"
					>
						<input type="hidden" name="tournamentId" value={tournament.id} />
						<label class="label"
							><span class="label-text">Tournament name</span><input
								class="input"
								name="name"
								value={tournament.name}
								required
								maxlength="100"
								disabled={Boolean(submittingAction)}
							/></label
						>
						<label class="label"
							><span class="label-text">Slug</span><input
								class="input"
								name="slug"
								value={tournament.slug}
								required
								pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
								disabled={Boolean(submittingAction)}
							/></label
						>
						<button
							class="btn preset-tonal-primary"
							type="submit"
							disabled={Boolean(submittingAction)}
							>{submittingAction === `updateTournament:${tournament.id}`
								? 'Saving…'
								: 'Save details'}</button
						>
						<button
							class="btn preset-tonal-error"
							type="button"
							aria-label={`Delete ${tournament.name}`}
							disabled={Boolean(submittingAction)}
							onclick={(event) => requestDelete(tournament, event)}>Delete</button
						>
					</form>
				</article>
			{:else}<p class="rounded-container preset-tonal-surface p-8 text-center text-surface-500">
					No tournaments have been created yet.
				</p>{/each}
		</div>
	</section>

	{#if data.selectedTournament}<RosterManager
			tournament={data.selectedTournament}
			players={data.players}
			roster={data.roster}
			{form}
		/>{/if}
</div>

<ResetRequiredDialog
	open={deleteOpen}
	title={resetRequired
		? 'Reset saved board and delete tournament?'
		: `Delete ${pendingTournament?.name ?? 'tournament'}?`}
	description={resetRequired
		? `The saved winner board belongs to ${pendingTournament?.name ?? 'this tournament'}. Reset it, then delete the tournament permanently.`
		: 'This deletes the tournament and its roster permanently. Reusable player records remain available.'}
	confirmAction={resetRequired ? '?/confirmDeleteTournament' : '?/deleteTournament'}
	hiddenInputs={{ tournamentId: pendingTournament?.id ?? '' }}
	invokingControl={deleteInvoker}
	confirmLabel={resetRequired ? 'Confirm reset and delete' : 'Delete permanently'}
	enhanceSubmit={submitDelete}
	onclose={() => (deleteOpen = false)}
/>
