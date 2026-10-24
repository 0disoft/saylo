# @0disoft/saylo-vite

The Saylo Vite 8 plugin and development client. It detects catalog file changes and applies them to the screen without replacing app modules.

## Status

The last version confirmed as published is `0.1.0-alpha.4` (dist-tag `alpha`) from 2026-10-11. The first published version was `0.1.0-alpha.1` from 2026-10-06. It can also be used from this repository's workspace.

The lazy development path sends full present responses in a compact form and restores them to the existing catalog shape in the browser. Complex ICU ASTs and error locations are preserved, and there is no re-parsing of ICU in the browser. This change is included in the `0.1.0-alpha.2` release. Scope, verification, and performance measurements are in [compact transport notes](https://github.com/0disoft/saylo/blob/main/docs/16-compact-catalog-transport.md).

## Starter guide in the install folder

The tarball for the next release will include the [documentation index](docs/README.md), the JavaScript/TypeScript, React, Svelte, and SvelteKit getting-started guides, and the package API documentation. They can be read from the app's `node_modules/@0disoft/saylo-vite/docs/` without a GitHub login. The current public alpha.4 does not include this document bundle; it is a change prepared through local build and pack.

```sh
node -e "console.log(require('node:fs').readFileSync('node_modules/@0disoft/saylo-vite/docs/README.md', 'utf8'))"
```

Links inside the bundle point to the documentation installed alongside it. `manifest.json` records the SHA-256 of the originals and the bundle, and the runnable code blocks in the getting-started guides are identical to the originals. Design and measurement notes that are not included are listed by title only.

## Installation

Install `@0disoft/saylo-core` as an app runtime dependency, and the plugin and dev client as development dependencies. `vite` is a peer dependency and the current requirement is Vite 8.

So that production SSR builds include `@0disoft/saylo-vite/client` in the app bundle, the plugin adds the `@0disoft/saylo-vite` package to the bundle target (`ssr.noExternal`). You therefore do not need to install this package as a production runtime dependency. This handling is included in the `0.1.0-alpha.4` release.

```sh
npm install @0disoft/saylo-core@alpha
npm install -D @0disoft/saylo-vite@alpha vite@8
```

The `latest` tag of Saylo packages still points to a registration placeholder, so specify `@alpha`.

## Configuration

The current unpublished source reads CLI-compatible JSON configuration with `loadProjectConfig()`. File paths are resolved relative to the configuration file's location, so they stay valid when the Vite root differs. The base locale, catalog paths, and rich tag policy can live in one file and are also used by `saylo-typegen --config` and `saylo check --config`. Usage for shared configuration and the review comparison record is in the [typegen guide](../typegen/README.md).

```js
import { fileURLToPath } from 'node:url';
import saylo, { loadProjectConfig } from '@0disoft/saylo-vite';

const project = loadProjectConfig(fileURLToPath(new URL('./saylo.config.json', import.meta.url)));
// vite.config의 plugins에 등록한다.
const plugins = [saylo(project)];
```

The existing object configuration is also supported.

```js
// vite.config.mjs
import { defineConfig } from 'vite';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({
  plugins: [saylo({
    localesDir: 'locales',                   // Vite root 기준
    baseLocale: 'ko',
    initialNamespaces: ['demo'],             // 생략하면 기준 namespace 전체
    timeZone: 'UTC',                         // 생략하면 UTC
    typegen: { outFile: 'generated.d.ts' },  // 선택, Vite root 기준
  })],
});
```

`astRuntime` (default `true`) applies only during production builds. When Saylo `core/dist/formatters.js` imports `intl-messageformat`, it resolves that module as a separate virtual module and replaces the dependency with `@formatjs/icu-messageformat-parser/no-parser.js`. It does not alias the whole app, and an external `IntlMessageFormat(string)` and SSR external dependencies are unchanged. If the app calls `parseCatalog` directly, including the parser is expected, and setting the option to `false` turns this path off. This option is included in the `0.1.0-alpha.2` release.

The catalog file layout is `locales/<locale>/<namespace>.json`. For example, `locales/ko/demo.json` and `locales/en/demo.json`.

The `richText: { demo: { terms: ['link', 'strong'] } }` option in the unpublished source specifies the allowed tags for each namespace and message. For the specified messages, it checks tag balance in every ICU branch and the allowlist at startup, in production builds, and on edits during development. Invalid edits are diagnosed as `INVALID_RICH_TEXT`, and the development server keeps the last valid catalog. Tag order, nesting, and omission in translations are allowed, and ordinary strings that are not specified keep the existing behavior. This contract also applies to lazy transport and SSR boot data.

Production `vite build --watch` watches catalog changes in the default, manual, and automatic `includeKeys` modes and revalidates on every rebuild. It updates translation copy, lazy chunks, and generated types from the new disk contents. This fix also exists only in the current checkout.

## Selective builds (includeKeys)

`includeKeys` decides which messages are emitted in production. You can pass an exact `namespace:messageId` array as before, or use a `{ from, dynamicKeys? }` object to have the keys found in source. This feature is not in the `0.1.0-alpha.4` release and exists only in the current local checkout.

```js
// 수동 목록
saylo({ localesDir: 'locales', baseLocale: 'ko', includeKeys: ['demo:heading', 'demo:greeting'] });

// 자동 분석
saylo({
  localesDir: 'locales',
  baseLocale: 'ko',
  includeKeys: { from: ['src'], dynamicKeys: ['demo:menuKey'] },
});
```

`from` is a file or directory relative to the Vite root. Directories are scanned recursively, and `.js`, `.ts`, `.jsx`, `.tsx`, `.vue`, and `.svelte` sources are statically analyzed with Babel. Nothing is executed. The analysis preserves `t` and `tParts` calls in `<script>` and template expressions, imported aliases, destructuring aliases, and every key possible from template prefixes and suffixes. Matching strings are not removed even if extra keys remain. Dynamic calls that cannot be resolved fail the build when `dynamicKeys` is absent. Symlinks, paths outside the Vite root, and parse errors are also rejected. Vue script and template code that uses an external `src` refuses automatic analysis, so use a manual key list.

The analysis also tracks translation functions wrapped in type assertions, non-null assertions, or `satisfies`, directly invoked results of `bind`, `call`, and `apply`, and `t` and `tParts` in function arguments and nested destructuring. Direct member access and destructuring of `import * as messages` follow named export aliases that are within the analysis scope. If you pass a translation function as a component prop, constructor argument, or default export, or choose one through a condition or default value, you must list the required keys in `dynamicKeys`.

`from` should include files that define and re-export translators as well. Simple variable aliases of namespace objects and named exports through relative paths within the analysis scope are connected. Cloning a translation export from a confirmed namespace object, passing it outside, or destructuring it with rest requires `dynamicKeys` or a manual `includeKeys` list. Namespaces from unrelated external packages and modules that export only ordinary functions are not counted as translators, and this restriction does not apply to them.

Modules outside `from` are not pulled in automatically. In the current local checkout's production `buildStart`, configured Vite `resolve.alias` entries (strings and regular expressions) are resolved through the Vite plugin resolver to connect named imports and re-exports and namespace imports. Only files already scanned by `includeKeys.from` take part; following a resolution does not widen the scan scope or leave the Vite root. It resolves again on production `build --watch` rebuilds. Aliases that cannot be resolved or remain external, and aliases that point outside the scanned files, stop the build with a diagnostic that names the importer and the path or target involved. The diagnostic suggests fixing `from` or the alias, or using an explicit `includeKeys` list. Official `@0disoft/saylo-*` runtimes and `virtual:saylo` modules keep the existing translator handling, and custom translation exports from other external packages are not followed. This support is a local change that has not been published and is not in `0.1.0-alpha.4`.

In Vue and Svelte, real HTML comments and the `<script>` body are read separately. If a template expression or attribute contains a comment marker such as `<!--` or a script marker, the analyzer stops instead of deleting anything arbitrarily. Files that use this syntax must be handled with a manual `includeKeys` list.

The development server and hot updates are not filtered by this list. Production eager `virtual:saylo`, lazy boot and chunks, and `virtual:saylo/server` (SSR) all use the same selection. `generated.d.ts` produced by `typegen` keeps the whole original base schema. The Babel parser used for key analysis is a Node-side dependency of the dev plugin and is not included in the browser bundle.

`[]` keeps the locale and namespace lists and missing metadata while reducing messages to zero. The list is copied and frozen when the plugin is created. Broken translations or `requireCompleteTranslations` failures are checked before pruning, so they cannot be hidden. Put dynamically determined keys in `dynamicKeys` or leave the option empty. No automatic tree-shaking or performance gain is guaranteed.

## Complete translation check for builds

Enabling `requireCompleteTranslations` (default `false`) checks for missing translation keys and namespaces during Vite production builds. It is available from `0.1.0-alpha.3` and is not included in the existing `0.1.0-alpha.2` release.

```js
import saylo from '@0disoft/saylo-vite';

saylo({ localesDir: 'locales', baseLocale: 'ko', requireCompleteTranslations: true });
```

For every locale folder except hidden folders (including empty folders) and for `initialLocale`, it checks that every base namespace and key exists. Reducing the initial loading scope with `initialNamespaces` does not reduce the check scope. Languages that are in neither a folder nor `initialLocale` are not checked. An empty translation string counts as an existing key, and the language of the translation copy or omission of arguments is not part of the completeness condition. The existing argument type and schema checks still run.

Missing entries are collected as `MISSING_MESSAGE` and `MISSING_NAMESPACE` in `CatalogError.diagnostics` and fail the build. The diagnostics include the locale, namespace, target file, and missing keys, and give the relative path to create for a missing file. The check runs before the generated type file is updated, so the existing file is kept on failure. The development server and live edits keep the existing partial translation and fallback behavior even with the option enabled. Detailed scope and verification are in [complete translation notes](https://github.com/0disoft/saylo/blob/main/docs/42-complete-translations.md).

## Requiring review approval (unpublished)

The current checkout has `requireReviewedTranslations` (default `false`) in the Vite options and in the shared JSON `SayloProjectConfig`. When enabled, the `reviews` path is required; a relative path given directly in the Vite options is resolved from the Vite root, and a path read from JSON by `loadProjectConfig()` is resolved from the JSON file's folder.

```js
saylo({
  localesDir: 'locales',
  baseLocale: 'ko',
  requireReviewedTranslations: true,
  reviews: 'saylo-reviews.json', // Vite root 기준
});
```

It reads the approval file only in production builds and treats `SOURCE_CHANGED`, `TRANSLATION_CHANGED`, and `REVIEW_REQUIRED` states and a missing or corrupted approval file as build failures. Enabling this option also applies the complete translation check and checks base keys in every locale regardless of `initialNamespaces` or `includeKeys`. Deleting a translation cannot bypass approval, and this check finishes before type generation and key pruning. `vite build --watch` also detects approval file changes and checks again.

The development server does not read the approval file and keeps the existing partial translation and fallback behavior. However, option validation also runs during development, so `requireReviewedTranslations: true` without `reviews` is rejected in dev as well.

## Lazy-loading client

`virtual:saylo/lazy` provides the initial pairs and the `catalogSource`. The app creates an instance with the core `createI18n` and connects to the development server with `connectDev`. `typegen.outFile` is relative to the Vite root, so `src/i18n.ts` below imports `../generated.js`.

```ts
// src/i18n.ts
import { createI18n } from '@0disoft/saylo-core';
import { connectDev } from '@0disoft/saylo-vite/client';
import type { AppSchema } from '../generated.js';
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces, timeZone } from 'virtual:saylo/lazy';

export const i18n = createI18n<AppSchema>({
  catalogSource, locale: initialLocale, initialNamespaces, initialCatalogs, timeZone,
});
export const disconnect = connectDev(i18n, { catalogSource });
// 정리: disconnect(); i18n.dispose();
```

The development source is created with push enabled. The server sends only changed pairs among the cached pairs registered with `saylo:catalog-scope` through `saylo:catalog-push`, and the client validates the revision and payload and applies the manifest and cache in one step. Manual `createDevCatalogSource` opts in with `{ push: true }`; the default is `false`. Bad data and gaps are recovered through the existing snapshot and pair lookups, and `stop` and `dispose` release only the owner's subscription. To use a source you create yourself, pass it as `createDevCatalogSource(manifest, initialCatalogs, { hot, push: true })`.

TS and checkJs consumers add `["vite/client", "@0disoft/saylo-vite/virtual"]` to `compilerOptions.types`.

`virtual:saylo` is the eager path that loads the whole catalog at once. Create the eager store from `initialCatalogs`, `baseLocale`, `initialLocale`, and `timeZone` from `virtual:saylo`.

## Synchronization state

`connectDev` reports the development server handshake state through `onSyncState(state)` on both the eager and lazy paths. `state` is a frozen object `{ status, attempt, maxAttempts: 3 }`, and `status` is one of `idle`, `connecting`, `retrying`, `connected`, `disconnected`, `failed`, or `stopped`. `attempt` is 1 in `connecting`, 2 or 3 in `retrying`, and the last attempt value in `failed`; it is 0 in the other states.

In the unpublished source, eager `connectDev` and `createDevCatalogSource` accept an optional `runtime: { schedule, createId }`. `schedule(milliseconds, callback)` must run the callback later and return an idempotent cancel function, and `createId()` must return a unique string per connection. When omitted, the default timer and cryptographically random values are used. Positive fractional `requestTimeoutMs` values are rounded up, as in core. The lazy bridge's timer is configured on `createDevCatalogSource`.

```ts
connectDev(i18n, {
  catalogSource,
  onSyncState: state => console.log(state.status, state.attempt),
});
```

This state reflects the snapshot and manifest handshake, not the loading of individual lazy catalogs or whether a screen rendered successfully. `onDiagnostic` continues to handle locale file diagnostics. On the lazy path, `getSyncState` and `subscribeSyncState` on `DevCatalogSource` are optional methods, so type compatibility with external sources created before this API is preserved. Production has no hot context, so eager `connectDev` returns a noop and does not call the state callback. The retry policy is unchanged, and the default per-request timeout is 5000ms.

This API is provided in the current checkout and the `0.1.0-alpha.5` candidate tarball. It is not in the current npm release `0.1.0-alpha.4`, and the candidate has not been published yet. The contract is described in [development sync state](https://github.com/0disoft/saylo/blob/main/docs/dev-sync-state.md).

## Behavior scope

In the current checkout, a synchronous exception from `onDiagnostic` does not stop translation updates or bindings or other diagnostic subscribers. A synchronous exception from `DevCatalogSource.subscribeManifest` is reported to `observer`, and normal manifest acceptance, updates to other subscribers, and pending catalog requests continue. The lazy bridge also ignores diagnostics scheduled after stop. Errors from a diagnostic callback itself are not reported back through the same callback, and the consumer handles a rejected Promise from an async callback. This isolation is a change after the alpha.4 release and is subject to final candidate verification.

For support material, connect `onDiagnostic` and `onSyncState` from `createSupportRecorder()`, produce `getReport()` as JSON, and review it. The report contains only the error code, numeric position, connection state, and allowed environment versions of the most recent 32 diagnostic events; it excludes error text, file names, translation keys, and request IDs. It does not collect or send anything automatically. `clear()` resets the record and state. This API is also provided in the current checkout and the `0.1.0-alpha.5` candidate tarball, and is not in the current npm release alpha.4. The detailed contract and usage are in [support diagnostics](https://github.com/0disoft/saylo/blob/main/docs/support-report.md).

The plugin watches files and publishes only valid catalogs, and the client receives snapshots and passes them to the app. If a base schema change makes existing translations invalid, the plugin removes only the invalid messages from that file's last-good translation and publishes it, and missing messages fall back to the base locale values. An invalid translation edit keeps that file's last-good version while changes to other files continue to apply. A new translation file with no last-good version is not published, and deleting the file also removes its last-good version. When the base or a translation is fixed, it is revalidated and restored automatically. Core `createStore` and `replaceCatalogs` do not isolate automatically; startup and builds validate the whole catalog strictly. Isolation happens only in this plugin. In production, `astRuntime` removes the parser runtime at Saylo AST boundaries when enabled, and the parser is still included if the app calls `parseCatalog` directly. Core and the store do not touch the DOM directly, so the app renders snapshots to update the screen. Vite does not replace app modules.

SSR uses `@0disoft/saylo-vite/server` and `virtual:saylo/server`. The example is in the repository's [SSR example](https://github.com/0disoft/saylo/tree/main/examples/ssr).

## Related packages

- [@0disoft/saylo-core](https://github.com/0disoft/saylo/tree/main/packages/core#readme) — `createI18n`
- [@0disoft/saylo-react](https://github.com/0disoft/saylo/tree/main/packages/react#readme) — React bindings
- [@0disoft/saylo-typegen](https://github.com/0disoft/saylo/tree/main/packages/typegen#readme) — dev type generation

## Documentation

- [Production builds and SSR](https://github.com/0disoft/saylo/blob/main/docs/05-build-and-ssr.md)
- [Update protocol](https://github.com/0disoft/saylo/blob/main/docs/08-update-protocol.md)
- Repository [README](https://github.com/0disoft/saylo#readme)

## Versions

Supports Node.js 24.x. `engines.node` is `24.x`, and the local verification environment is Node 24.18.0. It is verified against TypeScript 7, and `typescript` is not enforced as a peer.

The runtime target is ES2022, and it runs in the Vite development server and build. The peer requirement is Vite 8.

## Questions and security reports

Send general questions, feature proposals, and bugs to [rodisoft1@gmail.com](mailto:rodisoft1@gmail.com). Include the package and version, the environment, expected and actual behavior, and a minimal reproduction built from synthetic data. Report security issues privately to the same email with a `Saylo security` subject. Do not send tokens, keys, cookies, or real user data.

If you installed the Vite package, you can read the fuller guidance in `node_modules/@0disoft/saylo-vite/docs/support.md` and `security.md`. These notes and the contact change are included in the current checkout and the `0.1.0-alpha.5` candidate tarball, but not in the existing alpha.4 tarball. The candidate has not yet been published to npm.

## License

Apache-2.0. The distribution tarball includes the repository root `LICENSE` and `NOTICE`.
