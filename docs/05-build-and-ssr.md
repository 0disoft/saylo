# 05. Build and SSR

This document defines the production build shape, lazy loading, Vite transforms, SSR, security, and cleanup.

## Production catalog model

- Production uses pre-parsed and validated AST catalogs and shares the core formatter with development.
- The Vite plugin locally implements a path that removes the parser from the runtime at build time (option `astRuntime`, default `true`, production only). Only when Saylo `core/dist/formatters.js` imports `intl-messageformat` does it resolve that module to a separate virtual module and replace the module's dependency with the public `@formatjs/icu-messageformat-parser/no-parser.js`. It does not alias the whole app.
- The no-parser configuration is handled only within Saylo's AST-only distribution boundary. Consumers that call `IntlMessageFormat(string)` externally continue to use the original parser.
- Dependencies resolved externally are untouched, so SSR external dependencies remain as they are. If the app calls `parseCatalog` directly at runtime, including the parser is expected. Set `astRuntime: false` to disable this path.
- The public `@0disoft/saylo-core/runtime` entry excludes `parseCatalog`, while the existing root entry retains the existing API.
- Using only the runtime entry does not guarantee parser removal in every bundler. The verified scope is a Vite 8 production build. A parser may remain at runtime.
- Core's browser entry has no file-system access and does not require the parser. Given an AST, it works without a parser. File-system and parser access belong to the dev plugin and build boundaries.
- Unused-message removal is locally implemented through `includeKeys`. It accepts the existing `string[]` or `{ from, dynamicKeys? }`. The object form statically scans only JS, TS, JSX, TSX, Vue, and Svelte scripts and template expressions inside the Vite root and does not execute code. It retains matching strings, calls through `t` and `tParts` aliases, and possible keys matching template prefixes and suffixes. An unresolvable dynamic call fails the build when `dynamicKeys` is absent.
- Development uses the full catalog; only production eager, lazy, and SSR builds retain selected keys. Typegen keeps the full base schema. Runtime key analysis uses Babel parser major 7 only on the dev plugin's Node side. Major 8 requires Node 24.11 or later, so major 7 was chosen to retain the existing Node 24.x support range; the devDependency 8 used for the root package-boundary check is separate. It is not included in the browser bundle, and this feature is absent from published alpha.4.
- Verification commands are `npm test --workspace=@0disoft/saylo-vite` and `npm run verify:demo:react:recovery`. This document does not freeze the total test count; follow the repository's execution results.

Because it reduces code-generation waits, the approach sits between codegen-based tools ([Paraglide message compilation](https://paraglidejs.com/compiling-messages)) and HMR-based tools ([Wuchale development mode](https://wuchale.dev/guides/dev/)).

## Translation validation policy (build)

- Grammar and schema errors in supplied translations fail the build. Broken translations are not shipped.
- Missing translations fall back to the baseline by default.
- The `requireCompleteTranslations` option, which requires every locale to be fully translated, was implemented in `0.1.0-alpha.3`. It defaults to `false` and performs strict validation only during production builds (`config.command === 'build'`). The default and development path continue to allow incomplete translations and baseline fallback.
- Production builds do not reuse the development cache. A build reparses and validates the entire current disk snapshot and fails if the base is invalid. The last-known-good retention rule is development-only.

## Lazy loading

- Locales and namespaces load lazily through `CatalogSource`. The full catalog is not loaded at once.
- In development, the general `loadCatalog(locale, namespace)` queries the current registry. In production, boot pairs are inlined and the remaining present pairs are split into generated literal `import()` loader entries (`createStaticCatalogSource`). Both sit behind the same interface.
- Parsing catalogs on the server does not access the browser's source file system. The server reads and parses files, and the client receives the results.

## Runtime locale switching

- Locale switching is asynchronous. It publishes a snapshot after ensuring the catalog is loaded.
- Locale switching and namespace loading are reconciled through one desired state. Retain the previous UI until complete, and publish at once when every base+target pair is resolved. Follow the decision rules in [04-live-update-and-types.md](04-live-update-and-types.md).
- For fast toggling, use load and commit generation tokens. A late-arriving load for an earlier locale must not overwrite the latest switch.
- On network error, retain the previous state and fail that request. Do not switch to an empty catalog.
- The baseline must always be loaded and is the fallback source. There is one fallback target: baseLocale.

## Shared DEV/PROD paths

Development and production use the same normalization, parser validation, formatter, and fallback implementations. Vector comparison checks whether the two paths produce the same result for the same input. This guards against differences that pass in development but diverge in production.

## Vite transforms

- Expose two virtual modules: `virtual:saylo` (full eager registry) and `virtual:saylo/lazy` (boot data and catalogSource). `connectDev` handles HMR event registration.
- A const that dynamically re-exports locales does not invalidate the module. Updates are delivered through store snapshots; the module itself is not replaced.
- When the namespace manifest grows or shrinks dynamically, deliver the change by updating `availableNamespaces` in the patch envelope and the mutable manifest handle. Development has no static namespace map. The general `loadCatalog` handles lookups for new namespaces; the static loader map is generated only for production.
- When the Vite dev server restarts or its websocket reconnects, the Vite client may perform a full reload (`location.reload`) itself. That path is outside Saylo's DOM-preservation scope. Saylo's no-full-reload guarantee applies only to normal translation changes.
- Do not place catalog source files in the app import graph. This matches the development-server plugin rule in [02-architecture.md](02-architecture.md).

## SSR

- Create an instance and immutable catalog snapshot for each request. Only compiled entries (parse and validation results) are shared.
- Do not use a server-global `setLocale`. Use a per-request instance. This eliminates locale mixing between requests.
- The `t` in hooks created by a context factory is bound to that render. During hydration from boot S1, `t` also reads S1.
- During the hydration barrier, buffer S2 events and apply them only once when the barrier ends.
- Wrap the client with `createHydrationAdapter(instance)`. Create the adapter anew for each root, retain boot S1, and buffer the underlying snapshot to the latest one. Call `finishHydration()` to publish once; afterward, `getServerSnapshot` still returns S1. `adapter.dispose()` releases only the subscriptions it added, and the app separately calls the original instance's `dispose()`.
- `getServerSnapshot` returns decoded boot data under a fixed identity. The `subscribe` and `getSnapshot` references remain stable (compared with `Object.is`).
- Isolate snapshots during rendering. Do not mutate a snapshot while a request is being handled.
- The server plugin applies updated catalogs to subsequent SSR requests together with browser updates.

### Boot data

- Boot wire v1 contains `format: 'saylo-boot-v1'`, `manifest`, `locale`, `timeZone`, `stateRevision`, `loadedNamespaces`, `baseSchemas` (`CatalogSchema[]`), and `catalogOutcomes` (`CatalogOutcome[]`). `createBootSnapshot`, `serializeBootSnapshot`, and `decodeBootSnapshot` are public APIs.
- The current `catalogOutcome` includes the sourceName, locale, AST, and arguments of the parsed catalog in an array and explicitly marks every present/missing loaded base+target pair. Decode rejects missing or duplicate outcomes and stamp or schema mismatches as `INVALID_BOOT`; boot timeZone must match config. The public UI snapshot is `StoreSnapshot`, and the transport unit is `CatalogOutcome`. The `CatalogRecord` and `Map` models are not used.
- `serializeBootSnapshot` escapes every `<` as `\u003c` and U+2028 and U+2029. `createServerI18n({ catalogSource, locale, initialNamespaces, timeZone?, requestTimeoutMs? })` prepares an async scope and then creates a per-request instance. Because `getServerSnapshot` is the snapshot from construction time, use this factory to settle the scope before rendering. `virtual:saylo/server` exposes `createRequestI18n`, which applies plugin defaults, and a server-side `catalogSource`.
- Replace every `<` in JSON embedded in HTML with `\u003c` to prevent premature `</script>` termination.
- When date and time arguments receive a Date, do not create the current time internally (`Date.now` or `currentTime`).
- Storing a timeZone value in config does not automatically apply it to every date format. Pass the resolved timeZone to both the default date/time styles and the skeleton path (provide a formatters cache override).

## Security

- Validate catalog-loading paths against locale and namespace allowlists and prevent them from escaping the root (path traversal prevention).
- Do not inject arbitrary HTML automatically. Delegate escaping unsafe strings to the framework.
- Development custom events are development-only. Production does not open persistent channels such as websockets.

## Cleanup

- Clean up watchers, event listeners, and sockets on abort paths. Listener leaks must not accumulate when the dev server restarts or HMR repeats.
- The Vite dev server owns the watcher and websocket. Saylo does not close the shared watcher or socket; it releases only listeners and bridge subscriptions it registered.
- Exclude Saylo-generated `.d.ts` files and typegen temporary files from Saylo's watch and event scope. Verify narrow ignore rules so temporary files do not trigger app watch HMR.
