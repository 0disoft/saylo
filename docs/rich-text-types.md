# Optional rich text renderer types

Status: included in the stable `0.1.0` release. Vue remains a private workspace package. No runtime rendering behavior
changes with this optional type contract.

## Generate tag contracts

Declare allowed tags for each rich message in the shared configuration:

```json
{
  "localesDir": "locales",
  "baseLocale": "en",
  "richText": {
    "demo": {
      "terms": ["link", "strong"],
      "empty": []
    }
  },
  "typegen": { "outFile": "src/generated.d.ts" }
}
```

Both messages must exist in `locales/en/demo.json`. For example:

```json
{
  "terms": "Read <link>{name}</link> before continuing.",
  "empty": "No markup here."
}
```

Run `saylo-typegen --config saylo.config.json`. The Vite background type generator
uses the same contracts when the plugin reads this configuration. The existing
`AppSchema` still describes translation keys and arguments; an additional export
describes tag names:

```ts
export type AppRichTextSchema = {
  "demo:empty": never;
  "demo:terms": "link" | "strong";
};
```

The union includes every allowed tag, even if the current base text does not use
it. A translation can use a different allowed tag, so strict renderer coverage
requires the complete contract. An empty allowlist becomes `never`. Messages
without explicit rich contracts are omitted; without any rich contracts, typegen
output is unchanged and there is no `AppRichTextSchema` export.

## React

Use the optional type with `satisfies` at the renderer object's declaration:

```tsx
import { renderRichText } from '@0disoft/saylo-react';
import type { StrictRichTextRenderers } from '@0disoft/saylo-react';
import type { AppRichTextSchema } from './generated.js';

const key = 'demo:terms';
const renderers = {
  link: children => <a href="/terms">{children}</a>,
  strong: children => <strong>{children}</strong>,
} satisfies StrictRichTextRenderers<AppRichTextSchema, typeof key>;

// snapshot is the app's existing Saylo snapshot.
renderRichText(snapshot.tParts(key, { name: 'Terms' }), renderers);
```

Omitting `strong` is a type error. Adding a misspelled property such as `lnik` to
this object literal is also a type error. The callback's children and return types
remain React types.

## Svelte

The same type checks snippet maps passed to the existing component:

```svelte
<script lang="ts">
  import RichText from '@0disoft/saylo-svelte/RichText.svelte';
  import type { Snippet } from 'svelte';
  import type { RichTextPart } from '@0disoft/saylo-core';
  import type { StrictRichTextRenderers } from '@0disoft/saylo-svelte';
  import type { AppRichTextSchema } from './generated.js';

  let { parts }: { parts: readonly RichTextPart[] } = $props();
  const renderers = { link, strong } satisfies StrictRichTextRenderers<AppRichTextSchema, 'demo:terms'>;
</script>

{#snippet link(children: Snippet)}
  <a href="/terms">{@render children()}</a>
{/snippet}
{#snippet strong(children: Snippet)}
  <strong>{@render children()}</strong>
{/snippet}

<RichText {parts} {renderers} />
```

Pass the parts from `snapshot.tParts('demo:terms', { name: 'Terms' })` as the
component's `parts` prop. The snippets retain their existing `Snippet<[Snippet]>`
contract.

## Vue

The private Vue adapter exports the same optional type with Vue renderer values:

```ts
import { h } from 'vue';
import { renderRichText } from '@0disoft/saylo-vue';
import type { StrictRichTextRenderers } from '@0disoft/saylo-vue';
import type { AppRichTextSchema } from './generated.js';

const renderers = {
  link: children => h('a', { href: '/terms' }, children),
  strong: children => h('strong', children),
} satisfies StrictRichTextRenderers<AppRichTextSchema, 'demo:terms'>;

renderRichText(snapshot.tParts('demo:terms', { name: 'Terms' }), renderers);
```

## Compatibility and limits

- `RichTextRenderers`, `renderRichText`, `tParts`, and `<RichText>` keep their
  existing signatures. Missing renderers still render the tag's children.
- `StrictRichTextRenderers<AppRichTextSchema, Key>` is a compile-time check chosen
  by the app. It adds no JavaScript, runtime validation, HTML, or attributes.
- Use the contract for the same message whose parts you render. Parts remain an
  unbranded `readonly RichTextPart[]`; this type does not automatically connect a
  renderer map to a later `tParts` call.
- TypeScript checks extra properties on fresh object literals. Check at the
  declaration with `satisfies`; structural assignment of an already declared
  wider object, object spreads, assertions, or `any` can bypass extra-key checks.
- An explicit empty contract accepts `{}` and rejects every renderer property.
  Keys without a rich contract cannot be selected by this type.
- Catalog acceptance still validates allowed tags independently of renderer
  typing. Server and client remain responsible for matching rendering behavior.
