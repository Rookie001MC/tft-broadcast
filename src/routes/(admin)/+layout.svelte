<script>
	import "./layout.css";
	import siteConfig from "$lib/config.js";
	import { setPageMetaContext } from "$lib/context/pageMetaContext";
	const { children } = $props();
	const pageMeta = $state({ title: undefined, description: undefined });
	setPageMetaContext(pageMeta);
	const headerTitle = $derived(pageMeta.title);
	const description = $derived(pageMeta.description);

</script>


<svelte:head>
	<title>{headerTitle != null ? `${headerTitle} ${siteConfig.separator} ` : ''}{siteConfig.siteName}</title>
	<meta name="description" content={description ? description : siteConfig.siteDescription} />
</svelte:head>

{@render children()}
