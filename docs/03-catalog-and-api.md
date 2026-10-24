# 03. Catalogs and API

This document defines the catalog file format, ID and namespace rules, ICU policy, argument contract, public APIs, and examples. [08-update-protocol.md](08-update-protocol.md) is the single source for the update protocol's wire types and application rules. This document does not duplicate those definitions. There are five public packages: `@0disoft/saylo-core`, `@0disoft/saylo-react`, `@0disoft/saylo-svelte`, `@0disoft/saylo-typegen`, and `@0disoft/saylo-vite`. They were published as `0.1.0-alpha.4` (dist-tag `alpha`). `@0disoft/saylo-vue` is a local private workspace implementation. The API follows the source types, not the draft in this document.

## File layout

```text
locales/
  ko/                # 기준 로케일 (config로 고정)
    common.json
    cart.json
  en/
    common.json
    cart.json
```

- Encoding is UTF-8.
- Locale directory names are BCP 47 tags. Normalize case and script notation (canonicalization), then check for duplicates. `ko-kr` and `ko-KR` must not be treated as different locales.
- Every locale uses the same namespace file names. A namespace is the file name without `.json`, and its address is the same regardless of locale. Namespace names must not contain path separators.
- Resolve file paths as `locales/<locale>/<namespace>.json` and verify that the resulting path does not escape the locales root. Reject symbolic links that point outside the root.
- Values are a JSON object keyed by flat literal IDs. Do not mimic namespaces with nested objects.

## ID and namespace addresses

Keys inside a catalog are literal IDs. Code references them through addresses with the namespace prepended.

| Notation | Rule |
| --- | --- |
| literal ID | A key inside a file. For example, `welcome` or `cart.items` |
| address | `<namespace>:<literal-id>`. For example, `common:welcome` or `cart:items` |
| colon | Cannot appear in a namespace or literal ID. It is reserved as the separator. |
| period | A literal character, not a hierarchy separator. If the ID is `cart.items`, the address is `cart:cart.items`. |

- Forbid duplicate (namespace, id) pairs and ambiguity in namespace separators. Using the same address across different locales is valid.
- Reject JSON in which the same ID appears twice. `JSON.parse` alone cannot detect duplicate keys (the last value remains), so the parser preprocesses the input to detect duplicates.

## ICU policy

- Supported syntax is the MessageFormat 1 grammar supported by the selected FormatJS version. The full ICU standard is not guaranteed. Variables, `number`, `date`, `time`, `select`, `plural`, `selectordinal`, offsets, and nested forms are covered. The grammar follows [FormatJS ICU syntax](https://formatjs.github.io/docs/core-concepts/icu-syntax/).
- `offset:n` specifies a plural branch offset, and `#` is the placeholder that prints the offset-adjusted number inside a plural.
- Plural category sets are not required to be identical across locales. `other`, exact-value branches, `selectordinal`, `offset`, and nested structures are validated individually.
- The parser and formatter reuse validated libraries. The initial implementation uses `@formatjs/icu-messageformat-parser` and `intl-messageformat`. `IntlMessageFormat` accepts serialized AST input and supports tag and `ignoreTag` options ([FormatJS intl-messageformat](https://formatjs.github.io/docs/intl-messageformat/)). The project does not invent a grammar.
- Tags are treated as literal text by enabling the parser's `ignoreTag`. The initial decision excluded rich text component interpolation from the MVP. The first rich text core API slice adds a read-only parts projection (`tParts`) on top of the plain text contract ([78-rich-text-parts.md](78-rich-text-parts.md)). Interpolation with components as arguments and automatic HTML rendering remain non-goals.
- The project does not execute arbitrary JavaScript, use `eval`, or inject HTML automatically.
- ASTs do not need to match across languages. Structure and branches may differ by translation. The requirement is development/production parity (dev/prod parity): the same locale, message, and arguments produce the same output, errors, and fallback in both. Compare under the same Intl locale data and runtime matrix.

## Argument contract (initial design decision)

The base locale is the source of keys and argument schemas. An argument's type is determined only by the intersection of all uses of that argument in the base message. Translations do not change this contract.

| Use form | Type for that use |
| --- | --- |
| plain variable (`{name}`) | string or number |
| `number`, `plural`, `selectordinal` | number |
| `date`, `time` | number or Date |
| `select` | string |

- If an argument is used in multiple forms in the base message, the final type is the intersection of each use's type. For example, if the base contains both `{count}` (plain) and `{count, plural}` (number), the intersection is number. An empty intersection is an error.
- Argument names used in a translation must be a subset of the base argument names. A translation that introduces a new argument is an error.
- For each argument, the value types the base accepts must be a subset of the types the translation accepts. An error occurs when a translation requires a narrower type than the base (plain in the base, plural in the translation).
- A translation is allowed not to use an argument. This differs from the key itself being absent (a fallback case).
- Even if a translation omits an argument, the base's required-argument validation still applies at call time. Every path, including JS as well as TS, validates call arguments against the accepted base schema and throws `InvalidArgumentError` on a mismatch.
- The union of all placeholder names in the base message is that message's required argument-name set. Each name's type is the intersection of the use forms in which that name appears.

Valid example, base `locales/ko/cart.json`:

```json
{
  "title": "장바구니",
  "items": "{count, plural, one {#개 상품} other {#개 상품}}",
  "total": "합계 {total, number}",
  "when": "{at, date, medium}"
}
```

Here, `count` in `items` appears only in a plural, so it is a number. `title` has no arguments.

Valid example, translation `locales/en/cart.json`. It accepts the base types and omits some keys:

```json
{
  "title": "Cart",
  "items": "{count, plural, one {# item} other {# items}}"
}
```

`total` and `when` are absent from the translation. Because those keys are missing, access falls back to the baseline values. `items` is a plural, so its number requirement matches the base. This translation omits only keys and still uses `count` for `items`.

Example that actually omits an argument, with only `items` different in `locales/en/cart.json`:

```json
{
  "items": "Items in your cart"
}
```

This translation does not use `count` in the message. The base still requires `count`, however, so the call remains `t("cart:items", { count })`. Even when a message omits the argument, the call contract follows the accepted base schema.

Error example in which the translation requires a narrower type. Base `locales/ko/badge.json`:

```json
{
  "count": "총 {count}개"
}
```

The base `count` is plain, so its type is string or number. Translation `locales/en/badge.json` is an error if it requires plural (number), as below.

```json
{
  "count": "{count, plural, one {# item} other {# items}}"
}
```

This diagnostic does not stop at calling the translation erroneous. It also explains that the base must declare a numeric contract.

Call argument-free keys as they are: `t("cart:title")`.

## Format cache and time zone

Caches are split into two layers.

| Cache | Key | Invalidation |
| --- | --- | --- |
| message formatter | (namespace, id, message fingerprint, formatLocale, normalized options, timeZone) | When that message's fingerprint or formatLocale changes |
| `Intl` formatter | (locale, normalized Intl options, timeZone) | When the locale or options change |

- Even when the catalog revision changes, do not clear every `Intl` cache if the copy content is unchanged. The `Intl` cache is independent of copy revisions.
- Even during a full replacement, reuse formatters for messages whose AST fingerprint is unchanged. Bound the cache and evict unused entries, for example with an LRU policy.
- Date and time formatting receives timeZone explicitly from configuration. UTC is recommended as the default. If timeZone is omitted, server-rendered and browser-rendered results can diverge and cause hydration mismatches.
- A message populated through baseline fallback is formatted using that message's source locale (formatLocale). Document and diagnose that numeric and date presentation may differ from what the user expects for the selected locale.

## Revision distinctions

| Value | Owner | Purpose | Exposure |
| --- | --- | --- | --- |
| registry revision | Development server and global transport | Aligns catalog transmission order | Not a public API |
| instance stateRevision | Client instance | UI subscription identity | `StoreSnapshot` |

- Locale changes increment only the instance stateRevision. They do not increment the registry revision.
- The global schemaRevision is not exposed through the public API or wire protocol. Schema versions are handled by a per-namespace `namespaceSchemaFingerprint`. A schema change in one namespace does not make valid load results in another namespace stale.
- `catalogVersion` increments for each catalog key. A tombstone marking deletion also has a version. Follow [08-update-protocol.md](08-update-protocol.md) for detailed rules.

## Catalog load results and errors

Catalog retrieval goes through the `CatalogSource` interface. Development and production place different adapters behind the same interface. Results have three states.

- `present`: The catalog exists. Return the catalogVersion, namespaceSchemaFingerprint, and catalog record together.
- `missing`: The server determined that the catalog does not exist. This covers deleted files and namespaces that do not exist yet. Return only a version.
- `failed`: The lookup did not finish because of a network or server error. Distinguish this from `missing`.

On a failed lookup, retain the previous UI and reject that call's Promise with `CatalogLoadError`. A server-determined `missing` is a normal result, not a failure.

| Error | Condition |
| --- | --- |
| `UnknownMessageError` | Accessing an unknown key. The key string is not exposed as-is. |
| `NamespaceNotLoadedError` | Accessing a namespace that has not been loaded. |
| `InvalidArgumentError` | A required argument is missing or has the wrong type according to the accepted base schema. |
| `CatalogLoadError` | `loadCatalog` returns `failed`. |
| `SupersededRequestError` | An earlier intent is actually superseded (for example, switching from `en` back to `ko`). `dispose` rejects with a separate reason. |

## Public APIs

The following sources are the single reference for current public types. Follow these files for fields and unions.

- [packages/core/src/types.ts](../packages/core/src/types.ts): `ParsedCatalog`, `ParsedMessage`, `ArgumentSchema`, `CatalogSchema`, `Schema`, `Translate`, and `StoreSnapshot`
- [packages/core/src/loading-types.ts](../packages/core/src/loading-types.ts): `CatalogKey`, `CatalogManifest`, `CatalogOutcome`, `CatalogLoadResult`, `CatalogSource`, `CreateI18nOptions`, and `I18n`
- [packages/core/src/boot.ts](../packages/core/src/boot.ts): `BootSnapshot` and boot serialization functions
- [packages/vite/src/virtual.d.ts](../packages/vite/src/virtual.d.ts): declarations for the `virtual:saylo` family

The current model has four layers.

- `ParsedCatalog` is parser output. It contains `locale`, `namespace`, `sourceName`, and `messages`, and each `ParsedMessage` contains `source`, `position`, `ast`, and `arguments`.
- `CatalogOutcome` is the transport unit with session and pair version attached. `present` contains `catalog: ParsedCatalog` and `namespaceSchemaFingerprint`; `missing` contains a tombstone with only a version. `CatalogLoadResult` adds `failed`.
- `StoreSnapshot<S>` is the public UI snapshot extending `Translator<S>`. It contains `locale`, `baseLocale`, `timeZone`, `t`, `tParts`, `stateRevision`, `availableLocales`, `availableNamespaces`, and `loadedNamespaces`.
- `BootSnapshot` contains `format: "saylo-boot-v1"`, `manifest`, `locale`, `timeZone`, `stateRevision`, `loadedNamespaces`, `baseSchemas: CatalogSchema[]`, and `catalogOutcomes: CatalogOutcome[]`.

The `Map<string, CatalogRecord>`-shaped `UiSnapshot` was an initial design draft and is absent from the current implementation. Catalog contents are delivered as `ParsedCatalog` in `CatalogOutcome.catalog`. `CatalogRecord`, `RuntimeArgumentSchema`, `ArgTypes`, and `UiSnapshot` are also absent from the public types.

`createI18n` is constructed synchronously. The client lazy path receives `locale`, `initialNamespaces`, and `initialCatalogs` directly; the SSR and hydration path receives `initialSnapshot`. Both forms require `catalogSource`. If `initialSnapshot.timeZone` and the `timeZone` option differ, construction throws an error.

`I18n` provides `t` and `tParts`; `getSnapshot`, `getServerSnapshot`, and `getBootSnapshot`; `getLocales` and `getNamespaces`; `subscribe` and `onDispose`; and `setLocale`, `loadNamespace`, `refresh`, and `dispose`. Typed calls pair keys and arguments in a `TypedCall` tuple.

There is no `fallbackLocale` option. When a translation is absent, it falls back to the single baseLocale. Multi-level fallback will be considered separately together with loading, schema, and formatting provenance.

`freezeCatalogs` is provided by the core root and `/runtime` and has been included in published builds since `0.1.0-alpha.2`.

Selective builds are configured through `includeKeys`. It accepts an existing `string[]` list or a `{ from: ['src'], dynamicKeys?: ['demo:key'] }` object. Object paths are files or directories inside the Vite root, and only actual JS, TS, JSX, TSX, Vue, and Svelte scripts and template expressions are analyzed statically. Code is not executed; matching strings, static calls through `t` and `tParts` aliases, and every possible full key matching template prefixes and suffixes are retained. An unresolvable dynamic call fails the build unless `dynamicKeys` is provided. Symlinks, paths outside the root, and parse errors are also rejected.

Development uses the full catalog; production eager, lazy, and SSR builds include only selected keys. Typegen declarations retain the full base schema. This feature is absent from published `0.1.0-alpha.4`.

## Development connection (virtual module)

The development server provides three things to the client.

- `virtual:saylo`: Exports `initialCatalogs` (`ParsedCatalog[]`), `baseLocale`, `initialLocale`, and `timeZone`. This is the eager path that loads the full registry at once.
- `virtual:saylo/lazy`: Exports `initialCatalogs` (`CatalogOutcome[]`), `initialLocale`, `initialNamespaces`, `timeZone`, and `catalogSource`. It does not export `initialSnapshot`. The development source is created with `{ push: true }`.
- Manual `createDevCatalogSource` uses `push: true` as an opt-in and defaults to `false`. The source registers owner, session, and cached pair metadata through `saylo:catalog-scope`, and the server sends only pairs that changed within that scope through `saylo:catalog-push`. The payload is `{ kind: "patch", owner, baseRevision, manifest, outcomes }`.
- `virtual:saylo/server`: Exports `catalogSource` and `createRequestI18n`.
- `catalogSource` (development): The general `loadCatalog(locale, namespace)` queries the current registry. A namespace created after boot does not fail merely because it has no entry in the old per-namespace loader map.
- `connectDev(instance, { catalogSource })`: Registers a lazy instance as an update target. Eager stores use `connectDev(store)`. Without this call, the plugin does not know which store should receive events. Call it only in development.

- When the namespace manifest grows or shrinks dynamically, notify the current source by updating the manifest's `availableNamespaces`. The development path has no static namespace map. The general `loadCatalog` handles lookups for new namespaces. A static loader map is generated only for production.
- Production uses only the generated static loader map. That map also sits behind the same `CatalogSource` interface.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import saylo from "@0disoft/saylo-vite";

export default defineConfig({
  plugins: [
    saylo({
      localesDir: "locales",
      baseLocale: "ko",
      initialLocale: "ko",
      initialNamespaces: ["common"],
      timeZone: "UTC",
      // 생성물을 .ts 모듈로 두면 HMR 전파 대상이 되므로 .d.ts로 둔다.
      typegen: { outFile: "src/i18n/generated.d.ts" }
    })
  ]
});
```

## Examples

TypeScript, generated types, and lazy initialization:

```ts
// src/i18n/client.ts
import { createI18n } from "@0disoft/saylo-core";
import { connectDev } from "@0disoft/saylo-vite/client";
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces, timeZone } from "virtual:saylo/lazy";
import type { AppSchema } from "./generated.js";

export const i18n = createI18n<AppSchema>({
  locale: initialLocale,
  initialNamespaces,
  initialCatalogs,
  catalogSource,
  timeZone,
});

await i18n.loadNamespace("cart");

i18n.t("cart:title");
i18n.t("common:welcome", { name: "제로디" });
i18n.t("cart:items", { count: 3 });
// i18n.t("cart:items", { count: "3" });   // 타입 오류: count는 number

await i18n.setLocale("en");

// 개발 엔트리에서만 연결한다. 정리는 disconnect(); i18n.dispose();
export const disconnect = connectDev(i18n, { catalogSource });
```

JavaScript, with `checkJs` and JSDoc for lazy initialization:

```js
// src/i18n/client.js
// @ts-check
import { createI18n } from "@0disoft/saylo-core";
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces, timeZone } from "virtual:saylo/lazy";

/** @type {import("@0disoft/saylo-core").I18n<import("./generated.js").AppSchema>} */
export const i18n = createI18n({
  locale: initialLocale,
  initialNamespaces,
  initialCatalogs,
  catalogSource,
  timeZone,
});
```

```js
// src/main.js
import { i18n } from "./i18n/client.js";

i18n.subscribe(() => render());
await i18n.setLocale("en");   // subscribe가 이미 render하므로 다시 부르지 않는다
```

```ts
// src/i18n/dev.ts  (개발 엔트리에서만 import)
import { connectDev } from "@0disoft/saylo-vite/client";
import { catalogSource } from "virtual:saylo/lazy";
import { i18n } from "./client";

connectDev(i18n, { catalogSource });
```

React, where the factory creates the Provider and hook in the same context:

```tsx
// src/i18n/react.ts
import { createSayloReact } from "@0disoft/saylo-react";
import type { AppSchema } from "./generated";

export const { SayloProvider, useI18n } = createSayloReact<AppSchema>();
```

```tsx
// src/main.tsx
import { SayloProvider, useI18n } from "./i18n/react";
import { i18n } from "./i18n/client";

root.render(
  <SayloProvider instance={i18n}>
    <App />
  </SayloProvider>
);

function CartSummary() {
  const { t } = useI18n();          // 이 렌더가 선택한 UI snapshot에 바인딩된다
  return (
    <>
      <h2>{t("cart:title")}</h2>
      <p>{t("cart:items", { count: 3 })}</p>
    </>
  );
}
```

## Update protocol

[08-update-protocol.md](08-update-protocol.md) is the single source for encoding and applying patches, snapshots, and boot data, and for resync rules. This document does not redefine them.
