<script>
	import siteConfig from '$lib/config.js';
	import {getPageMetaContext, setPageMetaContext} from "$lib/context/pageMetaContext.js";
	/** @import { Snippet } from 'svelte' */

	/**
	 * @type {{ children: Snippet}}
	 */
	let { children } = $props();

	import Header from "$lib/components/Header.svelte"

	const pageMeta = $state({title: undefined, description: undefined})
	setPageMetaContext(pageMeta);
	const headerTitle = $derived(pageMeta.title)
	const description = $derived(pageMeta.description)
	const TITLE_SEPERATOR = '-'
</script>

<svelte:head>
	<title>{headerTitle != null ? `${headerTitle} ${TITLE_SEPERATOR} ` : ''}{siteConfig.siteName}</title>
	<meta name="description" content={  description ? description : siteConfig.siteDescription} />
</svelte:head>

<div class="grid h-screen grid-rows-[auto_1fr]">
	<!-- Header -->
	<Header {headerTitle} /><!-- <Header /> -->

	<!-- Body Grid -->
	<div class="grid grid-cols-[auto_1fr]">
		<!-- Sidebar -->
		<!-- <Sidebar /> -->

		<!-- Content -->
		<main class="">
			{@render children()}
		</main>
	</div>
</div>
