<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import PlusIcon from '@lucide/svelte/icons/plus';

	let { tournaments, selectedTournament, activeCatalog, form = null } = $props();

	const snapshotWarning = $derived.by(() => {
		if (!activeCatalog.snapshot?.metadataJson) return null;
		try {
			return JSON.parse(activeCatalog.snapshot.metadataJson).warning ?? null;
		} catch {
			return null;
		}
	});

	/** @param {Event} event */
	function selectTournament(event) {
		const id = /** @type {HTMLSelectElement} */ (event.currentTarget).value;
		void goto(resolve(id ? `/admin?tournament=${encodeURIComponent(id)}` : '/admin'));
	}
</script>

<section id="tournament" class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
	<header class="mb-5 flex flex-wrap items-start justify-between gap-3">
		<div>
			<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">Event scope</p>
			<h2 class="h3">Tournament & catalog</h2>
			<p class="mt-1 text-sm text-surface-600-400">
				All roster, draft, and asset choices stay inside this tournament.
			</p>
		</div>
		{#if activeCatalog.snapshot}
			<span class="badge preset-tonal-success">Catalog ready</span>
		{:else}
			<span class="badge preset-tonal-warning">Catalog required</span>
		{/if}
	</header>

	<div class="grid gap-5 xl:grid-cols-2">
		<div class="space-y-4">
			<label class="label">
				<span class="label-text">Active tournament</span>
				<select class="select" value={selectedTournament?.id ?? ''} onchange={selectTournament}>
					<option value=""
						>{tournaments.length ? 'Select a tournament' : 'No tournaments yet'}</option
					>
					{#each tournaments as tournament (tournament.id)}
						<option value={tournament.id}>{tournament.name}</option>
					{/each}
				</select>
			</label>

			<form method="POST" action="?/createTournament" class="flex items-end gap-2">
				<label class="label min-w-0 flex-1">
					<span class="label-text">New tournament</span>
					<input
						class="input"
						name="name"
						required
						maxlength="100"
						placeholder="HCMUSEC TFT Finals"
					/>
				</label>
				<button class="btn preset-filled-primary-500" type="submit"
					><PlusIcon class="size-4" /> Create</button
				>
			</form>
		</div>

		<div class="space-y-4">
			{#if activeCatalog.snapshot}
				<div class="grid grid-cols-2 gap-3 rounded-container bg-surface-100-900 p-4 text-sm">
					<div>
						<span class="block text-xs text-surface-500">Source</span><strong
							>{activeCatalog.snapshot.source}</strong
						>
					</div>
					<div>
						<span class="block text-xs text-surface-500">Patch</span><strong
							>{activeCatalog.snapshot.patchLabel}</strong
						>
					</div>
					<div>
						<span class="block text-xs text-surface-500">Locale</span><strong
							>{activeCatalog.snapshot.locale}</strong
						>
					</div>
					<div>
						<span class="block text-xs text-surface-500">Assets</span><strong
							>{activeCatalog.champions.length} champions</strong
						>
					</div>
				</div>
			{:else}
				<div class="rounded-container preset-tonal-warning p-4 text-sm">
					Sync a catalog before composing a winner board.
				</div>
			{/if}

			<form
				method="POST"
				action="?/syncCatalog"
				class="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
			>
				<input type="hidden" name="tournamentId" value={selectedTournament?.id ?? ''} />
				<label class="label">
					<span class="label-text">Patch</span>
					<input class="input" name="patch" value="latest" required />
				</label>
				<label class="label">
					<span class="label-text">Locale</span>
					<select class="select" name="locale" value="vi_vn">
						<option value="vi_vn">vi_vn</option>
						<option value="en_us">en_us</option>
					</select>
				</label>
				<button class="btn preset-tonal-primary" type="submit" disabled={!selectedTournament}>
					<RefreshCwIcon class="size-4" /> Sync
				</button>
			</form>
		</div>
	</div>

	{#if snapshotWarning}
		<p class="mt-4 rounded-base preset-tonal-warning p-3 text-sm">{snapshotWarning}</p>
	{/if}
	{#if form?.action === 'syncCatalog' && form.warning}
		<p class="mt-4 rounded-base preset-tonal-warning p-3 text-sm">{form.warning}</p>
	{/if}
</section>
