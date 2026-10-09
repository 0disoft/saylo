<script>
  import Child from './Child.svelte';
  import SelectedChild from './SelectedChild.svelte';
  import { untrack } from 'svelte';
  let { instance, bindings, selected = false } = $props();
  untrack(() => bindings.setSayloContext(instance));
</script>
{#if selected}<SelectedChild {bindings} />{:else}<Child {bindings} />{/if}
