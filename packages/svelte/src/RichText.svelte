<script lang="ts">
  import RichText from './RichText.svelte';
  import { keyedRichTextParts } from './rich-text.js';
  import type { RichTextProps } from './rich-text.js';

  let { parts, renderers = {} }: RichTextProps = $props();
  const entries = $derived(keyedRichTextParts(parts));
</script>

{#each entries as entry (entry.key)}
  {#if entry.part.type === 'text'}
    {entry.part.value}
  {:else}
    {@const part = entry.part}
    {@const renderer = Object.hasOwn(renderers, part.name) ? renderers[part.name] : undefined}
    {#snippet children()}<RichText parts={part.children} {renderers} />{/snippet}
    {#if typeof renderer === 'function'}
      {@render renderer(children)}
    {:else}
      {@render children()}
    {/if}
  {/if}
{/each}
