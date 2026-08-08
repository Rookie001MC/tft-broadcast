<script>
	import { resolve } from '$app/paths';
	import RadioIcon from '@lucide/svelte/icons/radio';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	let { tournamentId = '', savedBoard, livePublicationId, form = null } = $props();

	/** @param {string} name */
	function actionUrl(name) {
		return `?tournament=${encodeURIComponent(tournamentId)}&/${name}`;
	}
</script>

<section id="live" class="card preset-outlined-surface-200-800 bg-surface-50-950 p-5">
	<header class="mb-5 flex flex-wrap items-start justify-between gap-3">
		<div>
			<p class="text-xs font-bold tracking-wider text-primary-600-400 uppercase">
				Broadcast output
			</p>
			<h2 class="h3">Live controls</h2>
			<p class="mt-1 text-sm text-surface-600-400">
				Publish only after preview. Hiding returns every open /gfx source to transparent.
			</p>
		</div>
		{#if livePublicationId}<span class="badge preset-tonal-success">Live publication</span
			>{:else}<span class="badge preset-tonal-surface">Transparent</span>{/if}
	</header>

	<div class="flex flex-wrap gap-3">
		<form method="POST" action={actionUrl('setLive')}>
			<input type="hidden" name="enabled" value="true" />
			<button class="btn preset-filled-success-500" type="submit" disabled={!savedBoard}
				><RadioIcon class="size-4" /> Take saved board live</button
			>
		</form>
		<form method="POST" action={actionUrl('setLive')}>
			<input type="hidden" name="enabled" value="false" />
			<button class="btn preset-tonal-error" type="submit" disabled={!livePublicationId}
				><EyeOffIcon class="size-4" /> Hide live graphic</button
			>
		</form>
		<form method="POST" action={actionUrl('resetBoard')}>
			<button class="btn preset-tonal-error" type="submit" disabled={!savedBoard}
				><TrashIcon class="size-4" /> Reset saved board</button
			>
		</form>
		<a class="btn preset-tonal-surface" href={resolve('/gfx')} target="_blank" rel="noreferrer"
			><ExternalLinkIcon class="size-4" /> Open /gfx</a
		>
	</div>

	{#if form?.action && ['setLive', 'resetBoard'].includes(form.action) && form.message}
		<p class="mt-4 rounded-base preset-tonal-error p-3 text-sm">{form.message}</p>
	{/if}
</section>
