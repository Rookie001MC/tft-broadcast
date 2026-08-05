<script>
	let { children } = $props();
</script>

<div id="graphics-container">
	{@render children()}
</div>

<style>
	:global(html),
	:global(body) {
		width: 1920px;
		height: 1080px;
		margin: 0;
		overflow: hidden;
		background: transparent !important;
	}

	#graphics-container {
		width: 1920px;
		height: 1080px;
		overflow: hidden;
		background: transparent;
	}
</style>
