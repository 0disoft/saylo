<script>
  import Child from './Child.svelte';
  import { untrack } from 'svelte';
  let { instance, bindings } = $props();
  untrack(() => bindings.setSayloContext(instance));
</script>
<Child {bindings} />
