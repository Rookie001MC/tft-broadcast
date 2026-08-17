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
	import TftMatchImportDialog from './TftMatchImportDialog.svelte';
	/** @import { WinnerBoardView } from '$lib/winner-board.js' */
	/** @typedef {{ id: string, displayName: string, fullName: string, riotId: string | null, riotGameName?: string | null, riotTagline?: string | null, imagePath: string | null }} Player */
	/** @typedef {{ id: string, displayName: string, iconPath: string | null }} CatalogAsset */
	/** @typedef {{ instanceId: string, catalogChampionId: string, starLevel: string }} ChampionInstance */

	/** @type {{ tournament: { id: string } | null, roster: Player[], activeCatalog: { snapshot: any, champions: CatalogAsset[], augments: CatalogAsset[] }, savedBoard: import('$lib/winner-board.js').WinnerBoardStateView | null, tftMatchApi: import('$lib/tft-match.js').TftMatchApiAvailability, livePublicationId?: string | null, form?: any }} */
	let {
		tournament,
		roster,
		activeCatalog,
		savedBoard,
		tftMatchApi,
		livePublicationId = null,
		form = null
	} = $props();

	let nextChampionInstanceId = 0;

	/** @param {string} catalogChampionId @param {number | '' | null} [starLevel] */
	function createChampionInstance(catalogChampionId, starLevel = '') {
		nextChampionInstanceId += 1;
		return {
			instanceId: `unit-${nextChampionInstanceId}`,
			catalogChampionId,
			starLevel: starLevel == null ? '' : String(starLevel)
		};
	}

	/** @param {import('$lib/winner-board.js').WinnerBoardStateView | null} board */
	function formState(board) {
		return {
			title: board?.title ?? 'Match winner',
			winnerPlayerId: board?.winner.id ?? roster[0]?.id ?? '',
			/** @type {ChampionInstance[]} */
			champions:
				board?.champions.map((champion) =>
					createChampionInstance(champion.id, champion.starLevel)
				) ?? [],
			augmentIds: board?.augments.map((augment) => augment.id) ?? []
		};
	}

	/** @param {ReturnType<typeof formState>} value */
	function normalizedForm(value) {
		return {
			title: value.title.trim(),
			winnerPlayerId: value.winnerPlayerId,
			champions: value.champions.map((unit) => ({
				catalogChampionId: unit.catalogChampionId,
				starLevel: String(unit.starLevel ?? '')
			})),
			augmentIds: [...value.augmentIds]
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

	const initialForm = untrack(() => formState(savedBoard));
	let composer = $state(initialForm);
	let savedForm = $state.raw(untrack(() => normalizedForm(initialForm)));
	let lastBaselineKey = untrack(() => boardKey(savedBoard));
	/** @type {{ previewToken: string, matchId: string } | null} */
	let apiSource = $state(null);
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
	/** @type {HTMLElement | null} */
	let reviewRegion = null;

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
				apiSource = null;
				lastBaselineKey = key;
			}
		};
	}

	const normalizedComposer = $derived(normalizedForm(composer));
	const dirty = $derived(
		Boolean(apiSource) || JSON.stringify(normalizedComposer) !== JSON.stringify(savedForm)
	);
	const championCandidates = $derived(
		/** @type {CatalogAsset[]} */ (searchCatalogResources(activeCatalog.champions, championQuery))
	);
	const augmentCandidates = $derived(
		/** @type {CatalogAsset[]} */ (searchCatalogResources(activeCatalog.augments, augmentQuery))
	);
	const selectedAugmentIds = $derived(new Set(composer.augmentIds));
	const selectedChampions = $derived.by(() =>
		composer.champions.flatMap((unit) => {
			const champion = activeCatalog.champions.find((item) => item.id === unit.catalogChampionId);
			return champion ? [{ unit, champion }] : [];
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
			composer.champions.length === 0
	);
	const isLive = $derived(Boolean(livePublicationId));

	/** @type {WinnerBoardView | null} */
	const previewBoard = $derived.by(() => {
		const winner = roster.find((player) => player.id === composer.winnerPlayerId);
		if (!winner || !composer.title.trim() || composer.champions.length === 0) return null;
		const champions = composer.champions.flatMap((unit, displayOrder) => {
			const champion = activeCatalog.champions.find((item) => item.id === unit.catalogChampionId);
			return champion
				? [
						{
							id: champion.id,
							displayName: champion.displayName,
							iconPath: champion.iconPath,
							starLevel: Number(unit.starLevel) || null,
							displayOrder
						}
					]
				: [];
		});
		if (champions.length !== composer.champions.length) return null;
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

	/** @param {string} catalogChampionId */
	function addChampion(catalogChampionId) {
		composer.champions = [...composer.champions, createChampionInstance(catalogChampionId)];
	}

	/** @param {string} instanceId */
	function removeChampion(instanceId) {
		composer.champions = composer.champions.filter((unit) => unit.instanceId !== instanceId);
	}

	/** @param {string} id */
	function addAugment(id) {
		if (selectedAugmentIds.has(id) || augmentLimitReached) return;
		composer.augmentIds = [...composer.augmentIds, id];
	}

	/** @param {string} id */
	function removeAugment(id) {
		composer.augmentIds = composer.augmentIds.filter((value) => value !== id);
	}

	/** @param {{ value: string }} details */
	function selectAssetType(details) {
		if (details.value === 'champions' || details.value === 'augments')
			activeAssetTab = details.value;
	}

	/** @param {string} id */
	function disabledAugment(id) {
		return selectedAugmentIds.has(id) || augmentLimitReached;
	}

	/** @param {MouseEvent & { currentTarget: HTMLButtonElement }} event */
	function requestReset(event) {
		resetInvoker = event.currentTarget;
		resetOpen = true;
		resetDialog?.showModal();
	}

	/** @returns {import('svelte/attachments').Attachment<HTMLElement>} */
	function captureReviewRegion() {
		return (node) => {
			reviewRegion = node;
			return () => {
				if (reviewRegion === node) reviewRegion = null;
			};
		};
	}

	/** @param {import('$lib/tft-match.js').TftMatchComposerDraft} draft */
	function useApiBoard(draft) {
		composer.winnerPlayerId = draft.winnerPlayerId;
		composer.champions = draft.champions.map((champion) =>
			createChampionInstance(champion.catalogChampionId, champion.starLevel)
		);
		apiSource = { previewToken: draft.previewToken, matchId: draft.matchId };
		queueMicrotask(() => reviewRegion?.focus());
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
				Set the player's winning a game and their board, inspect the preview, then publish.
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

	<div
		data-winner-control-row
		class="mb-5 flex flex-wrap items-center gap-3 rounded-container bg-surface-100-900 p-3"
	>
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
		<TftMatchImportDialog
			{tournament}
			{roster}
			apiAvailability={tftMatchApi}
			hasActiveCatalog={Boolean(activeCatalog.snapshot)}
			onuseboard={useApiBoard}
		/>
		<button
			class="btn preset-tonal-error"
			type="button"
			disabled={!savedBoard || Boolean(submittingAction)}
			onclick={requestReset}
		>
			<TrashIcon class="size-4" /> Reset
		</button>
		{#if apiSource}
			<p class="text-sm font-medium text-primary-700-300">
				API board loaded. Review it, then Save.
			</p>
		{:else if dirty}
			<p class="text-sm font-medium text-error-700-300">
				Save changes before taking the board live.
			</p>
		{:else if invalid || !previewBoard}
			<p class="text-sm text-warning-600-400">
				Complete the required board fields before going live.
			</p>
		{:else}
			<p class="text-sm text-surface-600-400">This graphic is ready to go live.</p>
		{/if}
	</div>

	<div class="grid gap-6 2xl:grid-cols-[minmax(380px,0.75fr)_minmax(0,1.25fr)]">
		<form
			data-composer-review
			tabindex="-1"
			aria-label="Winner board review and save"
			{@attach captureReviewRegion()}
			method="POST"
			action={actionUrl('saveBoard')}
			use:enhance={trackSubmission('saveBoard')}
			class="space-y-5"
		>
			<input type="hidden" name="tournamentId" value={tournament?.id ?? ''} />
			{#if apiSource}
				<input type="hidden" name="tftPreviewToken" value={apiSource.previewToken} />
				<input type="hidden" name="tftMatchId" value={apiSource.matchId} />
			{/if}

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
				{#each composer.champions as unit (unit.instanceId)}
					<input type="hidden" name="championIds" value={unit.catalogChampionId} />
					<input type="hidden" name="championStarLevels" value={unit.starLevel} />
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
							aria-label={`Champions (${composer.champions.length})`}
						>
							Champions <span class="badge preset-tonal-surface">{composer.champions.length}</span>
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
								<section aria-labelledby="available-champions-heading" class="space-y-2">
									<h3 id="available-champions-heading" class="font-bold">Available champions</h3>
									<div class="grid max-h-80 grid-cols-1 gap-2 overflow-auto pr-1 sm:grid-cols-2">
										{#each championCandidates as champion (champion.id)}
											<div
												class="grid grid-cols-[1fr_auto] items-center gap-2 rounded-base border border-surface-200-800 p-2"
											>
												<span class="truncate text-sm font-medium" title={champion.displayName}
													>{champion.displayName}</span
												>
												<button
													class="btn preset-tonal-primary btn-sm"
													type="button"
													onclick={() => addChampion(champion.id)}
													aria-label={`Add ${champion.displayName}`}
												>
													Add
												</button>
											</div>
										{:else}<p class="text-sm text-surface-500">
												No champions match this search.
											</p>{/each}
									</div>
								</section>

								<section aria-labelledby="selected-units-heading" class="space-y-2">
									<h3 id="selected-units-heading" class="font-bold">Selected units</h3>
									<div class="grid gap-2">
										{#each selectedChampions as selection, displayOrder (selection.unit.instanceId)}
											<div
												class="grid grid-cols-[1fr_92px_auto] items-center gap-2 rounded-base border border-primary-500 bg-primary-500/10 p-2"
											>
												<span
													class="truncate text-sm font-medium"
													title={selection.champion.displayName}
													>{selection.champion.displayName}</span
												>
												<select
													class="select-sm select"
													bind:value={selection.unit.starLevel}
													aria-label={`${selection.champion.displayName} unit ${displayOrder + 1} star level`}
												>
													<option value="">Stars</option>
													<option value="1">1 ★</option>
													<option value="2">2 ★</option>
													<option value="3">3 ★</option>
												</select>
												<button
													class="btn preset-tonal-error btn-sm"
													type="button"
													onclick={() => removeChampion(selection.unit.instanceId)}
													aria-label={`Remove ${selection.champion.displayName} unit ${displayOrder + 1}`}
												>
													Remove
												</button>
											</div>
										{:else}<p class="text-sm text-surface-500">None selected.</p>{/each}
									</div>
								</section>
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
								<section aria-labelledby="available-augments-heading" class="space-y-2">
									<h3 id="available-augments-heading" class="font-bold">Available augments</h3>
									<div class="grid max-h-52 grid-cols-1 gap-1 overflow-auto pr-1 sm:grid-cols-2">
										{#each augmentCandidates as augment (augment.id)}
											{@const disabled = disabledAugment(augment.id)}
											<div
												class="grid grid-cols-[1fr_auto] items-center gap-2 rounded-base p-2 hover:preset-tonal-primary"
											>
												<span class="truncate text-sm" title={augment.displayName}
													>{augment.displayName}</span
												>
												<button
													class="btn preset-tonal-primary btn-sm"
													type="button"
													{disabled}
													onclick={() => addAugment(augment.id)}
													aria-describedby={disabled ? 'augment-choice-limit' : undefined}
													aria-label={`Add ${augment.displayName}`}
												>
													Add
												</button>
											</div>
										{:else}<p class="text-sm text-surface-500">
												No augments match this search.
											</p>{/each}
									</div>
								</section>

								<section aria-labelledby="selected-augments-heading" class="space-y-2">
									<h3 id="selected-augments-heading" class="font-bold">Selected augments</h3>
									<div class="grid gap-2 sm:grid-cols-2">
										{#each selectedAugments as augment (augment.id)}
											<div
												class="grid grid-cols-[1fr_auto] items-center gap-2 rounded-base border border-primary-500 bg-primary-500/10 p-2"
											>
												<span class="truncate text-sm font-medium" title={augment.displayName}
													>{augment.displayName}</span
												>
												<button
													class="btn preset-tonal-error btn-sm"
													type="button"
													onclick={() => removeAugment(augment.id)}
													aria-label={`Remove ${augment.displayName}`}
												>
													Remove
												</button>
											</div>
										{:else}<p class="text-sm text-surface-500">None selected.</p>{/each}
									</div>
								</section>
							</div>
						{/if}
					</Tabs.Content>
				</Tabs>
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
				<span class="text-xs text-surface-500">Same 1920x1080 renderer as /gfx</span>
			</div>
			<div
				class="preview-viewport flex items-center justify-center overflow-auto rounded-container border border-surface-200-800 bg-surface-950"
			>
				<WinnerBoardGraphic board={previewBoard} scale={0.55} />
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
