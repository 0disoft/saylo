# 79. React rich-text rendering (`renderRichText`)

This document defines the contract and demo for a render helper that draws parts returned by core `tParts` as React nodes. Core `tParts` remains unchanged, and the React package adds `renderRichText(parts, renderers)`.

Status: local implementation and the validation below are complete. This helper is absent from published builds. Version promotion and publication remain deferred.

## Scope

- `@0disoft/saylo-react` exports `renderRichText` and the `RichTextRenderers` type.
- Input is the read-only `RichTextPart[]` returned by core `tParts`. Argument and required-argument validation, base-locale fallback, source locale, and timezone contracts match core. Hooks use `tParts` from the existing snapshot.
- The helper is a pure function. It reads no props, state, or store and builds nodes only from the supplied parts and renderers.
- This document covers the React helper. Svelte and Vue implementations are covered by the linked documents below. It does not support automatic HTML rendering or creating attributes and URLs from parts.

## API

```ts
type RichTextRenderers = Readonly<Record<string, (children: ReactNode) => ReactNode>>;

function renderRichText(parts: readonly RichTextPart[], renderers?: RichTextRenderers): ReactNode;
```

If `renderers` is omitted, it is treated as an empty object.

## Rendering contract

- A text part becomes React text unchanged. React escapes it, so it is not interpreted as HTML.
- A tag part becomes the function's result only when its name is an own property of `renderers` and the value is a function. If absent or not a function, the helper creates no tag and renders only its children.
- Function lookup checks own properties only. Names inherited from the prototype, such as `constructor` and `toString`, are not used as mappings; only their children are rendered.
- It does not create arbitrary DOM tags, HTML, attributes, or URLs from catalog names. Links, attributes, and URLs are attached only for names the app places in its own map.
- Nested tags are supported, and inner tags follow the same mapping rules.
- Opening markers with attributes and self-closing markers (`<br/>`) remain literal text rather than structure. If an opening marker is literal, an unmatched closing marker can trigger `InvalidRichTextError`. Mismatched or unclosed structures also error. Core `tParts` makes this determination; the helper receives only valid parts.

## Keys and identity

Fragment keys combine the tag name with its occurrence number (`link:0`, `link:1`). A second tag with the same name gets a different key from the first. Inserting or editing text or literals keeps mapped component identity intact.

Renderer callbacks must return the same element or component type for a given tag. If the type changes, React remounts it and input, focus, and state are lost.

## Demo (rich-preview)

Add rich keys to the shared catalogs `examples/vanilla/locales/ko/demo.json` and `en/demo.json`.

```json
{ "rich": "<strong>{name}</strong>님, <link>입력한 주문</link>을 확인해 주세요." }
```

```json
{ "rich": "<strong>{name}</strong>, review <link>your order</link>." }
```

The React demo maps `strong` to `<strong>` and `link` to `<a href="#order-form">`. The preview node's id is `rich-preview`, and the link goes to the order form on the same page (`#order-form`). The display uses `Saylo` when the name input is empty.

`projectDemoMessages` includes rich parts in both the full translation projection and the last-good fallback. After malformed tags, changes to the name, quantity, or other input still reformat the last good snapshot.

Add `demo:rich` to `demoKeys` in `selected-keys.mts`. Its generated type is `"demo:rich": { "name": string | number; }`. This page uses all 14 keys in `demoKeys`. The default and selected builds contain the same 14 keys; one extra key not used by the fixture verifies that the selected build removes it.

## Validation

Verified locally:

- `@0disoft/saylo-react` build and typecheck.
- 17 React tests. Three new rich-renderer tests cover nested mapping, keys and identity for repeated tags with the same name, unknown and prototype-inherited tags, escaping of text and argument values, preservation of state (first count 1, second count 0) and node identity for two same-name `link` counters after catalog edits and literal insertion, and hydration against a fixed snapshot.
- Full `npm run check` exited 0: 293 tests (including boundary and tooling tests), 17 of them React tests.
- Default production demo lifecycle.
- Real HeadlessChrome 154 recovery check: 11 warm cases (including `rich-live-edit`, invalid, fallback-input, and restoration) and 3 cold cases, with no browser errors. Log: `.release/react-rich-recovery.log`.
- React selected-build validation: TypeScript selected-key contract and rich-text production lifecycle after switching to en. Log: `.release/react-rich-selected.log`.
- Vanilla full and selected Chromium checks: 11 each, reflecting dynamic key counts. Log: `.release/react-rich-vanilla-selected.log`.

- Independent tarball consumption: `npm exec -- node scripts/pack-smoke.mjs` exited 0. JS and TS installs of all five packages rendered core parts as React links and emphasis and verified HTML escaping of argument strings. Existing selector, SSR, and lazy consumption also passed. Log: `.release/react-rich-pack.log`.

The vanilla demo page uses the existing 13 keys. The shared catalogs have 14 keys after adding the React rich key, and the vanilla validation fixture adds 100 unused keys. The full build contains 114 keys; the selected build retains the 13 used by the page. The validator computes expected counts from the source catalogs.

## Next steps

The Svelte rich-text component was added in local commit `010a600`, and the Svelte demo is connected locally. Its contract, key rules, demo, and validation are documented in [80-svelte-rich-text.md](80-svelte-rich-text.md). The remaining Vue render helper and Vue demo were also implemented locally. Vue uses pure TypeScript `renderRichText` from the root entry without SFC compilation or a subpath, and the demo `App.vue` renders it in the `rich-preview` paragraph. The contract is in the [@0disoft/saylo-vue README](../packages/vue/README.md); demo integration and validation are in the [Vue demo](../examples/vue/README.md). None is in published builds yet. This document covers the React helper and React demo.
