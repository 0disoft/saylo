<script>
  import { onDestroy, untrack } from 'svelte';
  let { bindings, onSelection = () => {} } = $props();
  const title = untrack(() => bindings.getI18nSelector(snapshot => snapshot.t('demo:title')));
  const off = untrack(() => title.subscribe(onSelection));
  onDestroy(off);
  let note = $state('');
  let count = $state(0);
</script>

<section>
  <h1>{$title}</h1>
  <input aria-label="Note" bind:value={note} />
  <button onclick={() => count++}>{count}</button>
  <dialog open={count > 0}>{$title}</dialog>
</section>
