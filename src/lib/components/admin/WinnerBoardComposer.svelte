<script>
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { searchCatalogResources } from '$lib/search/catalog-search.js';
	import { Tabs } from '@skeletonlabs/skeleton-svelte';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SaveIcon from '@lucide/svelte/icons/save';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { untrack } from 'svelte';
	import WinnerBoardGraphic from '$lib/components/WinnerBoardGraphic.svelte';
	import ResetRequiredDialog from './ResetRequiredDialog.svelte';
	/** @import { WinnerBoardView } from '$lib/winner-board.js' */
	/** @typedef {{ id: string, displayName: string, fullName: string, riotId: string | null, imagePath: string | null }} Player */
	/** @typedef {{ id: string, displayName: string, iconPath: string | null }} CatalogAsset */

	/** @type {{ tournament: { id: string } | null, roster: Player[], activeCatalog: { snapshot: any, champions: CatalogAsset[], augments: CatalogAsset[] }, savedBoard: import('$lib/winner-board.js').WinnerBoardStateView | null, livePublicationId?: string | null, form?: any }} */
	let {
		tournament,
		roster,
		activeCatalog,
		savedBoard,
		livePublicationId = null,
		form = null
	} = $props();

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

	/** @param {ReturnType<typeof formState>} value */
	function normalizedForm(value) {
		return {
			title: value.title.trim(),
			winnerPlayerId: value.winnerPlayerId,
			championIds: [...value.championIds],
			augmentIds: [...value.augmentIds],
			starLevels: Object.fromEntries(
				value.championIds.map((id) => [id, String(value.starLevels[id] ?? '')])
			)
		};
	}

	/** @param {import('$lib/winner-board.js').WinnerBoardStateView | null} board */
	function boardKey(board) {
		return board ? `${board.id}:${new Date(board.updatedAt).getTime()}` : 'empty';
	}

	/** @param {string} name */
	function actionUrl(name) {
		return `?tournament=${encodeURIComponent(tournament?.id ?? '')}&/${name}`;
	}

	let composer = $state(untrack(() => formState(savedBoard)));
	let savedForm = $state.raw(untrack(() => normalizedForm(formState(savedBoard))));
	let lastBaselineKey = untrack(() => boardKey(savedBoard));
	/** @type {string | null} */
	let submittingAction = $state(null);
	let resetOpen = $state(false);
	/** @type {'champions' | 'augments'} */
	let activeAssetTab = $state('champions');
	let championQuery = $state('');
	let augmentQuery = $state('');
	/** @type {HTMLButtonElement | null} */
	let resetInvoker = $state(null);
	/** @type {any} */
	let resetDialog;

	const canonicalBoard = $derived(
		form?.action === 'saveBoard' && form.board ? form.board : savedBoard
	);
	const canonicalKey = $derived(boardKey(canonicalBoard));

	/** @param {string} key @returns {import('svelte/attachments').Attachment<HTMLElement>} */
	function synchronizeCanonical(key) {
		return () => {
			if (key !== lastBaselineKey) {
				const next = formState(canonicalBoard);
				composer = next;
				savedForm = normalizedForm(next);
				lastBaselineKey = key;
			}
		};
	}

	const normalizedComposer = $derived(normalizedForm(composer));
	const dirty = $derived(JSON.stringify(normalizedComposer) !== JSON.stringify(savedForm));
	const championCandidates = $derived(
		/** @type {CatalogAsset[]} */ (searchCatalogResources(activeCatalog.champions, championQuery))
	);
	const augmentCandidates = $derived(
		/** @type {CatalogAsset[]} */ (searchCatalogResources(activeCatalog.augments, augmentQuery))
	);
	const selectedChampionIds = $derived(new Set(composer.championIds));
	const selectedAugmentIds = $derived(new Set(composer.augmentIds));
	const selectedChampions = $derived.by(() =>
		composer.championIds.flatMap((id) => {
			const champion = activeCatalog.champions.find((item) => item.id === id);
			return champion ? [champion] : [];
		})
	);
	const selectedAugments = $derived.by(() =>
		composer.augmentIds.flatMap((id) => {
			const augment = activeCatalog.augments.find((item) => item.id === id);
			return augment ? [augment] : [];
		})
	);
	const augmentLimitReached = $derived(composer.augmentIds.length >= 3);
	const invalid = $derived(
		!tournament ||
			!activeCatalog.snapshot ||
			!composer.title.trim() ||
			!roster.some((player) => player.id === composer.winnerPlayerId) ||
			composer.championIds.length === 0
	);
	const isLive = $derived(Boolean(livePublicationId));

	/** @type {WinnerBoardView | null} */
	const previewBoard = $derived.by(() => {
		const winner = roster.find((player) => player.id === composer.winnerPlayerId);
		if (!winner || !composer.title.trim() || composer.championIds.length === 0) return null;
		const champions = composer.championIds.flatMap((id, displayOrder) => {
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
		});
		if (champions.length !== composer.championIds.length) return null;
		const augments = composer.augmentIds.flatMap((id, displayOrder) => {
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
		});
		if (augments.length !== composer.augmentIds.length) return null;
		return {
			id: savedBoard?.id ?? 'preview',
			title: composer.title.trim(),
			tournamentId: tournament?.id ?? '',
			updatedAt: savedBoard?.updatedAt ?? new Date(),
			winner: {
				id: winner.id,
				displayName: winner.displayName,
				riotId: winner.riotId,
				imagePath: winner.imagePath
			},
			champions,
			augments
		};
	});
	const liveDisabled = $derived(
		isLive
			? submittingAction === 'setLive'
			: Boolean(submittingAction) || dirty || !previewBoard || !savedBoard
	);

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

	/** @param {{ value: string }} details */
	function selectAssetType(details) {
		if (details.value === 'champions' || details.value === 'augments')
			activeAssetTab = details.value;
	}

	/** @param {string} id */
	function disabledAugment(id) {
		return augmentLimitReached && !selectedAugmentIds.has(id);
	}

	/** @param {MouseEvent & { currentTarget: HTMLButtonElement }} event */
	function requestReset(event) {
		resetInvoker = event.currentTarget;
		resetOpen = true;
		resetDialog?.showModal();
	}
</script>

<section
	id="composer"
	class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5"
	{@attach synchronizeCanonical(canonicalKey)}
>
	<header class="mb-5 flex flex-wrap items-start justify-between gap-4">
		<div>
			<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">
				Broadcast workspace
			</p>
			<h2 class="h3">Winner board composer</h2>
			<p class="mt-1 text-sm text-surface-600-400">
				Save one canonical board, inspect the exact canvas, then deliberately control publication.
			</p>
		</div>
		<div class="flex flex-wrap items-center justify-end gap-2">
			<span class="badge preset-tonal-surface">{savedBoard ? 'Saved' : 'Unsaved'}</span>
			<span class:badge-success={isLive} class="badge">{isLive ? 'Live' : 'Hidden'}</span>
			<a
				class="btn preset-tonal-surface btn-sm"
				href={resolve('/gfx')}
				target="_blank"
				rel="noreferrer"
			>
				<ExternalLinkIcon class="size-4" /> Open /gfx
			</a>
		</div>
	</header>

	<div class="mb-5 flex flex-wrap items-center gap-3 rounded-container bg-surface-100-900 p-3">
		<form method="POST" action={actionUrl('setLive')} use:enhance={trackSubmission('setLive')}>
			<input type="hidden" name="enabled" value={isLive ? 'false' : 'true'} />
			<button
				class={isLive ? 'btn preset-filled-success-500' : 'btn preset-tonal-surface'}
				type="submit"
				role="switch"
				aria-checked={isLive}
				aria-label="Live graphic"
				disabled={liveDisabled}
			>
				<span class="size-2 rounded-full bg-current" aria-hidden="true"></span>
				{isLive ? 'Live on' : 'Live off'}
			</button>
		</form>
		<button
			class="btn preset-tonal-error"
			type="button"
			disabled={!savedBoard || Boolean(submittingAction)}
			onclick={requestReset}
		>
			<TrashIcon class="size-4" /> Reset
		</button>
		{#if dirty}
			<p class="text-sm font-medium text-warning-700-300">
				Save changes before taking the board live.
			</p>
		{:else if invalid || !previewBoard}
			<p class="text-sm text-surface-600-400">
				Complete the required board fields before going live.
			</p>
		{:else}
			<p class="text-sm text-surface-600-400">Publication state comes from the server.</p>
		{/if}
	</div>

	<div class="grid gap-6 2xl:grid-cols-[minmax(380px,0.75fr)_minmax(0,1.25fr)]">
		<form
			method="POST"
			action={actionUrl('saveBoard')}
			use:enhance={trackSubmission('saveBoard')}
			class="space-y-5"
		>
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
				<legend class="legend">Graphic resource candidates</legend>
				{#each composer.championIds as championId (championId)}
					<input type="hidden" name="championIds" value={championId} />
					<input
						type="hidden"
						name={`starLevel:${championId}`}
						value={composer.starLevels[championId] ?? ''}
					/>
				{/each}
				{#each composer.augmentIds as augmentId (augmentId)}
					<input type="hidden" name="augmentIds" value={augmentId} />
				{/each}

				<Tabs value={activeAssetTab} onValueChange={selectAssetType}>
					<Tabs.List
						aria-label="Graphic asset candidates"
						class="relative flex gap-2 border-b border-surface-200-800"
					>
						<Tabs.Trigger
							value="champions"
							class="btn rounded-b-none px-4 py-2"
							aria-label={`Champions (${composer.championIds.length})`}
						>
							Champions <span class="badge preset-tonal-surface">{composer.championIds.length}</span
							>
						</Tabs.Trigger>
						<Tabs.Trigger
							value="augments"
							class="btn rounded-b-none px-4 py-2"
							aria-label={`Augments (${composer.augmentIds.length})`}
						>
							Augments <span class="badge preset-tonal-surface">{composer.augmentIds.length}</span>
						</Tabs.Trigger>
						<Tabs.Indicator class="absolute bottom-0 h-0.5 bg-primary-500" />
					</Tabs.List>

					<Tabs.Content value="champions">
						{#if activeAssetTab === 'champions'}
							<div class="mt-3 space-y-3">
								<label class="label label-text" for="champion-candidate-search"
									>Search champions</label
								>
								<div class="field-group grid-cols-[auto_1fr]">
									<span class="label label-text preset-tonal-primary" aria-hidden="true">
										<SearchIcon class="size-4" />
									</span>
									<input
										class="input"
										id="champion-candidate-search"
										type="search"
										bind:value={championQuery}
										placeholder="Champion name or external ID"
									/>
								</div>
								<div class="grid max-h-80 grid-cols-1 gap-2 overflow-auto pr-1 sm:grid-cols-2">
									{#each championCandidates as champion (champion.id)}
										{@const selected = selectedChampionIds.has(champion.id)}
										<div
											class:selected-card={selected}
											class="grid grid-cols-[auto_1fr_82px] items-center gap-2 rounded-base border border-surface-200-800 p-2"
										>
											<input
												class="checkbox"
												type="checkbox"
												checked={selected}
												onchange={(event) =>
													toggleChampion(champion.id, event.currentTarget.checked)}
												aria-label={`Select ${champion.displayName}`}
											/>
											<span class="truncate text-sm font-medium" title={champion.displayName}
												>{champion.displayName}</span
											>
											<select
												class="select-sm select"
												value={composer.starLevels[champion.id] ?? ''}
												onchange={(event) =>
													(composer.starLevels[champion.id] = event.currentTarget.value)}
												disabled={!selected}
												aria-label={`${champion.displayName} star level`}
											>
												<option value="">Stars</option><option value="1">1 ★</option><option
													value="2">2 ★</option
												><option value="3">3 ★</option>
											</select>
										</div>
									{:else}<p class="text-sm text-surface-500">
											No champions match this search.
										</p>{/each}
								</div>
							</div>
						{/if}
					</Tabs.Content>

					<Tabs.Content value="augments">
						{#if activeAssetTab === 'augments'}
							<div class="mt-3 space-y-3">
								<label class="label label-text" for="augment-candidate-search"
									>Search augments</label
								>
								<div class="field-group grid-cols-[auto_1fr]">
									<span class="label label-text preset-tonal-primary" aria-hidden="true">
										<SearchIcon class="size-4" />
									</span>
									<input
										class="input"
										id="augment-candidate-search"
										type="search"
										bind:value={augmentQuery}
										placeholder="Augment name or external ID"
									/>
								</div>
								<p id="augment-choice-limit" class="sr-only">
									A maximum of three augments can be selected. Remove a selected augment to choose
									another.
								</p>
								<div class="grid max-h-52 grid-cols-1 gap-1 overflow-auto pr-1 sm:grid-cols-2">
									{#each augmentCandidates as augment (augment.id)}
										{@const selected = selectedAugmentIds.has(augment.id)}
										{@const disabled = disabledAugment(augment.id)}
										<label
											class="flex items-center gap-2 rounded-base p-2 hover:preset-tonal-primary"
											class:cursor-not-allowed={disabled}
											class:cursor-pointer={!disabled}
										>
											<input
												class="checkbox"
												type="checkbox"
												checked={selected}
												{disabled}
												onchange={(event) => toggleAugment(augment.id, event.currentTarget.checked)}
												aria-describedby={disabled ? 'augment-choice-limit' : undefined}
												aria-label={`Select ${augment.displayName}`}
											/>
											<span class="truncate text-sm" title={augment.displayName}
												>{augment.displayName}</span
											>
										</label>
									{:else}<p class="text-sm text-surface-500">
											No augments match this search.
										</p>{/each}
								</div>
							</div>
						{/if}
					</Tabs.Content>
				</Tabs>

				<div class="grid gap-3 rounded-container bg-surface-100-900 p-3 sm:grid-cols-2">
					<div aria-label="Selected champions">
						<strong class="text-sm">Selected champions</strong>
						<p class="mt-1 text-sm text-surface-600-400">
							{selectedChampions.map((champion) => champion.displayName).join(', ') || 'None'}
						</p>
					</div>
					<div aria-label="Selected augments">
						<strong class="text-sm">Selected augments</strong>
						<p class="mt-1 text-sm text-surface-600-400">
							{selectedAugments.map((augment) => augment.displayName).join(', ') || 'None'}
						</p>
					</div>
				</div>
			</fieldset>

			<button
				class="btn preset-filled-primary-500"
				type="submit"
				disabled={invalid || Boolean(submittingAction)}
			>
				<SaveIcon class="size-4" />
				{submittingAction === 'saveBoard' ? 'Saving…' : 'Save board'}
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

	{#if form?.message && ['saveBoard', 'setLive', 'resetBoard'].includes(form.action)}
		<p class="mt-4 rounded-base preset-tonal-error p-3 text-sm" role="alert">{form.message}</p>
	{/if}
</section>

<ResetRequiredDialog
	bind:this={resetDialog}
	open={resetOpen}
	title="Reset the saved winner board?"
	description={isLive
		? 'This permanently clears the saved board and will hide the live graphic.'
		: 'This permanently clears the saved board. The broadcast graphic will remain hidden.'}
	confirmAction={actionUrl('resetBoard')}
	hiddenInputs={{ tournamentId: tournament?.id ?? '' }}
	invokingControl={resetInvoker}
	onclose={() => (resetOpen = false)}
/>

<style>
	.selected-card {
		border-color: var(--color-primary-500);
		background: color-mix(in oklab, var(--color-primary-500) 12%, transparent);
	}
</style>
