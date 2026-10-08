<script>
  import Child from './Child.svelte';
  import Nested from './Nested.svelte';
  import { primary } from './bindings.mjs';
  import { untrack } from 'svelte';
  let { instance, other, bindings = primary, childBindings = primary } = $props();
  untrack(() => bindings.setSayloContext(instance));
</script>

<Child bindings={childBindings} />
{#if other}<Nested instance={other} {bindings} />{/if}
