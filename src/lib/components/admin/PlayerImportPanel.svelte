<script>
	import UploadIcon from '@lucide/svelte/icons/upload';
	import CheckCircleIcon from '@lucide/svelte/icons/circle-check';

	let { form = null, importPreview = null } = $props();

	const token = $derived(form?.action === 'previewBundle' ? form.token : importPreview?.token);
	const preview = $derived(
		form?.action === 'previewBundle' ? form.preview : (importPreview?.preview ?? null)
	);
	const expiresAt = $derived(importPreview?.expiresAt ? new Date(importPreview.expiresAt) : null);
	const expired = $derived(Boolean(expiresAt && expiresAt.getTime() <= Date.now()));

	/** @param {Array<{ path: string }>} images */
	function imagePaths(images) {
		return images.map((image) => image.path).join(', ');
	}
</script>

<section id="imports" class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
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
		class="flex flex-wrap items-end gap-3"
	>
		<label class="label min-w-64 flex-1">
			<span class="label-text">Player bundle (.zip, max 25 MiB)</span>
			<input class="input" type="file" name="bundle" accept=".zip,application/zip" required />
		</label>
		<button class="btn preset-tonal-primary" type="submit"
			><UploadIcon class="size-4" /> Preview bundle</button
		>
	</form>

	{#if preview}
		<div class="mt-5 space-y-4">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="flex gap-2">
					<span
						class:badge-success={preview.canCommit}
						class:badge-error={!preview.canCommit}
						class="badge"
					>
						{preview.canCommit ? 'Ready to commit' : 'Needs attention'}
					</span>
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
						{#each preview.errors as issue, index (`${issue.code}-${index}`)}
							<li>{issue.message ?? issue.code}{issue.row ? ` (row ${issue.row})` : ''}</li>
						{/each}
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
							<tr>
								<td>{row.rowNumber}</td>
								<td
									><strong>{row.displayName}</strong><br /><span class="text-xs text-surface-500"
										>{row.fullName}</span
									></td
								>
								<td>{row.riotId}</td>
								<td>{row.image ? row.image.path : 'No match'}</td>
								<td><span class="badge preset-tonal-surface">{row.action}</span></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if preview.unmatchedImages.length}
				<p class="text-sm text-surface-600-400">
					Unmatched images: {imagePaths(preview.unmatchedImages)}
				</p>
			{/if}

			<form method="POST" action="?/commitBundle">
				<input type="hidden" name="token" value={token ?? ''} />
				<button
					class="btn preset-filled-success-500"
					type="submit"
					disabled={!preview.canCommit || expired || !token}
				>
					<CheckCircleIcon class="size-4" /> Confirm exact preview
				</button>
			</form>
		</div>
	{/if}
</section>
