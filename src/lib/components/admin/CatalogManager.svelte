<script>
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Progress } from '@skeletonlabs/skeleton-svelte';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ResetRequiredDialog from './ResetRequiredDialog.svelte';

	/** @typedef {{ id: string, externalId: string, displayName: string, iconPath: string | null, tier: number | null, correctionId?: string | null, isExcluded?: boolean, provenanceJson?: string }} CatalogAsset */
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
	/** @type {string | null} */
	let submittingAction = $state(null);
	/** @type {(CatalogAsset & { resourceKind: 'champion' | 'augment' }) | null} */
	let pendingResource = $state(null);
	/** @type {HTMLElement | null} */
	let resetInvoker = $state(null);
	let resetOpen = $state(false);
	let handledResetResultKey = '';

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

	const resetResultKey = $derived(
		`${form?.action ?? ''}:${form?.result?.kind ?? ''}:${form?.resourceKind ?? ''}:${form?.resourceId ?? ''}`
	);

	/** @param {string} resultKey @returns {import('svelte/attachments').Attachment<HTMLElement>} */
	function showResetResult(resultKey) {
		return () => {
			if (
				form?.action === 'excludeResource' &&
				form.result?.kind === 'reset_required' &&
				resultKey !== handledResetResultKey
			) {
				if (
					typeof form.resourceId === 'string' &&
					form.resourceId &&
					(form.resourceKind === 'champion' || form.resourceKind === 'augment')
				) {
					pendingResource = {
						id: form.resourceId,
						externalId: '',
						displayName:
							typeof form.result.label === 'string' ? form.result.label : 'This resource',
						iconPath: null,
						tier: null,
						resourceKind: form.resourceKind
					};
					resetOpen = true;
				}
				handledResetResultKey = resultKey;
			}
		};
	}

	/** @param {CatalogAsset} asset */
	function provenance(asset) {
		try {
			const parsed = JSON.parse(asset.provenanceJson ?? '{}');
			return parsed.source === 'manual'
				? 'Manual provenance'
				: parsed.operation
					? `Upstream · ${parsed.operation} correction`
					: 'Upstream provenance';
		} catch {
			return 'Upstream provenance';
		}
	}

	/** @param {CatalogAsset} resource @param {'champion' | 'augment'} resourceKind @returns {import('@sveltejs/kit').SubmitFunction} */
	function submitExclude(resource, resourceKind) {
		return ({ submitter }) => {
			pendingResource = { ...resource, resourceKind };
			resetInvoker = submitter;
			submittingAction = `exclude:${resource.id}`;
			return async ({ result, update }) => {
				await update({ reset: false });
				submittingAction = null;
				if (result.type === 'success' && result.data?.result?.kind === 'reset_required') {
					resetOpen = true;
				}
			};
		};
	}

	/** @type {import('@sveltejs/kit').SubmitFunction} */
	const confirmExclude = () => {
		submittingAction = 'confirmExcludeResource';
		return async ({ update }) => {
			resetOpen = false;
			await update({ reset: false });
			submittingAction = null;
		};
	};

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
						if (update.activated !== true)
							throw new Error('Catalog synchronization did not activate a new snapshot.');
						completed = true;
						liveWarning = typeof update.warning === 'string' ? update.warning : null;
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

<section
	class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5"
	{@attach showResetResult(resetResultKey)}
>
	<header class="mb-5">
		<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">
			Operator corrections
		</p>
		<h2 class="h3">Add manual resource</h2>
		<p class="mt-1 text-sm text-surface-600-400">
			Corrections are persisted with their scope and provenance, then applied on catalog
			synchronization.
		</p>
	</header>
	<form
		method="POST"
		action="?/createCorrection"
		enctype="multipart/form-data"
		use:enhance={trackSubmission('createCorrection')}
		class="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-4"
	>
		<input
			type="hidden"
			name="canonicalSetKey"
			value={activeCatalog.snapshot?.canonicalSetKey ?? ''}
		/>
		<input type="hidden" name="patchLabel" value={activeCatalog.snapshot?.patchLabel ?? 'latest'} />
		<input type="hidden" name="operation" value="add" />
		<label class="label"
			><span class="label-text">Resource kind</span><select
				class="select"
				name="resourceKind"
				disabled={Boolean(submittingAction)}
				><option value="champion">Champion</option><option value="augment">Augment</option></select
			></label
		>
		<label class="label"
			><span class="label-text">Manual external ID</span><input
				class="input"
				name="manualExternalId"
				required
				disabled={Boolean(submittingAction)}
			/></label
		>
		<label class="label"
			><span class="label-text">Display name</span><input
				class="input"
				name="displayNameOverride"
				required
				disabled={Boolean(submittingAction)}
			/></label
		>
		<label class="label"
			><span class="label-text">Tier <span class="text-surface-500">(optional)</span></span><input
				class="input"
				type="number"
				name="tierOverride"
				min="1"
				max="5"
				disabled={Boolean(submittingAction)}
			/></label
		>
		<label class="label md:col-span-2 xl:col-span-3"
			><span class="label-text">Manual image <span class="text-surface-500">(optional)</span></span
			><input
				class="input"
				type="file"
				name="image"
				accept="image/png,image/jpeg,image/webp"
				disabled={Boolean(submittingAction)}
			/></label
		>
		<button class="btn preset-filled-primary-500" type="submit" disabled={Boolean(submittingAction)}
			>{submittingAction === 'createCorrection' ? 'Adding…' : 'Add resource'}</button
		>
	</form>
	{#if form?.message && ['createCorrection', 'updateCorrection', 'excludeResource', 'confirmExcludeResource', 'restoreResource'].includes(form.action)}<p
			class="mt-4 rounded-base preset-tonal-error p-3 text-sm"
			role="alert"
		>
			{form.message}
		</p>
	{:else if ['createCorrection', 'updateCorrection', 'confirmExcludeResource', 'restoreResource'].includes(form?.action)}<p
			class="mt-4 rounded-base preset-tonal-success p-3 text-sm"
			role="status"
		>
			Catalog correction saved.
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
				<span class="label label-text preset-tonal-primary" aria-hidden="true">
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
			<div class="max-h-144 table-wrap rounded-container border border-surface-200-800">
				<table class="table table-zebra">
					<thead class="sticky top-0 bg-surface-100-900"
						><tr><th>Icon</th><th>Resource</th><th>Correction</th><th>Actions</th></tr></thead
					><tbody>
						{#each champions as champion (champion.id)}<tr
								><td
									>{#if champion.iconPath}<img
											src={champion.iconPath}
											alt=""
											class="size-9 rounded-base object-cover"
											loading="lazy"
										/>{:else}<span class="text-xs text-surface-500">No image supplied</span
										>{/if}</td
								><td
									><strong>{champion.displayName}</strong><br /><code class="text-xs"
										>{champion.externalId}</code
									><br /><span class="text-xs">Tier {champion.tier ?? '—'}</span></td
								><td
									><span class="badge preset-tonal-surface">{provenance(champion)}</span
									>{#if champion.isExcluded}<br /><span
											class="mt-1 inline-block text-xs text-warning-600-400">Hidden</span
										>{/if}</td
								><td class="space-y-2">
									{#if champion.correctionId}<form
											method="POST"
											action="?/updateCorrection"
											enctype="multipart/form-data"
											use:enhance={trackSubmission(`update:${champion.id}`)}
											class="grid gap-1"
										>
											<input
												type="hidden"
												name="correctionId"
												value={champion.correctionId}
											/><input
												class="input-sm input"
												name="displayNameOverride"
												value={champion.displayName}
												aria-label={`Edit ${champion.displayName} name`}
												disabled={Boolean(submittingAction)}
											/><input
												class="input-sm input"
												type="number"
												name="tierOverride"
												min="1"
												max="5"
												value={champion.tier ?? ''}
												aria-label={`Edit ${champion.displayName} tier`}
												disabled={Boolean(submittingAction)}
											/><input
												class="input-sm input"
												type="file"
												name="image"
												accept="image/png,image/jpeg,image/webp"
												aria-label={`Replace ${champion.displayName} image`}
												disabled={Boolean(submittingAction)}
											/><button
												class="btn preset-tonal-primary btn-sm"
												type="submit"
												disabled={Boolean(submittingAction)}>Save edit</button
											>
										</form>{:else}<form
											method="POST"
											action="?/createCorrection"
											enctype="multipart/form-data"
											use:enhance={trackSubmission(`override:${champion.id}`)}
											class="grid gap-1"
										>
											<input
												type="hidden"
												name="canonicalSetKey"
												value={activeCatalog.snapshot?.canonicalSetKey ?? ''}
											/><input
												type="hidden"
												name="patchLabel"
												value={activeCatalog.snapshot?.patchLabel ?? 'latest'}
											/><input type="hidden" name="resourceKind" value="champion" /><input
												type="hidden"
												name="operation"
												value="override"
											/><input
												type="hidden"
												name="targetExternalId"
												value={champion.externalId}
											/><input
												class="input-sm input"
												name="displayNameOverride"
												value={champion.displayName}
												aria-label={`Override ${champion.displayName} name`}
												disabled={Boolean(submittingAction)}
											/><input
												class="input-sm input"
												type="number"
												name="tierOverride"
												min="1"
												max="5"
												value={champion.tier ?? ''}
												aria-label={`Override ${champion.displayName} tier`}
												disabled={Boolean(submittingAction)}
											/><input
												class="input-sm input"
												type="file"
												name="image"
												accept="image/png,image/jpeg,image/webp"
												aria-label={`Override ${champion.displayName} image`}
												disabled={Boolean(submittingAction)}
											/><button
												class="btn preset-tonal-primary btn-sm"
												type="submit"
												disabled={Boolean(submittingAction)}>Create override</button
											>
										</form>{/if}
									{#if champion.isExcluded}<form
											method="POST"
											action="?/restoreResource"
											use:enhance={trackSubmission(`restore:${champion.id}`)}
										>
											<input type="hidden" name="tournamentId" value={tournament.id} /><input
												type="hidden"
												name="resourceKind"
												value="champion"
											/><input type="hidden" name="resourceId" value={champion.id} /><button
												class="btn preset-tonal-success btn-sm"
												type="submit"
												disabled={Boolean(submittingAction)}>Restore</button
											>
										</form>{:else}<form
											method="POST"
											action="?/excludeResource"
											use:enhance={submitExclude(champion, 'champion')}
										>
											<input type="hidden" name="tournamentId" value={tournament.id} /><input
												type="hidden"
												name="resourceKind"
												value="champion"
											/><input type="hidden" name="resourceId" value={champion.id} /><button
												class="btn preset-tonal-error btn-sm"
												type="submit"
												disabled={Boolean(submittingAction)}>Hide</button
											>
										</form>{/if}
								</td></tr
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
			<div class="max-h-144 table-wrap rounded-container border border-surface-200-800">
				<table class="table table-zebra">
					<thead class="sticky top-0 bg-surface-100-900"
						><tr><th>Icon</th><th>Resource</th><th>Correction</th><th>Actions</th></tr></thead
					><tbody>
						{#each augments as augment (augment.id)}<tr
								><td
									>{#if augment.iconPath}<img
											src={augment.iconPath}
											alt=""
											class="size-9 rounded-base object-cover"
											loading="lazy"
										/>{:else}<span class="text-xs text-surface-500">No image supplied</span
										>{/if}</td
								><td
									><strong>{augment.displayName}</strong><br /><code class="text-xs"
										>{augment.externalId}</code
									><br /><span class="text-xs">Tier {augment.tier ?? '—'}</span></td
								><td
									><span class="badge preset-tonal-surface">{provenance(augment)}</span
									>{#if augment.isExcluded}<br /><span
											class="mt-1 inline-block text-xs text-warning-600-400">Hidden</span
										>{/if}</td
								><td class="space-y-2">
									{#if augment.correctionId}<form
											method="POST"
											action="?/updateCorrection"
											enctype="multipart/form-data"
											use:enhance={trackSubmission(`update:${augment.id}`)}
											class="grid gap-1"
										>
											<input type="hidden" name="correctionId" value={augment.correctionId} /><input
												class="input-sm input"
												name="displayNameOverride"
												value={augment.displayName}
												aria-label={`Edit ${augment.displayName} name`}
												disabled={Boolean(submittingAction)}
											/><input
												class="input-sm input"
												type="number"
												name="tierOverride"
												min="1"
												max="5"
												value={augment.tier ?? ''}
												aria-label={`Edit ${augment.displayName} tier`}
												disabled={Boolean(submittingAction)}
											/><input
												class="input-sm input"
												type="file"
												name="image"
												accept="image/png,image/jpeg,image/webp"
												aria-label={`Replace ${augment.displayName} image`}
												disabled={Boolean(submittingAction)}
											/><button
												class="btn preset-tonal-primary btn-sm"
												type="submit"
												disabled={Boolean(submittingAction)}>Save edit</button
											>
										</form>{:else}<form
											method="POST"
											action="?/createCorrection"
											enctype="multipart/form-data"
											use:enhance={trackSubmission(`override:${augment.id}`)}
											class="grid gap-1"
										>
											<input
												type="hidden"
												name="canonicalSetKey"
												value={activeCatalog.snapshot?.canonicalSetKey ?? ''}
											/><input
												type="hidden"
												name="patchLabel"
												value={activeCatalog.snapshot?.patchLabel ?? 'latest'}
											/><input type="hidden" name="resourceKind" value="augment" /><input
												type="hidden"
												name="operation"
												value="override"
											/><input
												type="hidden"
												name="targetExternalId"
												value={augment.externalId}
											/><input
												class="input-sm input"
												name="displayNameOverride"
												value={augment.displayName}
												aria-label={`Override ${augment.displayName} name`}
												disabled={Boolean(submittingAction)}
											/><input
												class="input-sm input"
												type="number"
												name="tierOverride"
												min="1"
												max="5"
												value={augment.tier ?? ''}
												aria-label={`Override ${augment.displayName} tier`}
												disabled={Boolean(submittingAction)}
											/><input
												class="input-sm input"
												type="file"
												name="image"
												accept="image/png,image/jpeg,image/webp"
												aria-label={`Override ${augment.displayName} image`}
												disabled={Boolean(submittingAction)}
											/><button
												class="btn preset-tonal-primary btn-sm"
												type="submit"
												disabled={Boolean(submittingAction)}>Create override</button
											>
										</form>{/if}
									{#if augment.isExcluded}<form
											method="POST"
											action="?/restoreResource"
											use:enhance={trackSubmission(`restore:${augment.id}`)}
										>
											<input type="hidden" name="tournamentId" value={tournament.id} /><input
												type="hidden"
												name="resourceKind"
												value="augment"
											/><input type="hidden" name="resourceId" value={augment.id} /><button
												class="btn preset-tonal-success btn-sm"
												type="submit"
												disabled={Boolean(submittingAction)}>Restore</button
											>
										</form>{:else}<form
											method="POST"
											action="?/excludeResource"
											use:enhance={submitExclude(augment, 'augment')}
										>
											<input type="hidden" name="tournamentId" value={tournament.id} /><input
												type="hidden"
												name="resourceKind"
												value="augment"
											/><input type="hidden" name="resourceId" value={augment.id} /><button
												class="btn preset-tonal-error btn-sm"
												type="submit"
												disabled={Boolean(submittingAction)}>Hide</button
											>
										</form>{/if}
								</td></tr
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

<ResetRequiredDialog
	open={resetOpen}
	title="Reset saved board before hiding this resource?"
	description={`${pendingResource?.displayName ?? 'This resource'} is selected by the saved winner board. Reset the saved board, then hide the resource from this tournament catalog.`}
	confirmAction="?/confirmExcludeResource"
	hiddenInputs={{
		tournamentId: tournament.id,
		resourceKind: pendingResource?.resourceKind ?? '',
		resourceId: pendingResource?.id ?? ''
	}}
	invokingControl={resetInvoker}
	confirmLabel="Confirm reset and hide"
	enhanceSubmit={confirmExclude}
	onclose={() => (resetOpen = false)}
/>

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
