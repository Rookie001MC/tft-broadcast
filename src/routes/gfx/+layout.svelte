<script>
    import GraphicsLayout from '$lib/layouts/GraphicsLayout.svelte';

    let { children } = $props();
</script>

<GraphicsLayout>
    {@render children()}
</GraphicsLayout>
