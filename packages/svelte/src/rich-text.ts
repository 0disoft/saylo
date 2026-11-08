import type { Snippet } from 'svelte';
import type { RichTextPart } from '@0disoft/saylo-core';

export type RichTextRenderers = Readonly<Record<string, Snippet<[Snippet]>>>;

/** Opt-in renderer coverage for one message's generated rich tag contract. */
export type StrictRichTextRenderers<S extends Record<string, string>, K extends keyof S> =
  [S[K]] extends [never] ? Readonly<Record<string, never>> : Readonly<Record<S[K], RichTextRenderers[string]>>;

export interface RichTextProps {
  readonly parts: readonly RichTextPart[];
  readonly renderers?: RichTextRenderers;
}

/** Tag occurrence keys stay stable when literal text is inserted between tags. */
export function keyedRichTextParts(parts: readonly RichTextPart[]) {
  const occurrences = new Map<string, number>();
  return parts.map((part, index) => {
    if (part.type === 'text') return { key: `text:${index}`, part };
    const occurrence = occurrences.get(part.name) ?? 0;
    occurrences.set(part.name, occurrence + 1);
    return { key: `tag:${part.name}:${occurrence}`, part };
  });
}
