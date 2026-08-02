<script>
	let { children } = $props();
</script>

<div id="graphics-container">
	{@render children()}
</div>

<style>
	#graphics-container {
		width: 1920px;
		height: 1080px;
	}
</style>
