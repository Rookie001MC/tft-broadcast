<script>
	import AdminLayout from '$lib/layouts/AdminLayout.svelte';

	let { children } = $props();
</script>

<AdminLayout>
	{@render children()}
</AdminLayout>
