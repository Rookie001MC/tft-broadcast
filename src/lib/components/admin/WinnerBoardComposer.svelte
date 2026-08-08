<script>
	import SaveIcon from '@lucide/svelte/icons/save';
	import { untrack } from 'svelte';
	import WinnerBoardGraphic from '$lib/components/WinnerBoardGraphic.svelte';
	/** @import { WinnerBoardView } from '$lib/winner-board.js' */
	/** @typedef {{ id: string, displayName: string, fullName: string, riotId: string | null, imagePath: string | null }} Player */
	/** @typedef {{ id: string, displayName: string, iconPath: string | null }} CatalogAsset */

	/** @type {{ tournament: { id: string } | null, roster: Player[], activeCatalog: { snapshot: any, champions: CatalogAsset[], augments: CatalogAsset[] }, savedBoard: import('$lib/winner-board.js').WinnerBoardStateView | null, form?: any }} */
	let { tournament, roster, activeCatalog, savedBoard, form = null } = $props();

	/** @param {import('$lib/winner-board.js').WinnerBoardStateView | null} board */
	function formState(board) {
		return {
			title: board?.title ?? 'Match winner',
			winnerPlayerId: board?.winner.id ?? roster[0]?.id ?? '',
			championIds: board?.champions.map((champion) => champion.id) ?? [],
			augmentIds: board?.augments.map((augment) => augment.id) ?? [],
			/** @type {Record<string, string | number>} */
			starLevels: Object.fromEntries(
				(board?.champions ?? []).map((champion) => [champion.id, champion.starLevel ?? ''])
			)
		};
	}

	/** @param {string} name */
	function actionUrl(name) {
		return `?tournament=${encodeURIComponent(tournament?.id ?? '')}&/${name}`;
	}

	let composer = $state(untrack(() => formState(savedBoard)));

	/** @type {WinnerBoardView | null} */
	const previewBoard = $derived.by(() => {
		const winner = roster.find((player) => player.id === composer.winnerPlayerId);
		if (!winner || composer.championIds.length === 0) return null;
		return {
			id: savedBoard?.id ?? 'preview',
			title: composer.title,
			tournamentId: tournament?.id ?? '',
			updatedAt: savedBoard?.updatedAt ?? new Date(),
			winner: {
				id: winner.id,
				displayName: winner.displayName,
				riotId: winner.riotId,
				imagePath: winner.imagePath
			},
			champions: composer.championIds.flatMap((id, displayOrder) => {
				const champion = activeCatalog.champions.find((item) => item.id === id);
				return champion
					? [
							{
								id: champion.id,
								displayName: champion.displayName,
								iconPath: champion.iconPath,
								starLevel: Number(composer.starLevels[id]) || null,
								displayOrder
							}
						]
					: [];
			}),
			augments: composer.augmentIds.flatMap((id, displayOrder) => {
				const augment = activeCatalog.augments.find((item) => item.id === id);
				return augment
					? [
							{
								id: augment.id,
								displayName: augment.displayName,
								iconPath: augment.iconPath,
								displayOrder
							}
						]
					: [];
			})
		};
	});

	/** @param {string} id @param {boolean} checked */
	function toggleChampion(id, checked) {
		composer.championIds = checked
			? [...composer.championIds, id]
			: composer.championIds.filter((value) => value !== id);
		if (!checked) {
			composer.starLevels = Object.fromEntries(
				Object.entries(composer.starLevels).filter(([championId]) => championId !== id)
			);
		}
	}

	/** @param {string} id @param {boolean} checked */
	function toggleAugment(id, checked) {
		composer.augmentIds = checked
			? [...composer.augmentIds, id]
			: composer.augmentIds.filter((value) => value !== id);
	}
</script>

<section id="composer" class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
	<header class="mb-5 flex flex-wrap items-start justify-between gap-3">
		<div>
			<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">
				Saved board workspace
			</p>
			<h2 class="h3">Winner board composer</h2>
			<p class="mt-1 text-sm text-surface-600-400">
				Saving replaces the one editable board. Take it live separately after review.
			</p>
		</div>
		<span class="badge preset-tonal-surface">{savedBoard ? 'Saved board' : 'Not saved'}</span>
	</header>

	<div class="grid gap-6 2xl:grid-cols-[minmax(380px,0.75fr)_minmax(0,1.25fr)]">
		<form method="POST" action={actionUrl('saveBoard')} class="space-y-5">
			<input type="hidden" name="tournamentId" value={tournament?.id ?? ''} />

			<div class="grid gap-3 sm:grid-cols-2">
				<label class="label"
					><span class="label-text">Graphic title</span><input
						class="input"
						name="title"
						bind:value={composer.title}
						required
						maxlength="100"
					/></label
				>
				<label class="label"
					><span class="label-text">Winner</span><select
						class="select"
						name="winnerPlayerId"
						bind:value={composer.winnerPlayerId}
						required
						disabled={!roster.length}
					>
						<option value="">Select a roster player</option>
						{#each roster as player (player.id)}<option value={player.id}
								>{player.displayName}</option
							>{/each}
					</select></label
				>
			</div>

			<fieldset class="fieldset space-y-3" disabled={!activeCatalog.snapshot}>
				<legend class="legend">Champions <span class="text-error-500">(at least one)</span></legend>
				<div class="grid max-h-80 grid-cols-1 gap-2 overflow-auto pr-1 sm:grid-cols-2">
					{#each activeCatalog.champions as champion (champion.id)}
						{@const selected = composer.championIds.includes(champion.id)}
						<div
							class:selected-card={selected}
							class="grid grid-cols-[auto_1fr_82px] items-center gap-2 rounded-base border border-surface-200-800 p-2"
						>
							<input
								class="checkbox"
								type="checkbox"
								name="championIds"
								value={champion.id}
								checked={selected}
								onchange={(event) => toggleChampion(champion.id, event.currentTarget.checked)}
								aria-label={`Select ${champion.displayName}`}
							/>
							<span class="truncate text-sm font-medium" title={champion.displayName}
								>{champion.displayName}</span
							>
							<select
								class="select-sm select"
								name={`starLevel:${champion.id}`}
								value={composer.starLevels[champion.id] ?? ''}
								onchange={(event) => (composer.starLevels[champion.id] = event.currentTarget.value)}
								disabled={!selected}
								aria-label={`${champion.displayName} star level`}
							>
								<option value="">Stars</option>
								<option value="1">1 ★</option><option value="2">2 ★</option><option value="3"
									>3 ★</option
								>
							</select>
						</div>
					{:else}<p class="text-sm text-surface-500">
							Sync a catalog to load champion choices.
						</p>{/each}
				</div>
			</fieldset>

			<fieldset class="fieldset space-y-3" disabled={!activeCatalog.snapshot}>
				<legend class="legend">Augments <span class="text-surface-500">(optional)</span></legend>
				<div class="grid max-h-52 grid-cols-1 gap-1 overflow-auto pr-1 sm:grid-cols-2">
					{#each activeCatalog.augments as augment (augment.id)}
						<label
							class="flex cursor-pointer items-center gap-2 rounded-base p-2 hover:preset-tonal-primary"
						>
							<input
								class="checkbox"
								type="checkbox"
								name="augmentIds"
								value={augment.id}
								checked={composer.augmentIds.includes(augment.id)}
								onchange={(event) => toggleAugment(augment.id, event.currentTarget.checked)}
							/>
							<span class="truncate text-sm" title={augment.displayName}>{augment.displayName}</span
							>
						</label>
					{:else}<p class="text-sm text-surface-500">
							No augments are available in this snapshot.
						</p>{/each}
				</div>
			</fieldset>

			<button
				class="btn preset-filled-primary-500"
				type="submit"
				disabled={!tournament ||
					!roster.length ||
					!activeCatalog.snapshot ||
					!composer.championIds.length}
			>
				<SaveIcon class="size-4" />
				Save board
			</button>
		</form>

		<div>
			<div class="mb-2 flex items-center justify-between">
				<h3 class="h4">Exact 16:9 preview</h3>
				<span class="text-xs text-surface-500">Same 1920×1080 renderer as /gfx</span>
			</div>
			<div
				class="preview-viewport flex min-h-72 items-center justify-center overflow-auto rounded-container border border-surface-200-800 bg-surface-950 p-3"
			>
				<WinnerBoardGraphic board={previewBoard} scale={0.42} />
			</div>
			{#if !previewBoard}<p class="mt-2 text-sm text-surface-500">
					Choose a winner and at least one champion to render the preview.
				</p>{/if}
		</div>
	</div>

	{#if form?.action === 'saveBoard' && form.message}
		<p class="mt-4 rounded-base preset-tonal-error p-3 text-sm">{form.message}</p>
	{/if}
</section>

<style>
	.selected-card {
		border-color: var(--color-primary-500);
		background: color-mix(in oklab, var(--color-primary-500) 12%, transparent);
	}
</style>
