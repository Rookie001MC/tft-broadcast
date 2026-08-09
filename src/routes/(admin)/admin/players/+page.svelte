<script>
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import PlayerImportPanel from '$lib/components/admin/PlayerImportPanel.svelte';
	import ResetRequiredDialog from '$lib/components/admin/ResetRequiredDialog.svelte';
	import { getPageMetaContext } from '$lib/context/pageMetaContext.js';

	let { data, form = null } = $props();
	const pageMeta = getPageMetaContext();
	pageMeta.title = 'Players';
	pageMeta.description = 'Create, import, and maintain reusable tournament players.';

	/** @type {string | null} */
	let submittingAction = $state(null);
	/** @type {any} */
	let pendingPlayer = $state(null);
	/** @type {HTMLButtonElement | null} */
	let deleteInvoker = $state(null);
	let deleteOpen = $state(false);
	let resetRequired = $state(false);
	let handledResetResultKey = '';

	const resetResultKey = $derived(
		`${form?.action ?? ''}:${form?.result?.kind ?? ''}:${form?.playerId ?? ''}`
	);
	const deletionCompleted = $derived(
		['deletePlayer', 'confirmDeletePlayer'].includes(form?.action ?? '') &&
			form?.result?.deleted === true
	);

	/** @param {string} resultKey @returns {import('svelte/attachments').Attachment<HTMLElement>} */
	function showResetResult(resultKey) {
		return () => {
			if (
				form?.action === 'deletePlayer' &&
				form.result?.kind === 'reset_required' &&
				resultKey !== handledResetResultKey
			) {
				if (typeof form.playerId === 'string' && form.playerId) {
					pendingPlayer = {
						id: form.playerId,
						displayName: typeof form.result.label === 'string' ? form.result.label : 'this player'
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

	/** @param {any} player @param {MouseEvent & { currentTarget: HTMLButtonElement }} event */
	function requestDelete(player, event) {
		pendingPlayer = player;
		deleteInvoker = event.currentTarget;
		resetRequired = false;
		deleteOpen = true;
	}

	/** @type {import('@sveltejs/kit').SubmitFunction} */
	const submitDelete = () => {
		submittingAction = resetRequired ? 'confirmDeletePlayer' : 'deletePlayer';
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
		<p class="text-sm font-semibold text-primary-600-400">Reusable records</p>
		<h1 class="h1">Players</h1>
		<p class="mt-2 max-w-3xl text-surface-600-400">
			Maintain each broadcast identity, its Riot identity, and controlled player image.
		</p>
	</header>

	{#if form?.message}<div class="rounded-container preset-tonal-error p-4" role="alert">
			{form.message}
		</div>
	{:else if form?.action && !['previewBundle', 'commitBundle'].includes(form.action) && (!['deletePlayer', 'confirmDeletePlayer'].includes(form.action) || deletionCompleted)}<div
			class="rounded-container preset-tonal-success p-4"
			role="status"
		>
			{form.action === 'createPlayer'
				? 'Player created.'
				: form.action === 'updatePlayer'
					? 'Player details saved.'
					: form.action === 'replacePlayerImage'
						? 'Player image replaced.'
						: form.action === 'removePlayerImage'
							? 'Player image removed.'
							: form.action.includes('Delete') || form.action === 'deletePlayer'
								? 'Player deleted.'
								: 'Player action completed.'}
		</div>{/if}

	<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
		<header class="mb-5">
			<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">Single record</p>
			<h2 class="h3">Create player</h2>
		</header>
		<form
			method="POST"
			action="?/createPlayer"
			use:enhance={trackSubmission('createPlayer')}
			class="grid items-end gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]"
		>
			<label class="label"
				><span class="label-text">Full name</span><input
					class="input"
					name="fullName"
					required
					disabled={Boolean(submittingAction)}
				/></label
			>
			<label class="label"
				><span class="label-text">Display name</span><input
					class="input"
					name="displayName"
					required
					disabled={Boolean(submittingAction)}
				/></label
			>
			<label class="label"
				><span class="label-text">Riot ID <span class="text-surface-500">(optional)</span></span
				><input
					class="input"
					name="riotId"
					placeholder="GameName#TAG"
					disabled={Boolean(submittingAction)}
				/></label
			>
			<button
				class="btn preset-filled-primary-500"
				type="submit"
				disabled={Boolean(submittingAction)}
				><UserPlusIcon class="size-4" />
				{submittingAction === 'createPlayer' ? 'Creating…' : 'Create player'}</button
			>
		</form>
	</section>

	<PlayerImportPanel {form} importPreview={data.importPreview} />

	<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
		<header class="mb-5 flex items-start justify-between gap-3">
			<div>
				<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">
					Player directory
				</p>
				<h2 class="h3">All players</h2>
			</div>
			<span class="badge preset-tonal-surface">{data.players.length} players</span>
		</header>
		<div class="grid gap-4 xl:grid-cols-2">
			{#each data.players as player (player.id)}
				<article class="rounded-container border border-surface-200-800 bg-surface-100-900 p-4">
					<header class="mb-4 flex items-center justify-between gap-3">
						<div>
							<h3 class="h4">{player.displayName}</h3>
							<p class="text-xs text-surface-500">
								Updated {new Date(player.updatedAt).toLocaleString()}
							</p>
						</div>
						<span class="badge preset-tonal-surface"
							>{player.imagePath ? 'Managed image' : 'No image'}</span
						>
					</header>
					<form
						method="POST"
						action="?/updatePlayer"
						use:enhance={trackSubmission(`updatePlayer:${player.id}`)}
						class="grid gap-3 sm:grid-cols-2"
					>
						<input type="hidden" name="playerId" value={player.id} />
						<label class="label"
							><span class="label-text">Full name</span><input
								class="input"
								name="fullName"
								value={player.fullName}
								required
								disabled={Boolean(submittingAction)}
							/></label
						>
						<label class="label"
							><span class="label-text">Display name</span><input
								class="input"
								name="displayName"
								value={player.displayName}
								required
								disabled={Boolean(submittingAction)}
							/></label
						>
						<label class="label"
							><span class="label-text">Riot ID</span><input
								class="input"
								name="riotId"
								value={player.riotId ?? ''}
								placeholder="GameName#TAG"
								disabled={Boolean(submittingAction)}
							/></label
						>
						<label class="label"
							><span class="label-text">Riot game name</span><input
								class="input"
								name="riotGameName"
								value={player.riotGameName ?? ''}
								disabled={Boolean(submittingAction)}
							/></label
						>
						<label class="label"
							><span class="label-text">Riot tagline</span><input
								class="input"
								name="riotTagline"
								value={player.riotTagline ?? ''}
								disabled={Boolean(submittingAction)}
							/></label
						>
						<div class="flex items-end">
							<button
								class="btn preset-tonal-primary"
								type="submit"
								disabled={Boolean(submittingAction)}
								>{submittingAction === `updatePlayer:${player.id}`
									? 'Saving…'
									: 'Save identity'}</button
							>
						</div>
					</form>

					<div
						class="mt-4 grid gap-3 border-t border-surface-200-800 pt-4 sm:grid-cols-[1fr_auto_auto]"
					>
						<form
							method="POST"
							action="?/replacePlayerImage"
							enctype="multipart/form-data"
							use:enhance={trackSubmission(`replacePlayerImage:${player.id}`)}
							class="flex flex-wrap items-end gap-2"
						>
							<input type="hidden" name="playerId" value={player.id} />
							<label class="label min-w-48 flex-1"
								><span class="label-text">Replace image</span><input
									class="input"
									type="file"
									name="image"
									accept="image/png,image/jpeg,image/webp"
									required
									disabled={Boolean(submittingAction)}
								/></label
							>
							<button
								class="btn preset-tonal-primary btn-sm"
								type="submit"
								disabled={Boolean(submittingAction)}>Upload</button
							>
						</form>
						<form
							method="POST"
							action="?/removePlayerImage"
							use:enhance={trackSubmission(`removePlayerImage:${player.id}`)}
							class="flex items-end"
						>
							<input type="hidden" name="playerId" value={player.id} /><button
								class="btn preset-tonal-surface btn-sm"
								type="submit"
								disabled={!player.imagePath || Boolean(submittingAction)}>Remove image</button
							>
						</form>
						<button
							class="btn self-end preset-tonal-error btn-sm"
							type="button"
							aria-label={`Delete ${player.displayName}`}
							disabled={Boolean(submittingAction)}
							onclick={(event) => requestDelete(player, event)}>Delete</button
						>
					</div>
				</article>
			{:else}<p
					class="rounded-container preset-tonal-surface p-8 text-center text-surface-500 xl:col-span-2"
				>
					No players have been created yet.
				</p>{/each}
		</div>
	</section>
</div>

<ResetRequiredDialog
	open={deleteOpen}
	title={resetRequired
		? 'Reset saved board and delete player?'
		: `Delete ${pendingPlayer?.displayName ?? 'player'}?`}
	description={resetRequired
		? `The saved winner board uses ${pendingPlayer?.displayName ?? 'this player'}. Reset the saved board, then delete the player permanently.`
		: 'This deletes the player permanently from every tournament roster. This action cannot be undone.'}
	confirmAction={resetRequired ? '?/confirmDeletePlayer' : '?/deletePlayer'}
	hiddenInputs={{ playerId: pendingPlayer?.id ?? '' }}
	invokingControl={deleteInvoker}
	confirmLabel={resetRequired ? 'Confirm reset and delete' : 'Delete permanently'}
	enhanceSubmit={submitDelete}
	onclose={() => (deleteOpen = false)}
/>
