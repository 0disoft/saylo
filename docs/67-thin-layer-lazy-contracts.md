# 67. Thin-layer lazy scope contracts

## Scope

This records Node lazy catalog scope contracts and partial loading in a real Vite production build after [66](66-thin-layer-ssr-production.md). It is benchmark-only; product packages, public APIs, and versions are unchanged. Browser lazy transport, development-server reconnection, typegen, and performance comparisons remain unverified.

## Scope-based fix (`c8f883e`)

- An empty boot restores `availableNamespaces` and `loadedNamespaces` from the manifest.
- `NamespaceNotLoadedError` and `UnknownMessageError` are distinguished.
- Replacement updates both catalogs and namespace declarations while the previous snapshot's `t` remains intact.
- Scoped reads in catalogLayer default to the same base namespace as ordinary eager mode. If boot explicitly provides an array, zero resources are allowed.
- The source guard validates canonical names, uniqueness, base inclusion, and that catalog locales and namespaces are within the declared scope.
- The hydration facade constructor passes boot namespace declarations, while legacy replacement infers loadedNamespace scope from base catalogs. No network API exists.
- The tests pass 14 cases: 3 scope, 6 hydration, and 5 timezone.

## Lazy coordinator (`4623203`)

- It provides an independent lazy coordinator and source-pair cache. It does not wrap `createI18n` or import the private `CatalogLoader`.
- It uses public Saylo `createBootSnapshot`, `decodeBootSnapshot`, and `validateCatalogManifest`, along with schema validation and trusted ASTs.
- The experimental `createLazyLayer` has an asynchronous constructor. This is not a determination that it replaces every synchronous `createI18n` construction API.
- It creates a new i18next engine for each changed snapshot and directly manages generation, desiredScope, per-version cache, in-flight deduplication, timeout abort, stale invalidation, retired sessions, atomic candidate validation, subscription error aggregation, and disposal. New locales and namespaces, missing targets, and empty boots are supported.
- A no-op commit with the same signature produces no new engine or notification, although the committed boot manifest is updated.
- Namespace fingerprint handling during version transitions follows the public contract.
- `getServerSnapshot` stays fixed to the initial state, while `getBootSnapshot` returns the latest committed data. An instance's current `t` reads current state; a `t` obtained from an earlier `getSnapshot()` remains bound to its earlier state.

## Validation

- The controlledSource counts timer, superseded, and late-ignore events and records listed IDs in the raw data. The earlier 11 scenarios and 22 cases remain in git as the `4623203` record.
- The current dataset passes 28 of 28 cases: the same 14 scenarios run against both core and the prototype. Added scenarios cover bounded STALE retry, pair-version regression with a base-locale change, and catalog-pair identity independence from JSON key order.
- Test execution time is not used as performance evidence.
- Reproduce with `node --test benchmarks/thin-layer/catalog-scope.test.mjs benchmarks/thin-layer/hydration-layer.test.mjs benchmarks/thin-layer/timezone.test.mjs` and `node --test benchmarks/thin-layer/lazy-contract.test.mjs`.
- The test hook only stores evidence. All 28 cases passed; this was not a partially green run.
- The [raw results](../benchmarks/results/thin-layer-lazy-contracts-2026-10-11.json) include scenarios, source loads, and 13 source hashes.
- Because the scope fix (`c8f883e`) could affect existing hydration behavior, the real SSR host matrix was rerun under the current scope with 12 cases plus missing-target cases. It passed with zero errors and preserved state; the asset parser marker is false. This checks for regressions in the existing SSR facade, not the lazy coordinator in a browser. [Raw results](../benchmarks/results/thin-layer-ssr-production-lazy-scope-2026-10-11.json).

## Key-order edge case (`abbacf8`)

- Review found a real prototype bug. Core accepted a source key as the semantic pair even when its fields were ordered `{namespace, locale}`, but the prototype stamp serialized the raw object with `JSON.stringify`, making it order-dependent; it failed after a `STALE_CATALOG` retry.
- A new scenario with the same pair reproduced the bug before the fix: core passed and the layer failed. The test hook rejects partial results such as 27/28 and preserves the earlier green output.
- The fix changes the stamp to the flat array `[sessionId, locale, namespace, status, version, fingerprint]`, making it independent of object key enumeration order. The 14 scenarios times two variants now produce 28 passing Node cases.
- The cost is that cache keys, in-flight tracking, and invalidation now use this flat stamp. No performance measurement was taken.

## Interpretation and remaining goals

- The new code implements full runtime I/O and state logic directly alongside i18next. Because the loader depends on Saylo validation, it neither replaces every existing tool nor proves an independent-framework native advantage.
- Loading, cancellation, versioning, and subscription code must be maintained separately. Its performance cost was not measured.
- Remaining work includes development-server and browser lazy transport, reconnection, typegen, and performance comparison. Product packages are unchanged, with no push or publication.

## Real static production lazy loading (`597880e`)

- `lazy-production-probe.mjs` builds the same six-pair fixture (en, ru, ja by demo and help) as two real Vite production builds. It uses `virtual:saylo/lazy`, the public `createStaticCatalogSource`, initialLocale ru, empty initialNamespaces and initialCatalogs, and UTC.
- Both core and the prototype write dist ES libraries into their owned temp directories. They are unminified esnext builds with seven chunks each: one entry and six catalog outcomes.
- Node imports the real entry file and fetches relative catalog chunks as needed. The cache grows from 0 at boot to en and ru/demo at 2, ja/demo at 3, and en and ja/help at 5; the sixth pair, ru/help, is not loaded.
- Execution verifies that boot's known namespace is unloaded, then ru `Ada`, English fallback `21 rows`, and the UTC date; after selecting ja, `ja Ada` with the retained `ru Ada`; ja/help; loadedNamespaces `demo` and `help`; identity retention across a no-op refresh; unknown-namespace `RangeError` and `UnknownMessageError`; and `NamespaceNotLoadedError` on a retained cold binding.
- Every emitted chunk has a false parser marker. The AST build shim applies only to the prototype.
- The entry is 74829 bytes and 20305 gzip bytes for core, and 172439 bytes and 43994 gzip bytes for the prototype. These are small-example observations, not general bundle-size coefficients or performance measurements.
- It still uses the Saylo Vite compiler and public static CatalogSource. It does not verify the browser lazy development wire protocol, session reconnection, typegen, or performance.
- Product packages, public APIs, and versions are unchanged. The 28 unit cases share common boot-helper validation, and the loader coordinates validated state independently rather than wrapping core `createI18n`.
- The [canonical raw results](../benchmarks/results/thin-layer-lazy-production-canonical-2026-10-11.json), rebuilt from source after `abbacf8`, are the latest. They have the same two builds, seven chunks, and cache counts, and include per-chunk hashes. Reproduce with `node benchmarks/thin-layer/lazy-production-probe.mjs --out benchmarks/results/thin-layer-lazy-production-canonical-2026-10-11.json`; the raw result from `597880e` remains as [historical data](../benchmarks/results/thin-layer-lazy-production-2026-10-11.json).

## Follow-up: browser lazy wire (`51f1393`)

This covers Node contracts and production static partial loading. [68](68-thin-layer-lazy-browser.md) records requesting the six catalog pairs in a real Chromium and Vite development server through public `createDevCatalogSource` and `connectDev`, along with compact and patch frames, partial requests, detach and rebind, and Vite reload after a physical socket close. The 14 scenarios and production chunk records and determination above remain valid.
