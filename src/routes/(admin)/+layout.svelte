<script>
	import AdminLayout from '$lib/layouts/AdminLayout.svelte';

	const { children } = $props();
</script>

<AdminLayout>
	{@render children()}
</AdminLayout>
