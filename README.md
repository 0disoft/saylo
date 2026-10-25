# Saylo

The published `0.1.0-alpha.7` release includes [production catalog compaction](docs/production-catalogs.md), with automatic size thresholds and opt-in compact SSR boot JSON. Existing runtime catalog shapes and the default boot format are preserved.

The published `0.1.0-alpha.7` release also includes [i18next namespace migration](docs/migration.md), with a read-only preview, key mappings, cardinal plural conversion, and exclusive file output.

The release adds [`saylo init`](docs/init.md) for adding the catalog pipeline to an existing Vite app. It previews seven file changes, connects static Vite configs, and creates a typed per-owner store factory.

The source checkout also provides [`saylo init --framework sveltekit`](docs/init-sveltekit.md), adding an isolated SSR route with hydration, locale persistence and Svelte context. This preset has not been published yet.

The source checkout also contains guides for unpublished additions: the [React init preset](docs/init-react.md), [message fallback chains](docs/fallback-chains.md), [translation metadata and reviewer attribution](docs/translation-metadata.md), [Gettext PO exchange](docs/translation-po.md), [local translation review UI](docs/local-review.md), [directory migration and static call rewriting](docs/migration-directory.md), and [catalog cache budgets](docs/cache-budgets.md). These describe source checkout behavior and are not part of `0.1.0-alpha.7`. The review UI binds only to loopback with a per-process token; reviewer names are audit context, not identity proof. The Vue adapter remains private, and its [release readiness guide](docs/vue-release-readiness.md) is a repository reference.

Added a [Vue getting-started guide](docs/getting-started-vue.md) for starting a Vue app outside the repository. `npm run prepare:starter:vue -- --out-dir <empty-directory>` exports four source tarballs and an example, and you install and run them in that folder.

The local starters for React 19 and Svelte 5 are exported to folders outside the repository in the same way. Export them with `npm run prepare:starter:react -- --out-dir <empty-directory>` and `npm run prepare:starter:svelte -- --out-dir <empty-directory>`, and verify locally with `npm run verify:starter:react:local` and `npm run verify:starter:svelte:local`. The guides are in [React local starter](examples/react-starter/README.md) and [Svelte local starter](examples/svelte-starter/README.md). The procedure for starting from the published npm `alpha` in an empty folder is in the [React getting-started guide](docs/getting-started-react.md) and the [Svelte getting-started guide](docs/getting-started-svelte.md).

Added a local adapter for Vue 3. It provides `app.use()` connection, typed context, reactive snapshots, component subscription cleanup, and per-request SSR; it is still a private workspace package and is not part of the published targets. For the API, see the [Vue adapter](packages/vue/README.md); for preserving input and modals while saving translations, see the [Vue demo](examples/vue/README.md). Run it with `npm run dev:vue`. The [Vue SSR demo](examples/vue-ssr/README.md), which connects server HTML in the browser, runs with `npm run dev:vue:ssr`.

Saylo is an i18n (internationalization) library that aims to show translation copy edits on screen immediately during development without waiting for a recompile. It supports JavaScript and TypeScript projects, and aims to reflect copy edits, locale additions, and namespace additions from the development server while preserving existing DOM state such as input forms and modals. State preservation applies to edits that do not break the schema used by existing call sites. The scope of key deletion, adding required arguments, and restarting the Vite server is covered by [Product and scope](docs/01-product-and-scope.md).

## Current status

- The five public packages are published as `0.1.0-alpha.7` under dist-tag `alpha`. The [alpha.7 release record](releases/0.1.0-alpha.7.md) is the authoritative summary of changes, source, publication, and verification; the [CI-approved manifest](releases/0.1.0-alpha.7.json) records the five artifact integrities. The release includes `saylo init`, i18next namespace migration, production catalog compaction, and the Svelte and translator fixes listed in the record. `latest` remains the registration placeholder `0.0.0-stage`, so install with `@alpha`. Vue remains private at `0.1.0-alpha.4` with its core dependency on `0.1.0-alpha.7`.

- The previous five-package release was `0.1.0-alpha.6` with dist-tag `alpha`. It fixed a false direct-import warning for CSS or Tailwind watch-only modules with no resolved file ID. Publication and registry acceptance are recorded in the [alpha.6 release record](releases/0.1.0-alpha.6.md), and the [CI-approved manifest](releases/0.1.0-alpha.6.json) records the five artifact integrities.
- The earlier `0.1.0-alpha.5` release included rich text, catalog translation workflows, synchronization diagnostics, cancellation controls, large-catalog optimizations, and English install-time documentation. Its publication and registry acceptance remain in the [alpha.5 release record](releases/0.1.0-alpha.5.md) and the [CI-approved manifest](releases/0.1.0-alpha.5.json).
- The `0.1.0-alpha.4` release passed five Trusted Publisher OIDC authentications, 229 tests, consumer type checks, and publication in the 2026-10-11 [CI release](https://github.com/0disoft/saylo/actions/runs/38088660390). CI and the registry tarball SHA-512 checks, published JS/TS, React and Svelte selector SSR, and SvelteKit browser verification also passed. Changes and verification are in the [release record](releases/0.1.0-alpha.4.md), and approved integrity is in the [manifest](releases/0.1.0-alpha.4.json). Re-check with `npm run verify:registry:alpha4` and `npm run verify:registry:sveltekit:alpha4`.
- The complete translation check and the publication and consumer verification for the previous `0.1.0-alpha.3` are preserved in the [release record](releases/0.1.0-alpha.3.md). The approval manifests and verification commands for past versions are kept as well.
- The publication and verification record for the previous `0.1.0-alpha.2` is kept in the [release record](releases/0.1.0-alpha.2.md) and the [manifest](releases/0.1.0-alpha.2.json). Re-check with `npm run verify:registry:alpha2` and `npm run verify:registry:sveltekit`, and the `alpha.1` verification is kept as well.
- The [SvelteKit 3 example](examples/sveltekit/README.md) verified per-request SSR, boot, hydration, page navigation in a shared layout, preservation of input and modals after saving translations, and exit and re-entry. SSR and language switching in a real Node production build were also verified. Run it with `npm run dev:sveltekit` after `npm run setup:sveltekit`. The example is an independent private app that uses local package copies and did not change the main project or the public package versions. Detailed scope is in [39](docs/39-sveltekit-example.md).
- Implemented the Svelte 5 adapter in `packages/svelte`. Verified `$i18n` subscription, typed context, snapshot-bound translation, JS/TS consumption, and SSR/hydration, and confirmed in the [Svelte demo](examples/svelte/README.md) that input and modals were preserved after file saves, locale addition, selection, and deletion. Run it with `npm run dev:svelte`. Implementation scope is in [38-svelte-adapter.md](docs/38-svelte-adapter.md), and current publication status follows the release record above.
- `packages/core` contains catalog parsing and schema validation, a translator, and an immutable store. It builds ESM JavaScript and `.d.ts` files in the local npm workspace. Removed `private` from the four public packages and published the first version `0.1.0-alpha.1` (dist-tag `alpha`) to npm on 2026-10-06. The root workspace package remains `private`.
- The current API is `parseCatalog`, `createBaseSchema`, `validateTranslation`, `createTranslator`, `createStore`, `createI18n`, and the error classes. `packages/vite` supports modifying, adding, and deleting catalog files, eager connection and lazy pair lookup with partial transport, and quarantine of existing translations when the base schema changes. `packages/react` provides typed context and a snapshot-bound hook that accept eager and lazy instances. `packages/typegen` provides a CLI and worker that generate type declarations from the base schema. In the vanilla and React demos, saving a file preserves the form and modal while updating copy and the locale and namespace lists. The lazy production path inlines boot pairs and splits the remaining pairs into static chunk loaders. Implemented the SSR boot serializer, per-request instance, and React hydration adapter, and completed the full check and real browser verification.
- The `@0disoft/saylo-core/runtime` subpath entry and `astRuntime` in `packages/vite` (default `true`, production only) remove the parser runtime only at the Saylo core formatter boundary. The public runtime entry omits `parseCatalog`, and the root entry keeps the existing API. Quarantine and this parser removal are included in the `0.1.0-alpha.2` release.
- For the latest features and package status, follow the Vite, React, Svelte, and typegen sections below and the [package READMEs](docs/README.md). `includeKeys` automatic analysis (`{ from, dynamicKeys? }`) and lazy dev push are included in alpha.5 and are absent from alpha.4.
- The latest representative local performance targets are the conditions in [75](docs/75-early-disk-rechecks.md). The p95 for applying an edit is 49.57ms for small and 80.25ms for large, within the 100ms target; the p95 for a single locale-list request is 77.46ms for small and 177.83ms for large, within the 250ms target. These are not generalized to other environments.
- Past performance experiments, measurement chronology, and raw results are in the [documentation index](docs/README.md), [validation history](docs/06-validation-history.md), and [live-update benchmark](benchmarks/live-update/README.md). Re-measure with `npm run bench:live`.

## Running locally

Run from the repository root with Node.js and npm. The supported version is Node 24.x; the verification environment is Node.js 24.18.0 and TypeScript 7.0.2.

```sh
npm install
npm run check
```

`check` builds ESM and declaration files, runs catalog validation tests, and checks TS and checkJs consumer types. To build only, use `npm run build`; for build and runtime tests, use `npm test`.

Run pack consumer verification with `npm run verify:pack`. It packs the workspace packages into tarballs, installs them into a JS and TS app in a temporary directory outside the repository, checks type generation with the installed `saylo-typegen`, JS checkJs and TS strict type checking, Node translation, argument rejection, React SSR, public subpath imports, and a Vite production lazy chunk build, and then removes the temporary directory. Peers and tools are installed from the npm registry, so the network is required.

Run the form demo with `npm run dev` and open the local address shown in the terminal. Edit and save copy in `examples/vanilla/locales/ko/demo.json` or `en/demo.json` in your editor. You can check that input values, focus, cursor, scroll position, and an open modal are preserved. If JSON breaks or the translation contract is violated, the last valid state and per-file diagnostics are kept. `npm run build:demo` validates the catalogs currently on disk and builds the demo.

Selective builds keep only the keys the screen uses. Run `npm run build:demo:selected` (output `examples/vanilla/dist-selected/`) and check the result with `npm run preview:demo:selected`. `includeKeys` accepts a manual `string[]` or automatic analysis with `{ from: ['src'], dynamicKeys?: ['demo:key'] }`. Automatic analysis reads JS, TS, JSX, TSX, Vue, and Svelte source statically without executing it, and an unresolvable dynamic call fails the build when `dynamicKeys` is absent.

```js
// vite.config.mjs
saylo({
  localesDir: 'locales',
  baseLocale: 'ko',
  includeKeys: { from: ['src'], dynamicKeys: ['demo:menuKey'] },
});
```

Add the `saylo({ localesDir: 'locales', baseLocale: 'ko' })` plugin to the Vite configuration. The file layout is `<localesDir>/<locale>/<namespace>.json`. The app creates a store from `initialCatalogs`, `baseLocale`, `initialLocale`, and `timeZone` from `virtual:saylo`, and attaches the development connection with `connectDev(store, { onDiagnostic })` from `@0disoft/saylo-vite/client`. The returned release function disconnects and can reconnect. `store.dispose()` and Vite dispose and prune also clean up the connection. TS and checkJs consumers include `@0disoft/saylo-vite/virtual` in `compilerOptions.types`.

Development transport supports both eager and lazy paths. `virtual:saylo` provides the existing full registry, and eager updates go only to the Vite client that requested that connection. `virtual:saylo/lazy` loads only the initial base and target pairs, then receives manifests without copy and looks up only the changed loaded pairs. Applying a manifest re-queries the currently desired scope; if the previously received pair version matches the server record, it receives a delta of changed messages based on that version, and otherwise it receives a full present/missing response. A delta is a message-level upsert, removal, or position update, and the client fixes the baseline per request so it publishes once regardless of the response order across multiple instances. When positions move as a group, they can be compressed into a single shift instead of a list. Pairs not yet cached do not receive an AST and only track the version update in the manifest. Changes to a cached inactive locale pair do not change the UI snapshot. New namespaces are loaded through a general lookup. The first connection, revision gaps, new sessions, and reconnections recover through a manifest handshake with a request ID and generation. Late pair responses are judged against the current session, version, and schema. The `virtual:saylo/lazy` development source enables push, registers cached pairs with `saylo:catalog-scope`, and the server sends only changed pairs with `saylo:catalog-push`. The client validates the payload and revision and applies the manifest and cache in one step. Live updates do not replace app modules. Restarting the Vite server can reload the page.

Ordinary change events are coalesced into the next turn, and the final file contents are read again when reading. The add/unlink label on a watch event is not trusted as-is. Adding a new path with no previous state is read immediately in the next turn. Events that need disk stabilization, such as add/unlink of an existing path, are grouped with a 40ms quiet window, and if events continue, reading starts after at most 200ms. A second save swallowed by Vite's short throttle window is caught by disk rechecks at 10, 30, and 60ms (product `packages/vite/src/disk-rechecks.ts`). A save that replaces a temporary file is judged by the state of the final path. Deleting every catalog for the current locale switches to the base language. Deleting a base namespace removes it from the list, and remaining translation files are revalidated when the base namespace is restored. Production builds strictly reject translation files without a base, so remove translation files together when removing a namespace. Deleting every catalog in the base locale is rejected and the last valid state is kept. If a new translation file arrives before the base file and fails validation, the candidate is revalidated automatically once the base file appears. `.d.ts`, hidden JSON, and `.json.tmp` files are excluded from the Saylo catalog scope.

Run the React demo with `npm run dev:react`. It shares the same catalogs in `examples/vanilla/locales` and the existing styles, and manages input values, quantities, and the modal with React state. It initially loads only the Korean `demo` and looks up the English pair when English is selected. A new namespace appears in the list and is loaded explicitly when its button is pressed. `npm run typegen:react` only generates types. `npm run build:react` runs in the order: package build → current disk validation and type generation → demo TS check → Vite production build.

React selective builds keep only the keys the screen uses. Run `npm run build:react:selected` (output `examples/react/dist-selected/`) and check the result with `npm run preview:react:selected`. `demoKeys` in `examples/react/selected-keys.mts` is used by both the build and the screen types; store and hook types are narrowed to `DemoSchema` in the development, default, and selective builds, while the generated `generated.d.ts` type keeps the full base schema. For key list management and verification, follow the [React demo](examples/react/README.md).

```js
import { parseCatalog, createBaseSchema, validateTranslation, createTranslator } from '@0disoft/saylo-core';

const base = parseCatalog('{"items":"{count, number}개"}', {
  locale: 'ko', namespace: 'cart', sourceName: 'locales/ko/cart.json'
});
const translation = parseCatalog('{"items":"{count, plural, one {# item} other {# items}}"}', {
  locale: 'en', namespace: 'cart', sourceName: 'locales/en/cart.json'
});
const schema = createBaseSchema(base);
validateTranslation(schema, translation);

const i18n = createTranslator({
  locale: 'en', baseCatalogs: [base], translations: [translation], timeZone: 'UTC'
});
i18n.t('cart:items', { count: 3 }); // "3 items"
```

Translations cannot add keys or arguments that are not in the base or require a narrower type than the base. Omitting keys and arguments is allowed. Errors report the code, file name, ID, and possible source location in `CatalogError.diagnostics`. Current parse results and schemas are deeply frozen object shapes, and `createBaseSchema` reuses the schema object it created for the same deeply frozen catalog. The catalog record for rendering and store snapshots are built in later stages. The schema fingerprint is the UTF-8 SHA-256 of JSON that normalizes the namespace and the acceptedTypes of keys and arguments, prefixed with `saylo-schema-v2:sha256:` plus 64 hexadecimal digits, 87 characters in total. It stays the same when only copy or key order changes.

`parseCatalog` optionally accepts the previous `ParsedCatalog` as its third argument. If you pass a deeply frozen catalog with the same locale, namespace, and sourceName, messages whose copy is unchanged reuse the previous AST and arguments, while the whole JSON and changed messages are still validated and source locations are updated against the new file. The Vite registry, which re-reads files during development, passes the previous catalog automatically.

The translator fixes the catalogs, locale, and timeZone at creation. Pass only the catalogs for the selected locale in `translations`. A missing key or namespace translation falls back to the baseLocale copy, and numbers and dates are formatted with the locale that copy came from. An empty string translation is kept as-is. Call arguments are validated against the base schema regardless of whether the translation omits arguments, numbers must be finite, and Date must be a valid date. Both the general date and time styles and the skeletons apply timeZone, which defaults to UTC.

`UnknownMessageError` indicates a missing key, `NamespaceNotLoadedError` a namespace that is not loaded, and `InvalidArgumentError` a missing required argument or a type error. `t()` returns plain text. Tag strings are kept literal, so put them in the DOM with `textContent` or the framework's text rendering.

In TypeScript, connect key and argument types with `createTranslator<AppSchema>(options)`; in JS, use the JSDoc `Translator<AppSchema>`. AppSchema can be generated from the base messages or written by hand. For union calls where the argument kinds and keys are uncertain, narrow the key first.

## Eager store

```js
import { createStore } from '@0disoft/saylo-core';

const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs: [base, translation] });
const initialSnapshot = store.getSnapshot();
const unsubscribe = store.subscribe(snapshot => {
  // 갱신할 텍스트 노드에만 snapshot.t(...)를 연결한다. 폼 전체를 다시 만들지 않는다.
  console.log(snapshot.t('cart:items', { count: 3 }));
});
store.setLocale('ko');
store.replaceCatalogs([base, translation]);
unsubscribe();
store.dispose();
```

`createStore` is a synchronous prototype that loads every catalog up front. `getSnapshot()` returns the same object when the UI state is the same. `store.t` reads the latest state, and `t` on an earlier snapshot keeps reading the earlier state. `replaceCatalogs` replaces the whole registry and switches to baseLocale if the current locale is removed. Passing the same copy again or changing copy only in an existing inactive locale does not notify the UI again. Changes to the locale or namespace list are notified. After catalog changes, messages and Intl caches for the same time zone are reused.

A candidate is published after validating every translation contract, and subscribers are notified once per transaction. A change requested during a subscription is published after every subscriber of the current snapshot finishes. Subscriber errors are delivered as `AggregateError` after notifying the remaining subscribers, and an already published state is not rolled back. `unsubscribe` and `dispose` are safe to call repeatedly. Adapters register cleanup of owned resources with `store.onDispose(cleanup)` and unregister with the returned function. If cleanup raises an error, the remaining cleanup finishes and the error is then delivered as `AggregateError`. Lazy loading and partial transport are implemented in the lazy path, and secondary quarantine in the Vite plugin. Core `createStore` itself does not isolate automatically and rejects the entire invalid candidate. Edits that break existing screen calls by deleting keys or adding required arguments are outside the DOM preservation scope.

## Lazy-loading core

`createI18n` is a synchronous constructor. It immediately creates the instance and initial snapshot from boot catalogs and the manifest, and `setLocale` and `loadNamespace` handle locale and namespace pair lookups. Both methods return `Promise<void>`. They publish once when all required base and target pairs are settled as present or missing, and keep the previous snapshot while waiting or when a lookup fails. Missing translations fall back to the base, and lookup failures are distinguished with `CatalogLoadError`. Complementary language switches and namespace additions complete together, and only a language choice that is actually replaced is canceled with `SupersededRequestError`.

The current creation options are `catalogSource`, `locale`, `initialNamespaces`, `initialCatalogs`, and optional `timeZone` and `requestTimeoutMs`. The manifest contains the full locale and namespace lists and, for each known pair, the version, schema fingerprint, and missing tombstone. Boot pairs state their results completely, and later results are checked against the current session, pair version, and schema. `refresh()` is used when an adapter re-prepares the currently desired scope after a manifest change. A global revision alone does not discard valid results for unrelated namespaces. The default timeout is 5 seconds per catalog, and dispose cleans up requests, timers, and owned listeners.

`npm run demo:lazy` is a Node demo that switches language and loads the cart namespace at the same time. It keeps the Korean snapshot while looking up, then publishes English common copy and the Korean cart fallback in one commit. JS/checkJs and TS consumer fixtures check the same key and argument types. The current path is a prototype that accepts parsed catalogs. In development, Vite supports the general loader, partial transport, and React connection. The production path uses `createStaticCatalogSource(initialManifest, initialCatalogs, entries)` to inline only boot pairs and split the remaining present pairs into generated literal `import()` loader entries. Failures and session, version, fingerprint, or key mismatches are not reflected in the cache, and a missing tombstone is returned without an import. The SSR boot snapshot is implemented locally with `createBootSnapshot`, `serializeBootSnapshot`, and `decodeBootSnapshot`. The current wire format serializes the parsed catalog's sourceName, locale, AST, and arguments as arrays. The public UI snapshot is `StoreSnapshot`, and the transport unit is `CatalogOutcome`. The `CatalogRecord` and `Map` drafts are not used.

Connect a lazy app as shown below. The Vite `initialNamespaces` option sets the boot scope; when omitted, it is all base namespaces. A source can be shared by multiple instances and cleans up its own registered HMR listeners after the last connection is released.

```js
import { createI18n } from '@0disoft/saylo-core';
import { connectDev } from '@0disoft/saylo-vite/client';
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces, timeZone } from 'virtual:saylo/lazy';

const i18n = createI18n({ catalogSource, locale: initialLocale, initialNamespaces, initialCatalogs, timeZone });
const disconnect = connectDev(i18n, { catalogSource });
await i18n.setLocale('en');
// 현재 manifest에 있는 namespace를 필요할 때 로드한다.
// await i18n.loadNamespace('help');
// 종료 시 disconnect(), i18n.dispose()로 소유 자원을 정리한다.
```

## Automatic type generation

Add `typegen: { outFile: 'generated.d.ts' }` to the Vite plugin. outFile is a `.d.ts` path relative to the Vite root. The React demo imports the generated `AppSchema` from `examples/react/generated.d.ts`.

```js
saylo({
  localesDir: '../vanilla/locales',
  baseLocale: 'ko',
  typegen: { outFile: 'generated.d.ts' }
});
```

Only the base namespace, key, and argument schema feed the types. Arguments used in any ICU branch are also generated as required, with numbers as `number`, ordinary interpolation as `number | string`, and dates as `Date | number`. An argument used for several purposes in the base follows the intersection type determined by core. Key and argument names are escaped as string literals and sorted, so changing only input order or copy produces the same declarations.

Initial dev serve waits for type generation to complete. After a live catalog publication, it runs the worker in the background and the screen update path does not wait for completion. Consecutive saves are merged into the latest generation, and writes from earlier results are blocked. It replaces the temporary file with the final path only when the declaration content changes, and excludes only the generated file and its temporary file from Vite watching. A type generation failure keeps the last declaration and writes diagnostics to the development server log. An initial generation failure stops server startup. IDE completion updates after generation completes and the IDE re-checks.

Run the CLI in the repository as follows. It validates all catalogs currently on disk before writing declarations for the base schema, so an invalid translation file also exits with an error.

```sh
npm run typegen:react
# 직접 호출할 때는 패키지를 먼저 빌드한다.
node packages/typegen/dist/cli.js --locales-dir examples/vanilla/locales --base-locale ko --out-file examples/react/generated.d.ts
```

## React connection

Verified on React 19. Create the factory once per module and use the Provider and hook from the same factory together. Get AppSchema from the declaration generated by typegen.

```tsx
import { createRoot } from 'react-dom/client';
import { createStore } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';
import { connectDev } from '@0disoft/saylo-vite/client';
import { initialCatalogs, baseLocale, initialLocale, timeZone } from 'virtual:saylo';
import type { AppSchema } from './generated';

const store = createStore<AppSchema>({ baseLocale, locale: initialLocale, catalogs: initialCatalogs, timeZone });
const { SayloProvider, useI18n } = createSayloReact<AppSchema>();

function Preview() {
  const { t, locale, setLocale, stateRevision } = useI18n();
  return <>
    <h1>{t('demo:heading')}</h1>
    <p>{t('demo:summary', { count: 3 })}</p>
    <button onClick={() => setLocale(locale === 'ko' ? 'en' : 'ko')}>언어 전환</button>
    <small>{stateRevision}</small>
  </>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<SayloProvider instance={store}><Preview /></SayloProvider>);
const disconnect = connectDev(store);
// 앱 종료 시 root.unmount(), disconnect(), store.dispose() 순서로 정리한다.
```

`useI18n` subscribes with `useSyncExternalStore` and returns the immutable snapshot for that render and `setLocale`. `t` from an earlier render keeps reading the earlier translations, while `store.t` reads the latest translations. With the same snapshot and instance, the hook result and the `setLocale` reference stay stable. Edits to unchanged copy or an inactive locale do not re-render subscribed components. The Provider does not own the lifetime of the store it receives, so the store can be used in another screen after unmount. The app that owns the store releases the React root and development connection, then calls `store.dispose()`.

The Provider accepts both `createStore` and `createI18n`. The hook's `setLocale` return type is `void | Promise<void>`, and failures from lazy calls are handled with await/catch. A lazy instance also provides `loadNamespace` with the same function reference, and an eager instance does not have that function. While preparing the required pairs, the hook reads the previous snapshot and publishes once when preparation finishes.

In JS/checkJs, the `SayloReactBindings<AppSchema>` and `Store<AppSchema>` JSDoc can connect the same key and argument checks. Consumer examples are in `packages/react/test/consumer-js.js` and `consumer.tsx`. The hooks from `createSayloReact` pass `getServerSnapshot` as the third argument to `useSyncExternalStore`. SSR hydration is supported by passing `createHydrationAdapter` from `@0disoft/saylo-react` to the Provider instead of `instance`.

## SSR

The server creates an instance per request and serializes the boot snapshot after the scope is ready. The client decodes that JSON and hydrates with the same boot S1, and live updates are applied once after the hydration barrier completes.

The server prepares the request scope before rendering with `createRequestI18n` from `virtual:saylo/server`. In development, the Node registry handle provides the latest read and load and unregisters when the server exits; production uses a static import source.

```js
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { serializeBootSnapshot } from '@0disoft/saylo-core';
import { createRequestI18n } from 'virtual:saylo/server';
import { App, SayloProvider } from './app.mjs'; // examples/ssr의 공유 컴포넌트

const request = await createRequestI18n({ locale: 'en' });
try {
  const html = renderToString(h(SayloProvider, { instance: request }, h(App)));
  const boot = serializeBootSnapshot(request.getBootSnapshot()); // committed scope만 직렬화
  // boot를 <script type="application/json" id="saylo-boot">의 textContent에 넣는다.
} finally { request.dispose(); }
```

```js
import { createElement as h } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { createI18n, decodeBootSnapshot } from '@0disoft/saylo-core';
import { createHydrationAdapter } from '@0disoft/saylo-react';
import { connectDev } from '@0disoft/saylo-vite/client';
import { catalogSource } from 'virtual:saylo/lazy';
import { App, SayloProvider } from './app.mjs';

const decoded = decodeBootSnapshot(document.getElementById('saylo-boot').textContent);
const client = createI18n({ initialSnapshot: decoded, catalogSource });
const adapter = createHydrationAdapter(client);
connectDev(client, { catalogSource });
const root = hydrateRoot(document.getElementById('root'), h(SayloProvider, { instance: adapter },
  h(App, { onHydrated: adapter.finishHydration }))); // 예제 App은 effect에서 onHydrated를 호출한다.
// unmount 시 root.unmount(), adapter.dispose(), client.dispose()를 호출한다.
```

`createI18n` accepts either the existing parsed scope options (`locale`, `initialNamespaces`, `initialCatalogs`) or `initialSnapshot` plus `catalogSource`. When created from boot, the first manifest is fixed to the boot even if the source is newer, and `getServerSnapshot` keeps the snapshot identity from creation time. `getBootSnapshot` serializes only the currently committed scope.

Create `createHydrationAdapter(instance)` anew for each root. The adapter keeps boot S1 while buffering only the latest underlying snapshot, and it publishes once when `finishHydration()` is called. `getServerSnapshot` keeps returning S1 afterward. `adapter.dispose()` releases only the subscriptions it created, so the app cleans up the original instance separately with `client.dispose()`.

The runnable SSR fixture is in `examples/ssr/`; `npm run demo:ssr` runs renderToString for simultaneous ko/en requests and checks the boot locale, then exits. `npm run dev:ssr` starts a real SSR server at 127.0.0.1:5190/?locale=en and verifies client hydrateRoot (StrictMode) and live connectDev.

## Release

The current published version is `0.1.0-alpha.7` for the five public packages under dist-tag `alpha`. See the [alpha.7 release record](releases/0.1.0-alpha.7.md) and [CI-approved manifest](releases/0.1.0-alpha.7.json) for publication and artifact details. The first version `0.1.0-alpha.1` of core, react, typegen, and vite was published on 2026-10-06, and Svelte is included from `alpha.2` on 2026-10-09. The contract and procedure are in [Release](docs/09-release.md). `latest` points to the registration placeholder `0.0.0-stage`, so specify `@alpha` when installing the current alpha, as in `@0disoft/saylo-core@alpha`. To install a past version, specify the version as in `@0disoft/saylo-core@0.1.0-alpha.1`.

```sh
npm run release:check -- --version 0.1.0-alpha.7 --tag alpha
npm run check
npm run release:pack
```

`@0disoft/saylo-svelte` was added to the current release targets. `release:check` checks the version, license, `engines`, `publishConfig`, and internal dependency versions of the five packages. `release:pack` installs the five tarballs into a consumer app outside the repository, verifies them, and leaves the tarballs and `manifest.json` in `.release/npm/`. `verify:registry` compares the existing four `alpha.1` packages, `verify:registry:alpha2` the five `alpha.2` packages, and `verify:registry:alpha3` the five `alpha.3` packages against their approval manifests. `verify:registry:sveltekit` verifies a SvelteKit app with the approved `alpha.2` release, and `verify:registry:sveltekit:alpha3` with the `alpha.3` release. The GitHub Actions [release.yml](.github/workflows/release.yml) runs on manual dispatch, authenticates first regardless of whether it will publish when `verify_oidc=true`, and publishes only when `publish=true`. OIDC authentication, publication, download, and installation verification for the five packages are complete.

`npm run verify:registry:alpha6` exited 0 after independent JS/TS installs, CLI, checkJs/types, core and React SSR, Svelte selector and rich SSR, lazy Vite build, installed synchronization states, and sanitized support reports. `npm run verify:registry:sveltekit:alpha6` also exited 0 after an independent SvelteKit install, typecheck and client/SSR builds, concurrent ko/en SSR, canonical locale and base fallback, lazy synchronization/support and cleanup lifecycle, production HTTP, Chromium hydration, ko/en/ko switching, shared-layout state retention, and exit/re-entry. Historical alpha.5 verification remains available with `npm run verify:registry:alpha5` and `npm run verify:registry:sveltekit:alpha5` using its [manifest](releases/0.1.0-alpha.5.json).

## Design direction summary

When the development server detects a file change, it parses only that file. A base schema change also revalidates affected translations. It delivers catalog snapshots (or patches) per locale and namespace to the client store and re-renders subscribers when a visible UI change occurs. A normal translation change does not wait for JS code generation or typegen completion and does not invalidate whole app modules or do a full reload. Time spent on parsing and validation remains. The single source for the update wire protocol is [docs/08-update-protocol.md](docs/08-update-protocol.md).

## Packages

| Package | npm | README |
| --- | --- | --- |
| `@0disoft/saylo-core` | [npm](https://www.npmjs.com/package/@0disoft/saylo-core) | [packages/core/README.md](packages/core/README.md) |
| `@0disoft/saylo-react` | [npm](https://www.npmjs.com/package/@0disoft/saylo-react) | [packages/react/README.md](packages/react/README.md) |
| `@0disoft/saylo-svelte` | [npm](https://www.npmjs.com/package/@0disoft/saylo-svelte) | [packages/svelte/README.md](packages/svelte/README.md) |
| `@0disoft/saylo-typegen` | [npm](https://www.npmjs.com/package/@0disoft/saylo-typegen) | [packages/typegen/README.md](packages/typegen/README.md) |
| `@0disoft/saylo-vite` | [npm](https://www.npmjs.com/package/@0disoft/saylo-vite) | [packages/vite/README.md](packages/vite/README.md) |

The example that runs directly in Vite without a framework after installation is in [examples/npm/README.md](examples/npm/README.md).

## Questions and security reports

For general questions, feature proposals, and bugs, see [Support](SUPPORT.md); for private security reports, see [Security](SECURITY.md). The Vite package's install folder also includes these guides. The documentation bundle and email contact metadata have been included since alpha.5.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/README.md](docs/README.md) | Reading order, status notation rules, and the distinction between design drafts and current code |
| [docs/getting-started.md](docs/getting-started.md) | Six files for starting from published packages in an empty folder, live edit checks, build, and selective typegen |
| [docs/getting-started-react.md](docs/getting-started-react.md) | Installing a React 19 app in an empty folder, live edits, adding a locale, error recovery, and build |
| [docs/getting-started-svelte.md](docs/getting-started-svelte.md) | Installing a Svelte 5 app in an empty folder, live edits, adding a locale, error recovery, and build |
| [docs/getting-started-sveltekit.md](docs/getting-started-sveltekit.md) | Independent SvelteKit 3 installation, per-request SSR, hydration, shared layout, and Node production server |
| [docs/01-product-and-scope.md](docs/01-product-and-scope.md) | Problem definition, goals, scope, non-goals, DOM preservation scope, and terminology |
| [docs/02-architecture.md](docs/02-architecture.md) | Development pipeline, core/adapter boundary, store model, and ownership |
| [docs/03-catalog-and-api.md](docs/03-catalog-and-api.md) | Catalog files, ID/namespace, ICU policy, argument contract, public API, and examples |
| [docs/04-live-update-and-types.md](docs/04-live-update-and-types.md) | Live update decisions, desired state, failure recovery, type generation, and cache |
| [docs/05-build-and-ssr.md](docs/05-build-and-ssr.md) | Production builds, lazy loading, Vite transforms, SSR, and security |
| [docs/06-validation-and-roadmap.md](docs/06-validation-and-roadmap.md) | Performance targets and measurement definitions, acceptance cases, and roadmap |
| [docs/07-decisions.md](docs/07-decisions.md) | Decision log, product shape, unresolved risks, and references |
| [docs/08-update-protocol.md](docs/08-update-protocol.md) | Update wire protocol, application and resync, and boot encoding |
| [docs/09-release.md](docs/09-release.md) | Release contract, verification commands, deployment workflow, and Trusted Publisher |
