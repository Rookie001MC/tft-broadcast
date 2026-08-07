<script>
	import { getPageMetaContext } from '$lib/context/pageMetaContext.js';
	import PlayerImportPanel from '$lib/components/admin/PlayerImportPanel.svelte';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';

	let { data, form = null } = $props();

	const pageMeta = getPageMetaContext();
	pageMeta.title = 'Players';
	pageMeta.description = 'Create, import, and review reusable tournament players.';
</script>

<div class="mx-auto max-w-[1500px] space-y-6 pb-16">
	<header>
		<p class="text-sm font-semibold text-primary-600-400">Reusable records</p>
		<h1 class="h1">Players</h1>
		<p class="mt-2 max-w-3xl text-surface-600-400">
			Manage player identities once, then add them to any tournament roster.
		</p>
	</header>

	{#if form?.message}
		<div class="rounded-container preset-tonal-error p-4" role="alert">{form.message}</div>
	{/if}

	<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
		<header class="mb-5">
			<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">Single record</p>
			<h2 class="h3">Create player</h2>
		</header>
		<form
			method="POST"
			action="?/createPlayer"
			class="grid items-end gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]"
		>
			<label class="label"
				><span class="label-text">Full name</span><input
					class="input"
					name="fullName"
					required
				/></label
			>
			<label class="label"
				><span class="label-text">Display name</span><input
					class="input"
					name="displayName"
					required
				/></label
			>
			<label class="label"
				><span class="label-text">Riot ID <span class="text-surface-500">(optional)</span></span
				><input class="input" name="riotId" placeholder="GameName#TAG" /></label
			>
			<button class="btn preset-filled-primary-500" type="submit"
				><UserPlusIcon class="size-4" /> Create player</button
			>
		</form>
	</section>

	<PlayerImportPanel {form} importPreview={data.importPreview} />

	<section class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
		<header class="mb-5 flex items-start justify-between gap-3">
			<div>
				<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">
					Player directory
				</p>
				<h2 class="h3">All players</h2>
			</div>
			<span class="badge preset-tonal-surface">{data.players.length} players</span>
		</header>
		<div class="table-wrap rounded-container border border-surface-200-800">
			<table class="table table-zebra">
				<thead
					><tr
						><th>Display name</th><th>Full name</th><th>Riot ID</th><th>Image</th><th>Updated</th
						></tr
					></thead
				>
				<tbody>
					{#each data.players as player (player.id)}
						<tr
							><td><strong>{player.displayName}</strong></td><td>{player.fullName}</td><td
								>{player.riotId ?? '—'}</td
							><td>{player.imagePath ? 'Managed' : 'None'}</td><td
								>{new Date(player.updatedAt).toLocaleString()}</td
							></tr
						>
					{:else}
						<tr
							><td colspan="5" class="py-10 text-center text-surface-500"
								>No players have been created yet.</td
							></tr
						>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
