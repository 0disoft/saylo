<script>
  let { children } = $props();
  let count = $state(0);
</script>
<button onclick={() => count++}>{@render children()} {count}</button>
