<script>
  import { untrack } from 'svelte';
  let { bindings } = $props();
  const i18n = untrack(() => bindings.getI18n());
  let note = $state('');
  let count = $state(0);
</script>

<section>
  <h1>{$i18n.t('demo:title')}</h1>
  <input aria-label="Note" bind:value={note} />
  <button onclick={() => count++}>{count}</button>
  <dialog open={count > 0}>{$i18n.t('demo:title')}</dialog>
</section>
