import RichText from '@0disoft/saylo-svelte/RichText.svelte';

/** @type {import('svelte').Component<import('@0disoft/saylo-svelte').RichTextProps>} */
const component = RichText;
void component;
/** @type {import('@0disoft/saylo-svelte').RichTextRenderers} */
// @ts-expect-error typed JS rejects element names instead of snippets
const badRenderers = { strong: 'strong' };
void badRenderers;
