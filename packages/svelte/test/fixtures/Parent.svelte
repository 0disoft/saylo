<script>
  import Child from './Child.svelte';
  import SelectedChild from './SelectedChild.svelte';
  import Nested from './Nested.svelte';
  import { primary } from './bindings.mjs';
  import { untrack } from 'svelte';
  let { instance, other, bindings = primary, childBindings = primary, selected = false, onSelection } = $props();
  untrack(() => bindings.setSayloContext(instance));
</script>

{#if selected}<SelectedChild bindings={childBindings} {onSelection} />{:else}<Child bindings={childBindings} />{/if}
{#if other}<Nested instance={other} {bindings} {selected} />{/if}
