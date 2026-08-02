<script>
	let { children } = $props();
</script>

<div class="grid h-screen grid-rows-[auto_1fr]">
	<!-- Header -->
	<!-- <Header /> -->

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
