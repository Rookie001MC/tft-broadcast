<script>
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Progress } from '@skeletonlabs/skeleton-svelte';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SearchIcon from '@lucide/svelte/icons/search';

	/** @typedef {{ id: string, externalId: string, displayName: string, iconPath: string | null, tier: number | null }} CatalogAsset */
	/** @type {{ tournament: { id: string, name: string }, activeCatalog: { snapshot: any, champions: CatalogAsset[], augments: CatalogAsset[] }, form?: any }} */
	let { tournament, activeCatalog, form = null } = $props();
	let syncing = $state(false);
	let search = $state('');
	let progressMessage = $state('Preparing catalog synchronization…');
	/** @type {number | null} */
	let progressPercent = $state(null);
	/** @type {string | null} */
	let liveWarning = $state(null);
	/** @type {string | null} */
	let liveError = $state(null);

	const snapshotWarning = $derived.by(() => {
		if (!activeCatalog.snapshot?.metadataJson) return null;
		try {
			return JSON.parse(activeCatalog.snapshot.metadataJson).warning ?? null;
		} catch {
			return null;
		}
	});
	const normalizedSearch = $derived(search.trim().toLocaleLowerCase());
	const champions = $derived(
		activeCatalog.champions.filter(
			(asset) =>
				!normalizedSearch ||
				asset.displayName.toLocaleLowerCase().includes(normalizedSearch) ||
				asset.externalId.toLocaleLowerCase().includes(normalizedSearch)
		)
	);
	const augments = $derived(
		activeCatalog.augments.filter(
			(asset) =>
				!normalizedSearch ||
				asset.displayName.toLocaleLowerCase().includes(normalizedSearch) ||
				asset.externalId.toLocaleLowerCase().includes(normalizedSearch)
		)
	);

	/** @param {SubmitEvent} event */
	async function streamSync(event) {
		event.preventDefault();
		const formElement = /** @type {HTMLFormElement} */ (event.currentTarget);
		syncing = true;
		progressMessage = 'Preparing catalog synchronization…';
		progressPercent = null;
		liveWarning = null;
		liveError = null;
		try {
			const response = await fetch(resolve('/admin/game-resources/sync'), {
				method: 'POST',
				body: new FormData(formElement),
				headers: { Accept: 'application/x-ndjson' }
			});
			if (!response.ok || !response.body) {
				let message = `Catalog synchronization failed with HTTP ${response.status}.`;
				try {
					const payload = await response.json();
					if (typeof payload?.message === 'string') message = payload.message;
				} catch {
					// Preserve the status-based message when the response is not JSON.
				}
				throw new Error(message);
			}
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let completed = false;
			while (true) {
				const chunk = await reader.read();
				buffer += decoder.decode(chunk.value, { stream: !chunk.done });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					if (!line.trim()) continue;
					const update = JSON.parse(line);
					if (update.type === 'progress') {
						progressMessage = update.message;
						progressPercent = typeof update.percent === 'number' ? update.percent : null;
					} else if (update.type === 'complete') {
						completed = true;
						liveWarning = update.warning;
					} else if (update.type === 'error') {
						throw new Error(update.message);
					}
				}
				if (chunk.done) break;
			}
			if (!completed) throw new Error('Catalog synchronization ended unexpectedly.');
			await invalidateAll();
		} catch (error) {
			liveError = error instanceof Error ? error.message : 'Catalog synchronization failed.';
		} finally {
			syncing = false;
		}
	}
</script>

<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
	<header class="mb-5 flex flex-wrap items-start justify-between gap-3">
		<div>
			<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">Pinned snapshot</p>
			<h2 class="h3">Catalog sync</h2>
			<p class="mt-1 text-sm text-surface-600-400">
				Download and activate an immutable TFT asset snapshot for {tournament.name}.
			</p>
		</div>
		{#if activeCatalog.snapshot}<span class="badge preset-tonal-success">Catalog ready</span
			>{:else}<span class="badge preset-tonal-warning">Catalog required</span>{/if}
	</header>

	{#if activeCatalog.snapshot}
		<div
			class="mb-5 grid gap-3 rounded-container bg-surface-100-900 p-4 text-sm sm:grid-cols-2 xl:grid-cols-5"
		>
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
				<span class="block text-xs text-surface-500">Set</span><strong
					>{activeCatalog.snapshot.setLabel ?? '—'}</strong
				>
			</div>
			<div>
				<span class="block text-xs text-surface-500">Locale</span><strong
					>{activeCatalog.snapshot.locale}</strong
				>
			</div>
			<div>
				<span class="block text-xs text-surface-500">Synced</span><strong
					>{new Date(activeCatalog.snapshot.syncedAt).toLocaleString()}</strong
				>
			</div>
		</div>
	{/if}

	<form
		method="POST"
		action="?/syncCatalog"
		onsubmit={streamSync}
		class="grid items-end gap-3 md:grid-cols-[1fr_1fr_auto]"
	>
		<input type="hidden" name="tournamentId" value={tournament.id} />
		<label class="label"
			><span class="label-text">Patch</span><input
				class="input"
				name="patch"
				value="latest"
				required
				disabled={syncing}
			/></label
		>
		<label class="label"
			><span class="label-text">Locale</span><select
				class="select"
				name="locale"
				value="vi_vn"
				disabled={syncing}
				><option value="vi_vn">vi_vn</option><option value="en_us">en_us</option></select
			></label
		>
		<button class="btn preset-tonal-primary" type="submit" disabled={syncing}
			><RefreshCwIcon class={syncing ? 'size-4 animate-spin' : 'size-4'} />
			{syncing ? 'Downloading…' : 'Sync catalog'}</button
		>
	</form>

	{#if syncing}
		<Progress value={progressPercent} class="mt-4 space-y-2">
			<Progress.Label class="flex justify-between gap-3 text-sm font-medium">
				<span>{progressMessage}</span>
				{#if progressPercent !== null}<span>{progressPercent}%</span>{/if}
			</Progress.Label>
			<Progress.Track class="h-2 w-full overflow-hidden rounded-full bg-surface-200-800">
				<Progress.Range
					class={progressPercent === null
						? 'catalog-progress-range h-full w-1/3 rounded-full bg-primary-500'
						: 'h-full rounded-full bg-primary-500'}
				/>
			</Progress.Track>
		</Progress>
	{/if}

	{#if snapshotWarning}<p class="mt-4 rounded-base preset-tonal-warning p-3 text-sm">
			{snapshotWarning}
		</p>{/if}
	{#if form?.action === 'syncCatalog' && form.warning}<p
			class="mt-4 rounded-base preset-tonal-warning p-3 text-sm"
		>
			{form.warning}
		</p>{/if}
	{#if form?.action === 'syncCatalog' && form.message}<p
			class="mt-4 rounded-base preset-tonal-error p-3 text-sm"
			role="alert"
		>
			{form.message}
		</p>{/if}
	{#if liveWarning}<p class="mt-4 rounded-base preset-tonal-warning p-3 text-sm">
			{liveWarning}
		</p>{/if}
	{#if liveError}<p class="mt-4 rounded-base preset-tonal-error p-3 text-sm" role="alert">
			{liveError}
		</p>{/if}
</section>

<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
	<header class="mb-5 flex flex-wrap items-end justify-between gap-3">
		<div>
			<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">
				Snapshot contents
			</p>
			<h2 class="h3">Game resources</h2>
		</div>
		<div class="w-full space-y-1 sm:w-80">
			<label class="label label-text" for="catalog-resource-search">Filter resources</label>
			<div class="field-group grid-cols-[auto_1fr]">
				<span class="label label-text preset-tonal-surface" aria-hidden="true">
					<SearchIcon class="size-4" />
				</span>
				<input
					class="input"
					id="catalog-resource-search"
					type="search"
					bind:value={search}
					placeholder="Name or external ID"
				/>
			</div>
		</div>
	</header>

	<div class="grid gap-6 2xl:grid-cols-2">
		<div>
			<div class="mb-3 flex items-center justify-between">
				<h3 class="h4">Champions</h3>
				<span class="badge preset-tonal-surface"
					>{champions.length} of {activeCatalog.champions.length}</span
				>
			</div>
			<div class="max-h-[36rem] table-wrap rounded-container border border-surface-200-800">
				<table class="table table-zebra">
					<thead class="sticky top-0 bg-surface-100-900"
						><tr><th>Icon</th><th>Name</th><th>External ID</th><th>Tier</th></tr></thead
					><tbody>
						{#each champions as champion (champion.id)}<tr
								><td
									>{#if champion.iconPath}<img
											src={champion.iconPath}
											alt=""
											class="size-9 rounded-base object-cover"
											loading="lazy"
										/>{:else}—{/if}</td
								><td><strong>{champion.displayName}</strong></td><td
									><code class="text-xs">{champion.externalId}</code></td
								><td>{champion.tier ?? '—'}</td></tr
							>{:else}<tr
								><td colspan="4" class="py-10 text-center text-surface-500"
									>No champions match this filter.</td
								></tr
							>{/each}
					</tbody>
				</table>
			</div>
		</div>
		<div>
			<div class="mb-3 flex items-center justify-between">
				<h3 class="h4">Augments</h3>
				<span class="badge preset-tonal-surface"
					>{augments.length} of {activeCatalog.augments.length}</span
				>
			</div>
			<div class="max-h-[36rem] table-wrap rounded-container border border-surface-200-800">
				<table class="table table-zebra">
					<thead class="sticky top-0 bg-surface-100-900"
						><tr><th>Icon</th><th>Name</th><th>External ID</th><th>Tier</th></tr></thead
					><tbody>
						{#each augments as augment (augment.id)}<tr
								><td
									>{#if augment.iconPath}<img
											src={augment.iconPath}
											alt=""
											class="size-9 rounded-base object-cover"
											loading="lazy"
										/>{:else}—{/if}</td
								><td><strong>{augment.displayName}</strong></td><td
									><code class="text-xs">{augment.externalId}</code></td
								><td>{augment.tier ?? '—'}</td></tr
							>{:else}<tr
								><td colspan="4" class="py-10 text-center text-surface-500"
									>No augments match this filter.</td
								></tr
							>{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>
</section>

<style>
	:global(.catalog-progress-range) {
		animation: catalog-progress 1.2s ease-in-out infinite;
	}

	@keyframes catalog-progress {
		from {
			transform: translateX(-110%);
		}
		to {
			transform: translateX(310%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.catalog-progress-range) {
			animation-duration: 3s;
		}
	}
</style>
