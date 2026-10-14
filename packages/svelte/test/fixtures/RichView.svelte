<script>
  import { createSvelteStore } from '@0disoft/saylo-svelte';
  import { untrack } from 'svelte';
  import RichText from '@0disoft/saylo-svelte/RichText.svelte';
  import RichCounter from './RichCounter.svelte';
  const { instance, renderers, name = '<img src=x>' } = $props();
  const i18n = untrack(() => createSvelteStore(instance));
</script>
{#snippet strong(children)}<strong>{@render children()}</strong>{/snippet}
{#snippet link(children)}<a href="#order">{@render children()}</a>{/snippet}
{#snippet counter(children)}<RichCounter {children} />{/snippet}
<p><RichText parts={$i18n.tParts('rich:message', { name })} renderers={renderers ?? { strong, link, counter }} /></p>
