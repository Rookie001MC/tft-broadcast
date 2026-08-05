<script>
	import siteConfig from '$lib/config.js';
	import { setPageMetaContext } from '$lib/context/pageMetaContext.js';
	import Header from '$lib/components/Header.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	/** @import { Snippet } from 'svelte' */

	/**
	 * @type {{ children: Snippet }}
	 */
	let { children } = $props();

	const pageMeta = $state({ title: undefined, description: undefined });
	setPageMetaContext(pageMeta);
	const headerTitle = $derived(pageMeta.title);
	const description = $derived(pageMeta.description);
	const TITLE_SEPARATOR = siteConfig.separator;
</script>

<svelte:head>
	<title>{headerTitle != null ? `${headerTitle} ${TITLE_SEPARATOR} ` : ''}{siteConfig.siteName}</title>
	<meta name="description" content={description ? description : siteConfig.siteDescription} />
</svelte:head>

<!-- Full-height shell: header on top, sidebar + content below -->
<div class="flex h-screen flex-col overflow-hidden">
	<Header {headerTitle} />

	<div class="flex min-h-0 flex-1">
		<Sidebar />
		<main class="flex-1 overflow-y-auto p-6">
			{@render children()}
		</main>
	</div>
</div>
