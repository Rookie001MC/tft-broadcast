<script>
	import SearchIcon from '@lucide/svelte/icons/search';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	/** @typedef {{ id: string, displayName: string, fullName: string, riotId: string | null }} Player */
	/** @type {{ tournament: { id: string } | null, players: Player[], roster: Player[], form?: any }} */
	let { tournament, players, roster, form = null } = $props();
	let search = $state('');
	const rosterIds = $derived(new Set(roster.map((player) => player.id)));
	const availablePlayers = $derived(
		players.filter((player) => {
			const query = search.trim().toLocaleLowerCase();
			return (
				!rosterIds.has(player.id) &&
				(!query ||
					player.displayName.toLocaleLowerCase().includes(query) ||
					player.fullName.toLocaleLowerCase().includes(query) ||
					player.riotId?.toLocaleLowerCase().includes(query))
			);
		})
	);
</script>

<section id="roster" class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
	<header class="mb-5 flex flex-wrap items-start justify-between gap-3">
		<div>
			<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">
				Tournament roster
			</p>
			<h2 class="h3">Players & ordering</h2>
			<p class="mt-1 text-sm text-surface-600-400">
				Add reusable players and order them inside the selected event.
			</p>
		</div>
		<span class="badge preset-tonal-surface">{roster.length} rostered</span>
	</header>

	<div class="grid gap-6 2xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
		<div>
			<form method="POST" action="?/addRosterPlayers" class="space-y-3">
				<input type="hidden" name="tournamentId" value={tournament?.id ?? ''} />
				<div class="space-y-1">
					<label class="label label-text" for="roster-player-search">Search reusable players</label>
					<div class="field-group grid-cols-[auto_1fr]">
						<span class="label label-text preset-tonal-primary" aria-hidden="true">
							<SearchIcon class="size-4" />
						</span>
						<input
							class="input"
							id="roster-player-search"
							type="search"
							bind:value={search}
							placeholder="Name or Riot ID"
						/>
					</div>
				</div>
				<div
					class="max-h-56 space-y-1 overflow-auto rounded-container border border-surface-200-800 p-2"
				>
					{#each availablePlayers as player (player.id)}
						<label
							class="flex cursor-pointer items-center gap-3 rounded-base p-2 hover:preset-tonal-primary"
						>
							<input class="checkbox" type="checkbox" name="playerIds" value={player.id} />
							<span class="min-w-0"
								><strong class="block truncate">{player.displayName}</strong><span
									class="block truncate text-xs text-surface-500"
									>{player.riotId ?? player.fullName}</span
								></span
							>
						</label>
					{:else}
						<p class="p-3 text-sm text-surface-500">No reusable players match this search.</p>
					{/each}
				</div>
				<button
					class="btn preset-filled-primary-500"
					type="submit"
					disabled={!tournament || availablePlayers.length === 0}>Add selected players</button
				>
			</form>
		</div>

		<div>
			<h3 class="mb-3 h4">Ordered roster</h3>
			<div class="table-wrap rounded-container border border-surface-200-800">
				<table class="table text-sm">
					<thead
						><tr><th>#</th><th>Player</th><th>Riot ID</th><th class="text-right">Actions</th></tr
						></thead
					>
					<tbody>
						{#each roster as player, index (player.id)}
							<tr>
								<td>{index + 1}</td>
								<td
									><strong>{player.displayName}</strong><br /><span class="text-xs text-surface-500"
										>{player.fullName}</span
									></td
								>
								<td>{player.riotId ?? '—'}</td>
								<td>
									<div class="flex justify-end gap-1">
										{#each [{ label: 'Move up', order: index - 1, icon: ChevronUpIcon, disabled: index === 0 }, { label: 'Move down', order: index + 1, icon: ChevronDownIcon, disabled: index === roster.length - 1 }] as move (move.label)}
											<form method="POST" action="?/moveRosterPlayer">
												<input type="hidden" name="tournamentId" value={tournament?.id ?? ''} />
												<input type="hidden" name="playerId" value={player.id} />
												<input type="hidden" name="displayOrder" value={move.order} />
												<button
													class="btn-icon btn-icon-sm hover:preset-tonal-primary"
													type="submit"
													aria-label={`${move.label} ${player.displayName}`}
													disabled={move.disabled}><move.icon class="size-4" /></button
												>
											</form>
										{/each}
										<form method="POST" action="?/removeRosterPlayer">
											<input type="hidden" name="tournamentId" value={tournament?.id ?? ''} />
											<input type="hidden" name="playerId" value={player.id} />
											<button
												class="btn-icon btn-icon-sm hover:preset-tonal-error"
												type="submit"
												aria-label={`Remove ${player.displayName}`}
												><TrashIcon class="size-4" /></button
											>
										</form>
									</div>
								</td>
							</tr>
						{:else}
							<tr
								><td colspan="4" class="py-10 text-center text-surface-500"
									>Add players to begin composing a winner board.</td
								></tr
							>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>

	{#if form?.action && ['addRosterPlayers', 'removeRosterPlayer', 'moveRosterPlayer'].includes(form.action) && form.message}
		<p class="mt-4 rounded-base preset-tonal-error p-3 text-sm">{form.message}</p>
	{/if}
</section>
