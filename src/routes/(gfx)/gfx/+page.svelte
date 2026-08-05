<script>
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import WinnerBoardGraphic from '$lib/components/WinnerBoardGraphic.svelte';

	/** @type {import('./$types').PageProps} */
	let { data } = $props();

	onMount(() => {
		let stopped = false;
		let requestInFlight = false;
		let etag = `"gfx-${data.version}"`;

		async function pollVersion() {
			if (stopped || requestInFlight) return;
			requestInFlight = true;
			try {
				const response = await fetch('/gfx/version', {
					headers: { 'If-None-Match': etag },
					cache: 'no-store'
				});
				if (response.status === 200) {
					etag = response.headers.get('etag') ?? etag;
					await invalidateAll();
				}
			} catch {
				// Keep the current graphic and retry on the next interval.
			} finally {
				requestInFlight = false;
			}
		}

		const interval = window.setInterval(pollVersion, 1000);
		return () => {
			stopped = true;
			window.clearInterval(interval);
		};
	});
</script>

<svelte:head>
	<title>TFT Winner Graphic</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<WinnerBoardGraphic board={data.board} />
