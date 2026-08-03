<script>
	import AdminLayout from '$lib/layouts/AdminLayout.svelte';
    import "./layout.css";

	const { children } = $props();
</script>

<AdminLayout>
	{@render children()}
</AdminLayout>
