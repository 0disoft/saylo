# 78. Rich text parts (`tParts`)

This document defines the contract and usage of the first rich-text core API slice. Existing `t()` still returns a string, while core adds `tParts(key, args)` to obtain a read-only parts tree from the same message.

Status: the first implementation completed local `npm run check` and independent JS/TS pack-consumer validation. This API is absent from published builds. The current checkout also includes optional rich-contract metadata and acceptance-stage validation. No version promotion or publication was performed.

## Scope

- Add `tParts(key, args)` to `Translator`, `Store`, `StoreSnapshot`, and `I18n`.
- Use the same path as `t()` for argument contracts (`TypedCall`), required-argument validation, base-locale fallback, source locale, and time-zone handling.
- Return a deeply frozen read-only `RichTextPart[]`.
- This slice excludes component interpolation through arguments, automatic HTML rendering, React, Svelte, and Vue render helpers, and real browser UI demos. Framework helpers and demos belong to the next slice. Hook consumers obtain `tParts` from the existing snapshot.

## API

```ts
type RichTextPart =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'tag'; readonly name: string; readonly children: readonly RichTextPart[] };

// Keys and arguments follow the same TypedCall tuple relationship as t().
type TranslateParts<S extends Schema> =
  string extends keyof S
    ? (key: string, args?: Record<string, unknown>) => readonly RichTextPart[]
    : (...call: TypedCall<S>) => readonly RichTextPart[];
```

`t()` preserves strings and literal tags. `tParts()` splits the same message at marker boundaries and falls back to the base-locale text when a translation is missing.

| Surface | Binding |
| --- | --- |
| `Translator.tParts` | That translator's locale and catalog |
| `Store.tParts` | Latest committed snapshot |
| `StoreSnapshot.tParts` | Fixed to that snapshot |
| `I18n.tParts` | Latest committed snapshot |

## Marker syntax

- Only exact `<NAME>` opening markers and `</NAME>` closing markers are interpreted.
- `NAME` starts with an ASCII letter and may continue with letters, digits, underscores, and hyphens.
- Only literal elements produced by the parser are interpreted. Values supplied through arguments are not scanned for marker syntax.
- Nested tags and repeated tags with the same name are supported.
- Tags inside ICU plural and select branches are supported. Each branch must be balanced within itself.
- Markers with attributes (`<a href="/">`) and self-closing markers (`<br/>`) are not interpreted structurally. Each remains separate literal text.
- Supported structure consists only of paired, attribute-free opening and closing markers. Links, attributes, and URLs are added only when an app maps an allowlisted tag name to its own element. It must not create arbitrary HTML elements from names supplied by translations.
- Names beginning with an underscore (`<__proto__>`) do not satisfy the opening-marker rules and remain literal text.

## Errors

It throws `InvalidRichTextError` when opening and closing names do not match (`<a>word</b>`), a tag is unclosed (`<a>word`), or a tag crosses an ICU branch boundary. The error object stores `"<namespace>:<id>"` in `key`.

Wrapping an entire ICU expression is allowed, as in `<link>{n, plural, other {# items}}</link>`. Pairing a tag opened outside a branch with a close inside that branch, or the reverse, is not allowed.

An opening marker with attributes is literal text, not structure. In `<a href="/">x</a>`, the opening `<a href="/">` remains literal, but the unmatched closing `</a>` has no pair, so an error occurs. Only attribute-free paired markers are structural; the app mapping adds `href` and other HTML attributes.

For messages without pre-validation, this error applies only to `tParts()`, and `t()` continues to return a string. Current unpublished source can specify allowed tags per message with `parseCatalog(source, { locale, namespace, richText: { terms: ['link'] } })`. Such messages have structure and allowed tags checked in every ICU branch before catalog acceptance; failure is rejected with a `CatalogError` carrying the `INVALID_RICH_TEXT` diagnostic. Because the base schema includes this contract, translations parsed without separate options receive the same validation. Tag order, nesting, and omission are allowed.

## Relationship between arguments and markers

- Argument values containing `<` and `>` remain text.
- A scalar argument and a tag may share a name (for example, argument `name` and tag `<name>`).
- Internal callback names are projected through aliases that do not collide with argument keys.

## ICU quoting and escaping

The parser resolves ICU quoting first, and `tParts()` then interprets the remaining literal markers. Use `t()` to display literal `<...>` text unchanged. No new escape syntax is introduced.

## Formatting, caching, and fallback

- Reuse FormatJS AST formatting and the existing `Intl` cache. Timezone, source locale, required-argument validation, and base-locale fallback match `t()`.
- Do not add an ICU parser to the `/runtime` entry or Vite production bundle.
- A `tParts()` failure due to invalid structure recovers with the next valid catalog. Failed attempts do not pollute the cache.

## Examples

Nested and repeated tags. Base catalog:

```json
{ "x": "Hello <link><strong>{name}</strong></link> / <link>again</link>" }
```

```ts
i18n.t('demo:x', { name: 'Zed' });
// 'Hello <link><strong>Zed</strong></link> / <link>again</link>'

i18n.tParts('demo:x', { name: 'Zed' });
// [
//   { type: 'text', value: 'Hello ' },
//   { type: 'tag', name: 'link', children: [
//     { type: 'tag', name: 'strong', children: [{ type: 'text', value: 'Zed' }] },
//   ] },
//   { type: 'text', value: ' / ' },
//   { type: 'tag', name: 'link', children: [{ type: 'text', value: 'again' }] },
// ]
```

Tags inside a plural branch:

```json
{ "x": "{n, plural, offset:1 =0 {<em>none</em>} one {<em># item</em>} other {<em># items</em>}}" }
```

```ts
i18n.tParts('demo:x', { n: 3 });
// [{ type: 'tag', name: 'em', children: [{ type: 'text', value: '2 items' }] }]

i18n.tParts('demo:x', { n: 0 });
// [{ type: 'tag', name: 'em', children: [{ type: 'text', value: 'none' }] }]
```

Argument values remain text:

```json
{ "x": "Hi <b>{name}</b>" }
```

```ts
const name = '<script>alert(1)</script>';
i18n.tParts('demo:x', { name });
// [
//   { type: 'text', value: 'Hi ' },
//   { type: 'tag', name: 'b', children: [{ type: 'text', value: name }] },
// ]
```

Markers with attributes or self-closing syntax are not structural. `<br/>` remains literal text. When the opening side has attributes, as in `<a href="/">x</a>`, the opening marker is literal and the unmatched `</a>` produces an error.

```json
{ "br": "line<br/>break", "link": "<a href='/'>x</a>", "broken": "<a>word</b>" }
```

```ts
i18n.tParts('demo:br');
// [{ type: 'text', value: 'line<br/>break' }]

i18n.tParts('demo:link');     // InvalidRichTextError, key 'demo:link'
i18n.tParts('demo:broken');   // InvalidRichTextError, key 'demo:broken'
i18n.t('demo:broken');        // '<a>word</b>'
```

Parts are values, not DOM. The app decides which elements render tags and which attributes and URLs they receive. The app maps only tag names allowed by its screen and does not create arbitrary HTML elements from names supplied by translations. Saylo does not create HTML.

```ts
// App code. This is not part of the Saylo API.
const allowed = { strong: Strong, em: Em, link: Link };   // Only tags allowed by the app

for (const part of i18n.tParts('demo:x', { name })) {
  if (part.type === 'text') appendText(part.value);
  else if (allowed[part.name]) appendElement(allowed[part.name], part.children);
  else appendChildren(part.children);   // Render only the children of tags outside the allowlist
}
```

## Validation

The local implementation is complete, and `npm run check` exited 0 (290 tests, log `.release/rich-text-check.log`). It covers six workspace builds, JS/TS consumer typechecks, matching output between the rich-parts AST runtime and normal path in Vite production, and the absence of the parser from the AST bundle. `npm exec -- node scripts/pack-smoke.mjs` also exited 0 (log `.release/rich-text-pack.log`). It ran the new core and runtime APIs from independent JS/TS installs of the five tarballs, and existing SSR, selector, and Vite lazy consumers passed. Validation covers:

- `tParts` types and return shape in JS and TS consumers.
- Nested and ICU-branch formatting, base-locale fallback, UTC, and boot snapshots.
- Live store catalog replacement and old-snapshot binding.
- Matching behavior between parser-free Vite production and the root entry.

## Next steps

React render helpers and a real Chromium demo, a Svelte component, and a Vue render helper were added locally. [79-react-rich-text.md](79-react-rich-text.md) defines the React `renderRichText` contract and demo, [80-svelte-rich-text.md](80-svelte-rich-text.md) covers the Svelte component, and the [@0disoft/saylo-vue README](../packages/vue/README.md) defines the Vue `renderRichText` contract. Vue demo integration and validation are in the [Vue demo](../examples/vue/README.md). None is in published builds, and version promotion and publication remain deferred. Hooks use `tParts` from the existing snapshot.
