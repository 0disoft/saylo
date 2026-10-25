# @0disoft/saylo-core

The Saylo core package. It provides catalog parsing and schema validation, a synchronous translator, an eager store, lazy-loading i18n, and SSR boot serialization. It does not depend on the DOM or a specific framework.

## Status

The source checkout adds optional `onMissingKey` and `onFormatError` callbacks; strict exceptions remain the default. See [runtime translation error policy](../../docs/runtime-error-policy.md). These options have not been published yet.

This README describes `0.1.0-alpha.7` (dist-tag `alpha`). See the [release record](../../releases/0.1.0-alpha.7.md) for publication and registry verification. The first published version was `0.1.0-alpha.1` from 2026-10-06. You can also use it from this repository's workspace or install a tarball produced by `npm pack`.

React and Svelte selector fine-grained subscriptions (`useI18nSelector`, `selectSvelteStore`, `getI18nSelector`) are included in the `0.1.0-alpha.4` release.

This README has been included in published tarballs since alpha.5.

## Installation

```sh
npm install @0disoft/saylo-core@alpha
```

`latest` still points to a registration placeholder, so specify `@alpha`. Install it as an app runtime dependency (`dependencies`).

## Usage

Use `parseCatalog` to parse the catalog for each locale, and `createStore` to create a store you can use immediately.

```js
import { parseCatalog, createStore } from '@0disoft/saylo-core';

const base = parseCatalog('{"items":"{count, number}개"}', {
  locale: 'ko', namespace: 'cart', sourceName: 'locales/ko/cart.json',
});
const translation = parseCatalog('{"items":"{count, plural, one {# item} other {# items}}"}', {
  locale: 'en', namespace: 'cart', sourceName: 'locales/en/cart.json',
});

const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs: [base, translation] });

store.t('cart:items', { count: 3 });                 // "3 items"
store.getSnapshot().t('cart:items', { count: 1 });   // snapshot에 고정된 읽기
store.setLocale('ko');
store.dispose();
```

Messages use ICU MessageFormat. Variables such as `{count, number}` are filled from call arguments. A key missing from the base schema raises `UnknownMessageError`; a missing argument or type error raises `InvalidArgumentError`. A missing translation falls back to the base locale text. `createStore` validates catalogs before publishing, and `getSnapshot()` returns the same object when the displayed state is unchanged.

Subscribe to changes with `store.subscribe(snapshot => ...)` and register cleanup of owned resources with `onDispose(cleanup)`. Call `store.dispose()` when the store is no longer used.

In TypeScript, connect key and argument types with `createStore<AppSchema>(...)`; in JavaScript, use the JSDoc `Store<AppSchema>`. Generate `AppSchema` with [@0disoft/saylo-typegen](https://github.com/0disoft/saylo/tree/main/packages/typegen#readme) or write it by hand. It works without specifying types.

Lazy loading is handled by `createI18n`, and catalog transport sources are provided by [@0disoft/saylo-vite](https://github.com/0disoft/saylo/tree/main/packages/vite#readme). Per-request SSR uses `createServerI18n`; boot serialization uses `serializeBootSnapshot` and `decodeBootSnapshot`.

The `0.1.0-alpha.7` release supports `setLocale(locale, { signal })`, `loadNamespace(namespace, { signal })`, and `refresh({ signal })`. This signal cancels only that caller's wait; shared catalog loads and the requested screen state transition continue. Failures are reported through `CatalogLoadError` with `code: 'ABORTED'` and `cause: signal.reason`. To tear down the whole instance, call `dispose()` or pass a lifetime `signal` in the options of `createI18n` or `createServerI18n`. Cancellation of the lifetime ends in-flight API calls with `I18nDisposedError`, while cancellation during SSR preparation ends with `ABORTED`.

The `0.1.0-alpha.7` release runs at most 8 `loadCatalog` calls concurrently per i18n instance. The same execution limit is shared even when the locale, screen scope, or manifest changes. `requestTimeoutMs` (default 5 seconds) includes time spent waiting for an execution slot, and a load canceled while waiting does not call the source. If the source ignores cancellation, the slot stays occupied until the actual Promise settles. If all 8 slots are stuck, new requests also wait and then end with a timeout, so the source must also clean up I/O according to the `AbortSignal` it receives. On servers that use multiple i18n instances, the source's shared pool also limits the total number of connections.

The `0.1.0-alpha.7` `setNamespaces(namespaces, { signal })` replaces every required namespace for the current screen. Calling it as `await i18n.setNamespaces(['common', 'editor'])` removes the previous screen's namespaces from the language-switch wait, and catalogs already received stay in the cache. `[]` is allowed. Requests for namespaces excluded by the replacement and requests from the previous scope are rejected with `SCOPE_SUPERSEDED`. Array order does not matter, and duplicate or missing namespaces are rejected before the state changes. The React, Svelte, and Vue bindings and the React hydration adapter also forward this method.

The optional `schedule(milliseconds, callback)` on both factories is used to control timers in tests. It must run the callback later and return a cancel function that is safe to call repeatedly. `requestTimeoutMs` accepts finite positive numbers up to `2,147,483,647`; fractional values are rounded up. If a displayed-state change pushes the revision beyond the safe integer range, the change is rejected with `REVISION_OVERFLOW` and the existing snapshot and boot data are kept.

To omit `parseCatalog` from the browser runtime, use the `@0disoft/saylo-core/runtime` subpath entry. It does not include `parseCatalog`, and the other APIs match the root entry. The root entry `@0disoft/saylo-core` keeps the existing API unchanged. This subpath is included in the `0.1.0-alpha.2` release.

## Locale resolution

`resolveLocale(candidates, supported, fallback)` examines candidates in the order the app provides, matches canonical tags in the supported list exactly, and then widens only through parent tags. For example, if the supported list contains only `en`, `en-GB` resolves to `en`; if it contains only `en-US`, `en` and `en-GB` are not arbitrarily mapped to `en-US`. Malformed candidates are skipped. It throws `RangeError` if a supported locale is malformed, canonical tags are duplicated, or the fallback is not in the supported list.

`parseAcceptLanguage(header)` returns a frozen array of `{ range, quality }` in descending quality order, preserving header order for equal quality. Malformed entries are skipped, and entries with `q=0` are kept so the exclusion information is not lost. `resolveAcceptLanguage(header, supported, fallback)` applies the most specific `q=0` range as an exclusion. When a positive value and 0 have the same specificity, 0 wins. A wildcard selects the default after all explicit ranges have been examined. If no acceptable value exists, it returns the app fallback instead of HTTP 406.

All three functions and the `LanguagePreference` type are provided by both `@0disoft/saylo-core` and `@0disoft/saylo-core/runtime`, which does not include the parser. This API is included in alpha.5 and is absent from alpha.4.

## Rich text parts

`tParts(key, args)` uses the same message and argument contract as `t()` and returns the result as a read-only parts tree. `t()` keeps strings and literal tags as they are.

```js
import { parseCatalog, createStore } from '@0disoft/saylo-core';

const ko = parseCatalog('{"bold":"<strong>{name}</strong>님, 안녕하세요"}', {
  locale: 'ko', namespace: 'common', sourceName: 'locales/ko/common.json',
  richText: { bold: ['strong'] }, // 선택: 카탈로그 수용 전에 구조·허용 태그 검사
});
const richStore = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [ko] });

richStore.tParts('common:bold', { name: '제로디' });
// [
//   { type: 'tag', name: 'strong', children: [{ type: 'text', value: '제로디' }] },
//   { type: 'text', value: '님, 안녕하세요' },
// ]
richStore.dispose();
```

Parts have two shapes, `{ type: 'text', value }` and `{ type: 'tag', name, children }`, and are deeply frozen. Only paired markers without attributes (`<name>` and `</name>`) are parsed as structure. Markers with attributes and self-closing markers stay literal text, and mismatched, unclosed, or ICU-branch-crossing structures raise `InvalidRichTextError` (only in `tParts` when no `richText` pre-validation is specified). Messages with `richText` are rejected during catalog acceptance with an `INVALID_RICH_TEXT` diagnostic, and the base rich-text contract also applies to translation validation. `<` and `>` inside argument values remain text. Links and HTML attributes are added only when the app maps tag names on its allowlist to its own elements. Do not create arbitrary HTML elements from names that come from translations. The marker grammar, errors, and examples are in [rich text parts notes](../../docs/78-rich-text-parts.md). This API is not in the `0.1.0-alpha.4` release and was verified with the local `npm run check`.

## Freezing transported catalogs

`freezeCatalogs(catalogs)` deeply freezes the catalog array, ASTs, positions, and argument schemas after JSON transport, and returns the same array. It is available from the root and `/runtime` entries. Objects already deeply frozen by the same core module are not traversed again, while objects frozen only on the surface by other code are traversed through. Validation is still performed by the existing decoder, store, and i18n. This function is included in the `0.1.0-alpha.2` release; the implementation and measurements are in [shared catalog freeze notes](../../docs/26-shared-catalog-freeze.md) and [dev prebundle sharing notes](../../docs/30-prebundle-freeze-sharing.md).

## Local parsing optimization

`parseCatalog` uses an internal fast path for plain text and ASCII `{name}` interpolation. The AST, positions, argument inference, and immutability keep the existing contract; apostrophes, complex ICU, and out-of-range arguments are handled by FormatJS. No public API options were added. This optimization is included in the `0.1.0-alpha.2` release, and the measurements and limits are in [the design notes](../../docs/15-simple-message-parser.md).

## Related packages

- [@0disoft/saylo-react](https://github.com/0disoft/saylo/tree/main/packages/react#readme) — React 19 bindings
- [@0disoft/saylo-typegen](https://github.com/0disoft/saylo/tree/main/packages/typegen#readme) — generates type declarations from the base catalog
- [@0disoft/saylo-vite](https://github.com/0disoft/saylo/tree/main/packages/vite#readme) — Vite plugin and dev client

## Documentation

- [Catalogs and API](https://github.com/0disoft/saylo/blob/main/docs/03-catalog-and-api.md)
- [Live updates and types](https://github.com/0disoft/saylo/blob/main/docs/04-live-update-and-types.md)
- [Production builds and SSR](https://github.com/0disoft/saylo/blob/main/docs/05-build-and-ssr.md)
- Repository [README](https://github.com/0disoft/saylo#readme)

## Versions

Supports Node.js 24.x. `engines.node` is `24.x`, and the local verification environment is Node 24.18.0. It is verified against TypeScript 7, but `typescript` is not enforced as a peer dependency.

The runtime target is ES2022, and because it targets browsers it does not depend on Node APIs. This package has no runtime peer dependencies.

## Questions and security reports

Send general questions, feature proposals, and bugs to [rodisoft1@gmail.com](mailto:rodisoft1@gmail.com). Include the package and version, the environment, expected and actual behavior, and a minimal reproduction built from synthetic data. Report security issues privately to the same email with a `Saylo security` subject. Do not send tokens, keys, cookies, or real user data.

If you installed the Vite package, you can read the fuller guidance in `node_modules/@0disoft/saylo-vite/docs/support.md` and `security.md`. These guides and the package contact metadata are included in alpha.5. Earlier alpha.4 tarballs do not contain them.

## License

Apache-2.0. The distribution tarball includes the repository root `LICENSE` and `NOTICE`.

## Compact catalog and boot wire data

`encodeCatalog(catalog)` and `decodeCatalog(wire)` are available from core and `/runtime`. They preserve source text, argument contracts, rich tags, source positions and ICU ASTs without reparsing ICU on the client. Repeated argument schemas are shared in a table, and literal/argument AST nodes use tuples. The decoded result is an ordinary immutable `ParsedCatalog`. Mutable caller inputs are copied rather than frozen or cached. The encoder memoizes only recognized immutable catalogs.

`serializeBootSnapshot(snapshot, { compact: true })` emits HTML-safe `saylo-boot-v2` JSON with compact catalogs and without redundant base schemas. The decoder rebuilds and validates those schemas from the catalogs, checks manifest pair stamps and contracts, and returns the existing canonical `BootSnapshot` shape. `decodeBootSnapshot()` accepts both v1 and v2. Serialization without the new option still emits v1, preserving existing integrations. Compact boot is explicit; update both server and client packages together before using it.

These APIs are included in the published `0.1.0-alpha.7` release. See [production catalog compaction](../../docs/production-catalogs.md) and the [alpha.7 release record](../../releases/0.1.0-alpha.7.md).
