# 80. Svelte rich-text component (`RichText.svelte`)

This document defines the contract and demo for `RichText.svelte`, which renders parts returned by core `tParts` as a Svelte 5 component. Core `tParts` remains unchanged, and the Svelte package adds the component and types.

Status: the component is stored in local commit `010a600`; demo integration and the validation below are complete. Published build `0.1.0-alpha.4` does not contain this component. Version promotion and publication remain deferred.

## Scope

- Expose the `@0disoft/saylo-svelte/RichText.svelte` subpath as a separate default import.
- The root entry keeps the store API and exports only the `RichTextProps` and `RichTextRenderers` types. Root imports work in Node SSR without compiling Svelte.
- Input is the read-only `RichTextPart[]` returned by core `tParts`. Argument and required-argument validation, base-locale fallback, source locale, and timezone contracts match core. The component builds nodes only from supplied parts and renderers.
- This document covers the Svelte component. Vue is covered by the linked document below. It does not support automatic HTML rendering or creating attributes and URLs from parts.

## Installation and imports

```ts
// App components use a default import from the subpath.
import RichText from '@0disoft/saylo-svelte/RichText.svelte';
// Import from the root entry when only types are needed.
import type { RichTextProps, RichTextRenderers } from '@0disoft/saylo-svelte';
```

`RichText.svelte` is a Svelte component compiled by the consumer, so it has a separate import path. The root entry (`@0disoft/saylo-svelte`) is the store API and imports unchanged in Node SSR without compilation.

## API

```ts
import type { Snippet } from 'svelte';
import type { RichTextPart } from '@0disoft/saylo-core';

type RichTextRenderers = Readonly<Record<string, Snippet<[Snippet]>>>;

interface RichTextProps {
  readonly parts: readonly RichTextPart[];
  readonly renderers?: RichTextRenderers;
}
```

- Pass the value returned by core `tParts` directly as `parts`.
- If `renderers` is omitted, it is treated as an empty object. Each value is a snippet that receives one child-renderer `Snippet` as its argument.

## Rendering contract

- A text part becomes template text. Svelte escapes it, so it is not interpreted as HTML. The component does not use `{@html}`.
- A tag part is rendered with a snippet only when its name is an own property of `renderers` and the value is a snippet. If absent or not a snippet, no tag is created and only its children are rendered.
- Lookup checks own properties only (`Object.hasOwn`). Names inherited from the prototype, such as `constructor` and `toString`, are not used as mappings; only their children are rendered.
- It does not create arbitrary DOM tags, HTML, attributes, or URLs from catalog names. Links, attributes, and URLs are attached only for names the app includes in its renderers.
- Nested tags are supported. Inner tags follow the same mapping rules, and the component renders them recursively.
- The only HTML the component creates comes from snippets supplied by the app. Saylo does not create tags or HTML from translation names.
- Core leaves opening markers with attributes and self-closing markers (`<br/>`) as literal text. If an opening marker is literal, an unmatched closing marker triggers `InvalidRichTextError` ([78-rich-text-parts.md](78-rich-text-parts.md)). Mismatched or unclosed structures also error. Core `tParts` makes this determination, and the component receives only valid parts.

## Keys and identity

The component renders parts as a keyed list. Keys combine the tag name with its occurrence number.

```ts
// parts:  [{ type: 'tag', name: 'link', ... }, { type: 'tag', name: 'link', ... }]
// keys:   ['tag:link:0', 'tag:link:1']
```

- A second tag with the same name gets a different key from the first. Inserting or editing text or literals keeps mapped node identity intact.
- Renderer snippets must keep the same type for a given tag. If the type changes, the node is recreated and input, focus, and state are lost.

## Usage example

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import RichText from '@0disoft/saylo-svelte/RichText.svelte';
  import { getI18n } from './i18n';

  let { name = 'Saylo' }: { name?: string } = $props();
  const i18n = getI18n();
</script>

{#snippet strong(children: Snippet)}
  <strong>{@render children()}</strong>
{/snippet}

{#snippet link(children: Snippet)}
  <a href="#order-form">{@render children()}</a>
{/snippet}

<RichText parts={$i18n.tParts('demo:rich', { name })} renderers={{ strong, link }} />
```

The snippet argument is the mapped child renderer. The app uses `{@render children()}` to render inner parts there. Names absent from renderers render only their children, so inner text continues without a wrapper.

## Distribution format

- The tarball includes the `dist/RichText.svelte` source, helper JS (`dist/rich-text.js`), and type declarations (`dist/rich-text.d.ts` and `dist/rich-text-component.d.ts`). The helper exports `keyedRichTextParts`, which builds keys.
- `dist/RichText.svelte` ships as source for the consumer's Svelte 5 compiler. It works unchanged with existing Svelte 5 and `@sveltejs/vite-plugin-svelte` 7 setups.
- To SSR the component in Node, consumers compile `RichText.svelte` with the Svelte compiler. The root API, which uses only the store, imports without compilation.

## Demo (rich-preview)

- Add rich keys to `examples/svelte/locales/ko/demo.json` and `en/demo.json`. The Korean text uses `<strong>{name}</strong>` for a polite name prefix and `<link>` for the phrase asking the user to review the order they entered; the English text is `<strong>{name}</strong>, review <link>your order</link>.`, matching the React demo.
- `Preview.svelte` adds the `rich-preview` paragraph. It maps `strong` to `<strong>` and `link` to a link to the order form on the same page (`#order-form`). It uses `Saylo` when the name input is empty.
- `projectDemoMessages` includes rich parts in the last-good full translation projection. After malformed rich markup, changes to the name, quantity, or other input reformat the last good snapshot with current arguments.
- Keep the existing commands: `npm run dev:svelte`, `npm run build:svelte`, `npm run verify:demo:svelte:recovery`, `npm run check`, and `npm run verify:pack`.

## Validation

Verified locally (2026-10-14, local client):

- The component implementation is stored in local commit `010a600`.
- All 15 `packages/svelte` tests and 5 child client runs (including 2 new rich-state and hydration tests) passed. The 15 root and 5 nested runs are counted separately. Compiled SSR verified nested mapping, HTML escaping of argument text, unknown and prototype-inherited tags rendering children only, and a client with repeated same-name nodes preserving each node's state and identity.
- Running SvelteKit example `svelte-check` with `--workspace packages/svelte --no-tsconfig --ignore dist,test --fail-on-warnings` reported 0 errors and 0 warnings.
- JS and TS consumer typechecks and package-boundary checks passed.
- Running the same checker on the demo with `--workspace examples/svelte --no-tsconfig --ignore dist --fail-on-warnings` reported 0 errors and 0 warnings.
- The demo was newly connected and uses the generated schema, name fallback, and parts on screen.
- The HeadlessChrome 154 recovery check passed: 11 warm cases (including 4 rich-related cases) and 3 cold cases, with no browser errors (`errors[]`). Log: `.release/svelte-rich-recovery.log`.
- SSR verified hydration of matching markup and subsequent live-snapshot updates.
- Full `npm run check` exited 0: 294 tests and builds and consumer typechecks for six workspaces passed (log `.release/svelte-rich-check.log`). The 5 child client runs are a separate execution count noted above.
- Demo TypeScript checks and the Vite 8.3.4 production build passed.
- `npm exec -- node scripts/pack-smoke.mjs` exited 0: independent JS and TS installs of all five tarballs checked the new component declarations, compiled shipped Svelte source with the consumer compiler, and verified nested snippets, string escaping, and SSR. Existing root store, selector, React, and Vite consumption also passed (log `.release/svelte-rich-pack.log`).

## Next steps

The Svelte component is in local commit `010a600`, and local changes connect the demo. The remaining Vue render helper and Vue demo were also implemented locally. Unlike this Svelte component, Vue uses pure TypeScript `renderRichText` from the root entry without SFC compilation or a subpath. The contract is in the [@0disoft/saylo-vue README](../packages/vue/README.md); demo integration and validation are in the [Vue demo](../examples/vue/README.md). None is published yet, and version promotion and publication remain deferred.
