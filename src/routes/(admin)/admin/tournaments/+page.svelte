<script>
	import { resolve } from '$app/paths';
	import { getPageMetaContext } from '$lib/context/pageMetaContext.js';
	import RosterManager from '$lib/components/admin/RosterManager.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';

	let { data, form = null } = $props();

	const pageMeta = getPageMetaContext();
	pageMeta.title = 'Tournaments';
	pageMeta.description = 'Create tournaments and manage their ordered player rosters.';
</script>

<div class="mx-auto max-w-[1500px] space-y-6 pb-16">
	<header>
		<p class="text-sm font-semibold text-primary-600-400">Event management</p>
		<h1 class="h1">Tournaments</h1>
		<p class="mt-2 max-w-3xl text-surface-600-400">
			Create event scopes and manage each tournament's ordered roster.
		</p>
	</header>

	{#if form?.action === 'createTournament' && form.message}<div
			class="rounded-container preset-tonal-error p-4"
			role="alert"
		>
			{form.message}
		</div>{/if}

	<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
		<header class="mb-5">
			<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">New event</p>
			<h2 class="h3">Create tournament</h2>
		</header>
		<form method="POST" action="?/createTournament" class="flex max-w-2xl items-end gap-3">
			<label class="label min-w-0 flex-1"
				><span class="label-text">Tournament name</span><input
					class="input"
					name="name"
					required
					maxlength="100"
					placeholder="HCMUSEC TFT Finals"
				/></label
			>
			<button class="btn preset-filled-primary-500" type="submit"
				><PlusIcon class="size-4" /> Create</button
			>
		</form>
	</section>

	<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
		<header class="mb-5 flex items-start justify-between gap-3">
			<div>
				<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">
					Event directory
				</p>
				<h2 class="h3">All tournaments</h2>
			</div>
			<span class="badge preset-tonal-surface">{data.tournaments.length} tournaments</span>
		</header>
		<div class="table-wrap rounded-container border border-surface-200-800">
			<table class="table table-zebra">
				<thead
					><tr
						><th>Name</th><th>Slug</th><th>Catalog</th><th>Updated</th><th
							><span class="sr-only">Manage</span></th
						></tr
					></thead
				>
				<tbody>
					{#each data.tournaments as tournament (tournament.id)}
						<tr class:preset-tonal-primary={tournament.id === data.selectedTournament?.id}
							><td><strong>{tournament.name}</strong></td><td><code>{tournament.slug}</code></td><td
								>{tournament.activeCatalogSnapshotId ? 'Pinned' : 'Not synced'}</td
							><td>{new Date(tournament.updatedAt).toLocaleString()}</td><td class="text-right"
								><a
									class="btn preset-tonal-primary btn-sm"
									href={resolve(
										/** @type {any} */ (
											`/admin/tournaments?tournament=${encodeURIComponent(tournament.id)}`
										)
									)}>Manage roster</a
								></td
							></tr
						>
					{:else}<tr
							><td colspan="5" class="py-10 text-center text-surface-500"
								>No tournaments have been created yet.</td
							></tr
						>{/each}
				</tbody>
			</table>
		</div>
	</section>

	{#if data.selectedTournament}
		<RosterManager
			tournament={data.selectedTournament}
			players={data.players}
			roster={data.roster}
			{form}
		/>
	{/if}
</div>
