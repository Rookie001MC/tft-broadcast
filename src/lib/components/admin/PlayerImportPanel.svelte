<script>
	import { enhance } from '$app/forms';
	import CheckCircleIcon from '@lucide/svelte/icons/circle-check';
	import UploadIcon from '@lucide/svelte/icons/upload';

	let { form = null, importPreview = null } = $props();
	/** @type {string | null} */
	let submittingAction = $state(null);
	let currentTime = $state(Date.now());

	const importState = $derived(importPreview);
	const expiresAt = $derived(importState?.expiresAt ? new Date(importState.expiresAt) : null);
	const expiredByTime = $derived(Boolean(expiresAt && expiresAt.getTime() <= currentTime));

	/** @param {number | null} deadline @returns {import('svelte/attachments').Attachment<HTMLElement>} */
	function expireAtDeadline(deadline) {
		return () => {
			if (!deadline) return;
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				currentTime = Date.now();
				return;
			}
			const timeout = setTimeout(() => {
				currentTime = Date.now();
			}, remaining + 1);
			return () => clearTimeout(timeout);
		};
	}
	const terminalStatus = $derived(
		importState?.status === 'previewed' && expiredByTime
			? 'expired'
			: (importState?.status ?? 'missing')
	);
	const preview = $derived(terminalStatus === 'previewed' ? (importState?.preview ?? null) : null);
	const canConfirm = $derived(
		Boolean(preview?.canCommit && importState?.token && !expiredByTime && !submittingAction)
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

	/** @param {Array<{ path: string }>} images */
	function imagePaths(images) {
		return images.map((image) => image.path).join(', ');
	}
</script>

<section
	id="imports"
	class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5"
	{@attach expireAtDeadline(expiresAt?.getTime() ?? null)}
>
	<header class="mb-5">
		<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">Reusable players</p>
		<h2 class="h3">ZIP import preview</h2>
		<p class="mt-1 text-sm text-surface-600-400">
			Upload a bundle containing <code>players.csv</code> and optional Riot-ID-named images.
		</p>
	</header>

	<form
		method="POST"
		action="?/previewBundle"
		enctype="multipart/form-data"
		use:enhance={trackSubmission('previewBundle')}
		class="flex flex-wrap items-end gap-3"
	>
		<label class="label min-w-64 flex-1">
			<span class="label-text">Player bundle (.zip, max 60 MiB)</span>
			<input
				class="input"
				type="file"
				name="bundle"
				accept=".zip,application/zip"
				required
				disabled={Boolean(submittingAction)}
			/>
		</label>
		<button class="btn preset-tonal-primary" type="submit" disabled={Boolean(submittingAction)}>
			<UploadIcon class="size-4" />
			{submittingAction === 'previewBundle' ? 'Previewing…' : 'Preview bundle'}
		</button>
	</form>

	{#if form?.message && ['previewBundle', 'commitBundle'].includes(form.action)}
		<p class="mt-4 rounded-base preset-tonal-error p-3 text-sm" role="alert">{form.message}</p>
	{/if}

	{#if terminalStatus === 'committed'}
		<div class="mt-5 rounded-container preset-tonal-success p-4" role="status">
			<strong>Import committed</strong>
			<p class="mt-1 text-sm">
				{importState?.summary?.created ?? 0} created · {importState?.summary?.updated ?? 0} updated ·
				{importState?.summary?.skipped ?? 0} skipped
			</p>
			{#if importState?.committedAt}<p class="mt-1 text-xs">
					Committed {new Date(importState.committedAt).toLocaleString()}
				</p>{/if}
		</div>
	{:else if ['expired', 'unavailable', 'missing'].includes(terminalStatus)}
		<div class="mt-5 rounded-container preset-tonal-warning p-4" role="status">
			<strong
				>{terminalStatus === 'expired'
					? 'Preview expired'
					: terminalStatus === 'unavailable'
						? 'Staged file unavailable'
						: 'No active preview'}</strong
			>
			<p class="mt-1 text-sm">
				Upload the ZIP again to create a new exact preview before importing.
			</p>
		</div>
	{:else if preview}
		<div class="mt-5 space-y-4">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="flex gap-2">
					<span
						class:badge-success={preview.canCommit}
						class:badge-error={!preview.canCommit}
						class="badge">{preview.canCommit ? 'Ready to commit' : 'Needs attention'}</span
					>
					<span class="badge preset-tonal-surface">{preview.rows.length} rows</span>
				</div>
				{#if expiresAt}<span class="text-xs text-surface-500"
						>Expires {expiresAt.toLocaleString()}</span
					>{/if}
			</div>

			{#if preview.errors.length}
				<div class="rounded-container preset-tonal-error p-4">
					<strong>Import errors</strong>
					<ul class="mt-2 list-disc space-y-1 pl-5 text-sm">
						{#each preview.errors as issue, index (`${issue.code}-${index}`)}<li>
								{issue.message ?? issue.code}{issue.row ? ` (row ${issue.row})` : ''}
							</li>{/each}
					</ul>
				</div>
			{/if}

			<div
				class="max-h-80 table-wrap overflow-auto rounded-container border border-surface-200-800"
			>
				<table class="table text-sm">
					<thead
						><tr><th>Row</th><th>Player</th><th>Riot ID</th><th>Image</th><th>Action</th></tr
						></thead
					>
					<tbody>
						{#each preview.rows as row (row.rowNumber)}
							<tr
								><td>{row.rowNumber}</td><td
									><strong>{row.displayName}</strong><br /><span class="text-xs text-surface-500"
										>{row.fullName}</span
									></td
								><td>{row.riotId}</td><td>{row.image ? row.image.path : 'No match'}</td><td
									><span class="badge preset-tonal-surface">{row.action}</span></td
								></tr
							>
						{/each}
					</tbody>
				</table>
			</div>

			{#if preview.unmatchedImages.length}<p class="text-sm text-surface-600-400">
					Unmatched images: {imagePaths(preview.unmatchedImages)}
				</p>{/if}
			{#if preview.canCommit}
				<form method="POST" action="?/commitBundle" use:enhance={trackSubmission('commitBundle')}>
					<input type="hidden" name="token" value={importState?.token ?? ''} />
					<button class="btn preset-filled-success-500" type="submit" disabled={!canConfirm}>
						<CheckCircleIcon class="size-4" />
						{submittingAction === 'commitBundle' ? 'Committing…' : 'Confirm exact preview'}
					</button>
				</form>
			{/if}
		</div>
	{/if}
</section>
