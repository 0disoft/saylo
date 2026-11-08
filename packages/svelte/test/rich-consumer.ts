import RichText from '@0disoft/saylo-svelte/RichText.svelte';
import type { Component, Snippet } from 'svelte';
import type { RichTextProps, RichTextRenderers, StrictRichTextRenderers } from '@0disoft/saylo-svelte';
import type { Translator } from '@0disoft/saylo-core';
import type { AppRichTextSchema } from '../../typegen/test/rich-generated.js';

const component: Component<RichTextProps> = RichText;
declare const strong: Snippet<[Snippet]>;
declare const link: Snippet<[Snippet]>;

const strictRenderers = { strong, link } satisfies StrictRichTextRenderers<AppRichTextSchema, 'demo:terms'>;
const strictProps: RichTextProps = { parts: [], renderers: strictRenderers };
const legacyProps: RichTextProps = { parts: [], renderers: {} };
// @ts-expect-error all allowed tags need snippets
const missingRenderer: StrictRichTextRenderers<AppRichTextSchema, 'demo:terms'> = { link };
const unknownRenderer = { ...strictRenderers,
  // @ts-expect-error misspelled tags are rejected on object literals
  lnik: link,
} satisfies StrictRichTextRenderers<AppRichTextSchema, 'demo:terms'>;
const emptyRenderers = {} satisfies StrictRichTextRenderers<AppRichTextSchema, 'demo:empty'>;
const forbiddenRenderer = {
  // @ts-expect-error an empty rich contract permits no renderer names
  link,
} satisfies StrictRichTextRenderers<AppRichTextSchema, 'demo:empty'>;
// @ts-expect-error messages without explicit rich contracts cannot select strict renderers
type NoContract = StrictRichTextRenderers<AppRichTextSchema, 'demo:literal'>;
void strictProps; void legacyProps; void missingRenderer; void unknownRenderer; void emptyRenderers; void forbiddenRenderer;
declare const snapshot: Translator<{ 'demo:rich': { name: string } }>;
const props: RichTextProps = { parts: snapshot.tParts('demo:rich', { name: 'Ada' }), renderers: { strong } };
void component; void props;
// @ts-expect-error component parts retain base argument types
snapshot.tParts('demo:rich', { name: false });
// @ts-expect-error element names cannot replace typed Svelte snippets
const badRenderers: RichTextRenderers = { strong: 'strong' };
void badRenderers;
