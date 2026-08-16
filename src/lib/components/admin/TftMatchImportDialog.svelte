<script>
	import { resolve } from '$app/paths';

	let { tournament, roster, apiAvailability, hasActiveCatalog, onuseboard } = $props();

	/** @type {HTMLDialogElement | null} */
	let dialog = null;
	/** @type {HTMLButtonElement | null} */
	let trigger = null;
	/** @type {'roster' | 'loading' | 'matches' | 'verify'} */
	let stage = $state('roster');
	/** @type {any} */
	let selectedPlayer = $state(null);
	/** @type {string | null} */
	let responseToken = $state(null);
	/** @type {Array<import('$lib/tft-match.js').TftMatchPreviewRow>} */
	let rows = $state([]);
	/** @type {Extract<import('$lib/tft-match.js').TftMatchPreviewRow, { available: true }> | null} */
	let selectedRow = $state(null);
	/** @type {string | null} */
	let requestError = $state(null);
	const dialogId = $props.id();
	const headingId = `${dialogId}-heading`;
	const entryReasonId = `${dialogId}-entry-reason`;

	const entryReason = $derived(
		!apiAvailability.enabled
			? apiAvailability.reason || 'TFT match import is unavailable.'
			: !tournament
				? 'Select a tournament first.'
				: !hasActiveCatalog
					? 'This tournament needs an active catalog.'
					: roster.length === 0
						? 'Add players to this tournament roster.'
						: null
	);

	/** @returns {import('svelte/attachments').Attachment<HTMLDialogElement>} */
	function captureDialog() {
		return (node) => {
			dialog = node;
			return () => {
				if (dialog === node) dialog = null;
			};
		};
	}

	/** @returns {import('svelte/attachments').Attachment<HTMLButtonElement>} */
	function captureTrigger() {
		return (node) => {
			trigger = node;
			return () => {
				if (trigger === node) trigger = null;
			};
		};
	}

	function reset() {
		stage = 'roster';
		selectedPlayer = null;
		responseToken = null;
		rows = [];
		selectedRow = null;
		requestError = null;
	}

	function openDialog() {
		if (entryReason) return;
		reset();
		dialog?.showModal();
	}

	/** @param {boolean} [restoreFocus] */
	function dismiss(restoreFocus = true) {
		if (dialog?.open) dialog.close();
		if (restoreFocus) queueMicrotask(() => trigger?.focus());
	}

	/** @param {Event} event */
	function handleCancel(event) {
		event.preventDefault();
		dismiss();
	}

	/** @param {KeyboardEvent} event */
	function handleKeydown(event) {
		if (!dialog) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			dismiss();
			return;
		}
		if (event.key !== 'Tab') return;
		const focusable = [
			...dialog.querySelectorAll(
				'button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]'
			)
		];
		if (focusable.length === 0) return;
		const first = /** @type {HTMLElement} */ (focusable[0]);
		const last = /** @type {HTMLElement} */ (focusable.at(-1));
		if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		} else if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		}
	}

	/** @param {any} player */
	function playerIsEligible(player) {
		return Boolean(player.riotGameName?.trim() && player.riotTagline?.trim());
	}

	/** @param {any} player */
	async function fetchMatches(player) {
		if (!playerIsEligible(player) || !tournament) return;
		selectedPlayer = player;
		stage = 'loading';
		requestError = null;
		const form = new FormData();
		form.set('tournamentId', tournament.id);
		form.set('playerId', player.id);
		try {
			const response = await fetch(resolve('/admin/graphics/tft-matches'), {
				method: 'POST',
				body: form,
				headers: { Accept: 'application/json' }
			});
			const body = await response.json();
			if (!response.ok) throw new Error(body?.message || 'TFT match history could not be fetched.');
			responseToken = body.token;
			selectedPlayer = body.selectedPlayer;
			rows = Array.isArray(body.matches) ? body.matches.slice(0, 10) : [];
			stage = 'matches';
		} catch (caught) {
			requestError =
				caught instanceof Error ? caught.message : 'TFT match history could not be fetched.';
			stage = 'matches';
		}
	}

	/** @param {import('$lib/tft-match.js').TftMatchPreviewRow} row */
	function verify(row) {
		if (!row.available) return;
		selectedRow = row;
		stage = 'verify';
	}

	function useBoard() {
		if (!selectedRow || !selectedPlayer || !responseToken) return;
		onuseboard({
			previewToken: responseToken,
			matchId: selectedRow.matchId,
			winnerPlayerId: selectedPlayer.id,
			champions: selectedRow.champions
		});
		dismiss(false);
	}

	/** @param {string} value */
	function localDateTime(value) {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}
</script>

<div class="group relative inline-flex">
	<button
		{@attach captureTrigger()}
		type="button"
		class="preset-tonal-primary-500 btn"
		aria-disabled={entryReason ? 'true' : undefined}
		aria-describedby={entryReason ? entryReasonId : undefined}
		onclick={openDialog}>Fetch API Data</button
	>
	{#if entryReason}
		<div
			id={entryReasonId}
			role="tooltip"
			class="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-72 -translate-x-1/2 rounded-container bg-surface-950 px-3 py-2 text-xs text-surface-50 shadow-lg group-focus-within:block group-hover:block"
		>
			{entryReason}
		</div>
	{/if}
</div>

<dialog
	{@attach captureDialog()}
	aria-labelledby={headingId}
	aria-modal="true"
	oncancel={handleCancel}
	onkeydown={handleKeydown}
	class="fixed inset-0 m-0 h-dvh max-h-none w-dvw max-w-none bg-transparent p-4 text-surface-950-50 backdrop:bg-black/70 md:p-8"
>
	<section
		class="flex h-full flex-col overflow-y-auto rounded-container bg-surface-50-950 p-5 md:p-8"
	>
		<header class="flex items-start justify-between gap-4 border-b border-surface-200-800 pb-5">
			<div>
				<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">
					TFT match import
				</p>
				<h2 id={headingId} class="mt-1 h3">
					{stage === 'roster'
						? 'Which player do you want to fetch data from?'
						: stage === 'verify'
							? 'Please double-check this is the correct board.'
							: 'Recent TFT matches'}
				</h2>
			</div>
			<button class="btn preset-tonal-surface" type="button" onclick={() => dismiss()}>Close</button
			>
		</header>

		{#if stage === 'roster'}
			<div class="grid gap-3 py-6">
				{#each roster as player (player.id)}
					{@const eligible = playerIsEligible(player)}
					<div class="group/player relative">
						<button
							data-roster-player
							type="button"
							class="w-full card p-4 text-left {eligible
								? 'hover:preset-tonal-primary-500'
								: 'opacity-50'}"
							aria-disabled={eligible ? undefined : 'true'}
							aria-describedby={eligible ? undefined : `${dialogId}-player-${player.id}-reason`}
							onclick={() => fetchMatches(player)}
						>
							<span class="block font-semibold">{player.displayName}</span>
							<span class="block text-sm text-surface-600-400">{player.riotId || 'No Riot ID'}</span
							>
						</button>
						{#if !eligible}
							<div
								id={`${dialogId}-player-${player.id}-reason`}
								role="tooltip"
								class="pointer-events-none absolute top-full left-4 z-20 mt-1 hidden rounded-container bg-surface-950 px-3 py-2 text-xs text-surface-50 shadow-lg group-focus-within/player:block group-hover/player:block"
							>
								A complete Riot ID is required.
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{:else if stage === 'loading'}
			<div class="grid flex-1 place-items-center py-10" role="status" aria-live="polite">
				<div class="flex flex-col items-center gap-4 text-center">
					<div
						class="h-10 w-10 shrink-0 animate-spin rounded-full border-4 border-surface-300-700 border-t-primary-500"
						style="width: 2.5rem; height: 2.5rem"
						role="progressbar"
						aria-label="Fetching TFT match history"
					></div>
					<p class="font-semibold">Please wait…</p>
				</div>
			</div>
		{:else if stage === 'matches'}
			<div class="space-y-5 py-6">
				{#if selectedPlayer}
					<p class="text-sm text-surface-600-400">
						Fetching for <strong class="text-surface-950-50">{selectedPlayer.displayName}</strong>
						{#if selectedPlayer.riotId}
							· {selectedPlayer.riotId}{/if}
					</p>
				{/if}
				{#if requestError}
					<div class="alert preset-tonal-error" role="alert">{requestError}</div>
				{:else if rows.length === 0}
					<div class="card p-6 text-center">No recent matches found.</div>
				{:else}
					<div class="grid gap-3">
						{#each rows as row (row.matchId)}
							<div class="group/match relative">
								<button
									data-match-row
									type="button"
									class="w-full card p-4 text-left {row.available
										? 'hover:preset-tonal-primary-500'
										: 'opacity-50'}"
									aria-disabled={row.available ? undefined : 'true'}
									aria-describedby={row.available
										? undefined
										: `${dialogId}-match-${row.matchId}-reason`}
									onclick={() => verify(row)}
								>
									<span class="font-semibold">{row.matchId}</span>
									{#if row.available}
										<span class="mt-1 block text-sm text-surface-600-400">
											{localDateTime(row.completedAt)} · Placement {row.placement} · {row.gameType} ·
											Set {row.setNumber}
											{row.setCoreName}
										</span>
									{/if}
								</button>
								{#if !row.available}
									<div
										id={`${dialogId}-match-${row.matchId}-reason`}
										role="tooltip"
										class="pointer-events-none absolute top-full left-4 z-20 mt-1 hidden rounded-container bg-surface-950 px-3 py-2 text-xs text-surface-50 shadow-lg group-focus-within/match:block group-hover/match:block"
									>
										{row.reason}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
				<div class="flex flex-wrap gap-3">
					<button class="btn preset-tonal-surface" type="button" onclick={() => (stage = 'roster')}
						>Back</button
					>
					{#if selectedPlayer}
						<button
							class="btn preset-filled-primary-500"
							type="button"
							onclick={() => fetchMatches(selectedPlayer)}>Retry</button
						>
					{/if}
				</div>
			</div>
		{:else if selectedRow && selectedPlayer}
			<div class="space-y-6 py-6">
				<div class="grid gap-2 text-sm md:grid-cols-2">
					<p><strong>Player:</strong> {selectedPlayer.displayName} · {selectedPlayer.riotId}</p>
					<p><strong>Completed:</strong> {localDateTime(selectedRow.completedAt)}</p>
					<p><strong>Placement:</strong> {selectedRow.placement}</p>
					<p><strong>Game type:</strong> {selectedRow.gameType}</p>
					<p><strong>Set:</strong> {selectedRow.setNumber} · {selectedRow.setCoreName}</p>
					<p><strong>Match ID:</strong> {selectedRow.matchId}</p>
				</div>
				<ul class="flex flex-col gap-3" aria-label="Champion board">
					{#each selectedRow.champions as champion (champion.displayOrder)}
						<li class="flex items-center gap-3 card p-3">
							{#if champion.iconPath}
								<img class="size-12 rounded-base object-cover" src={champion.iconPath} alt="" />
							{:else}
								<div
									class="grid size-12 place-items-center rounded-base bg-surface-200-800 font-bold"
									aria-hidden="true"
								>
									{champion.displayName.slice(0, 1)}
								</div>
							{/if}
							<span class="font-semibold">{champion.displayName}</span>
							<span class="text-warning-500" aria-label={`${champion.starLevel} stars`}
								>{'★'.repeat(champion.starLevel)}</span
							>
						</li>
					{/each}
				</ul>
				<div class="flex flex-wrap justify-end gap-3">
					<button class="btn preset-tonal-surface" type="button" onclick={() => (stage = 'matches')}
						>Back</button
					>
					<button class="btn preset-filled-primary-500" type="button" onclick={useBoard}
						>Use this board</button
					>
				</div>
			</div>
		{/if}
	</section>
</dialog>
