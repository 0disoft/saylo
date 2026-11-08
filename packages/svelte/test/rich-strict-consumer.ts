import type { Snippet } from 'svelte';
import type { RichTextProps, StrictRichTextRenderers } from '@0disoft/saylo-svelte';
import type { AppRichTextSchema } from '../../typegen/test/rich-generated.js';

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
