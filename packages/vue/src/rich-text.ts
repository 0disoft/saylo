import { Fragment, h } from 'vue';
import type { VNodeChild } from 'vue';
import type { RichTextPart } from '@0disoft/saylo-core';

export type RichTextRenderers = Readonly<Record<string, (children: VNodeChild[]) => VNodeChild>>;

/** App-owned mappings supply elements/props; unknown tags retain their text children. */
export function renderRichText(parts: readonly RichTextPart[], renderers: RichTextRenderers = {}): VNodeChild[] {
  const occurrences = new Map<string, number>();
  return parts.map(part => {
    if (part.type === 'text') return part.value;
    const occurrence = occurrences.get(part.name) ?? 0;
    occurrences.set(part.name, occurrence + 1);
    const children = renderRichText(part.children, renderers);
    const renderer = Object.hasOwn(renderers, part.name) ? renderers[part.name] : undefined;
    // Text insertion does not renumber tag keys. The mapped component owns its state.
    return h(Fragment, { key: `${part.name}:${occurrence}` },
      typeof renderer === 'function' ? [renderer(children)] : children);
  });
}
