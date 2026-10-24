# 72. Thin-layer synchronous construction contracts

## Scope

This records adding a synchronous construction path to the benchmark-only lazy layer after [70](70-thin-layer-lazy-production-browser.md) and [71](71-thin-layer-lazy-session-browser.md) and validating its constructor contracts. The new APIs are `createCatalogLayerSync` and `createLazyLayerSync`; existing async `createCatalogLayer` and `createLazyLayer` remain.

This verifies constructor contracts. It does not verify full API equivalence (for example, whether error codes match Saylo core), performance or benchmark comparison, or native and standalone typegen. Observations were made on 2026-10-11 (KST) with Node v24.18.0 and TypeScript 7.0.2.

## Code

- Executed code: [catalog-layer.mjs](../benchmarks/thin-layer/catalog-layer.mjs) · [lazy-layer.mjs](../benchmarks/thin-layer/lazy-layer.mjs) · [lazy-layer.d.mts](../benchmarks/thin-layer/lazy-layer.d.mts) · [lazy-sync.test.mjs](../benchmarks/thin-layer/lazy-sync.test.mjs) · [lazy-contract.test.mjs](../benchmarks/thin-layer/lazy-contract.test.mjs) · [typegen-probe.mjs](../benchmarks/thin-layer/typegen-probe.mjs) · [lazy-production-browser-probe.mjs](../benchmarks/thin-layer/lazy-production-browser-probe.mjs)
- `createCatalogLayerSync` owns engine construction. Async `createCatalogLayer` only wraps its `replace` result in async, and `createLazyLayer` is an async function that directly returns the result of `createLazyLayerSync`. Existing async call sites retain Promise returns and rejections.
- The engine is resource-only. It passes `initAsync: false` to `engine.init({ ... }, callback)` and publishes only when the callback has completed (`completed`) and `engine.isInitialized` is true. If either condition is false, it throws `The resource engine did not initialize synchronously.` and retains the previous snapshot. If a future i18next version uses asynchronous initialization, a half-constructed engine will not escape and the old snapshot remains.
- With a seeded boot, synchronous construction makes `.t`, `.getSnapshot`, and `.getServerSnapshot` usable before returning. An empty boot is also ready on return, with zero source loads, and `loadNamespace` remains a Promise. The snapshot does not change while waiting, and the cold snapshot's `.t` continues to throw `NamespaceNotLoadedError`.
- [lazy-layer.d.mts](../benchmarks/thin-layer/lazy-layer.d.mts) uses public `I18n`, `Schema`, `CreateI18nOptions`, and `BootSnapshot`. `createLazyLayer` returns `Promise<LazyLayer<S>>` and `createLazyLayerSync` returns `LazyLayer<S>`; TypeScript and checkJs consumers distinguish the two.

## Observed results

All 64 unit cases passed.

| Category | Count | Basis |
| --- | ---: | --- |
| lazy-contract | 42 | Same 14 scenarios × core, asyncLayer, and syncLayer |
| sync constructor | 8 | Seeded and empty boot, invalid seed, serialized restore, async-factory retention, async-init rejection |
| scope, hydration, timezone | 14 | 3 scope + 6 hydration + 5 timezone |

- The lazy-contract raw `observations` contain 14 each for core, layer, and layer-sync, with identical scenario IDs and pass values across all three.
- When asynchronous engine initialization is rejected, `replace` throws and `getSnapshot()` returns the previous snapshot unchanged.
- Typegen `--sync` reaches compiler status 0 in all nine phases. The live runtimes are the core and sync factories; TypeScript and checkJs consumers check both the existing async and new sync APIs against the same `AppSchema`. The any-return control declaration exits 1. In both boot-restore cases, core receives a boot object and sync receives serialized JSON; the raw result's `layerFactory` is `createLazyLayerSync`.
- Production browser `--sync` covers two variants by six stages. The sample app constructs, subscribes, and reads the initial snapshot without `await`, then translates after loading a namespace. It verifies catalog chunks 0 → 2 → 3 → 5 → 5 → 5, configured UTC on an Asia/Seoul host, and preservation of input, DOM, focus, caret, dialog, and counter state. Both variants report `constructionWithoutAwait: true`.
- All 45 `codeHashes` across the three sync raw results match current files, and the probe deletes profiles and temp fixtures.

## Interpretation and limitations

- This is evidence for constructor contracts. It is not full API equivalence; error-code identity, for example, is not proven.
- It is not a performance or benchmark comparison, and it does not cover native or standalone typegen or browser editor and LSP integration.
- Product packages, public APIs, versions, and remote state are unchanged. No root dependency was added, and product `packages/core/dist` and benchmark `lazy-source-cache.mjs` hashes are unchanged.

## Source data and reproduction

The raw results are [lazy-contracts-sync](../benchmarks/results/thin-layer-lazy-contracts-sync-2026-10-11.json), [typegen-sync](../benchmarks/results/thin-layer-typegen-sync-2026-10-11.json), and [lazy-production-browser-sync](../benchmarks/results/thin-layer-lazy-production-browser-sync-2026-10-11.json).

The contract test now writes to a current file by default; `SAYLO_LAZY_CONTRACT_OUT` selects the dated file. The earlier [lazy-contracts raw result](../benchmarks/results/thin-layer-lazy-contracts-2026-10-11.json) (28 cases = 14×2) remains as historical data. Its `codeHashes` record files at that time, and three differ from today's files.

```powershell
$env:SAYLO_LAZY_CONTRACT_OUT='benchmarks/results/thin-layer-lazy-contracts-sync-2026-10-11.json'
npm --prefix benchmarks/thin-layer run test:lazy
node --test benchmarks/thin-layer/hydration-layer.test.mjs benchmarks/thin-layer/timezone.test.mjs
Remove-Item Env:SAYLO_LAZY_CONTRACT_OUT
node benchmarks/thin-layer/typegen-probe.mjs --sync --out benchmarks/results/thin-layer-typegen-sync-2026-10-11.json
node benchmarks/thin-layer/lazy-production-browser-probe.mjs --sync --out benchmarks/results/thin-layer-lazy-production-browser-sync-2026-10-11.json
```

The first browser run ended with `DevToolsActivePort` EBUSY. It passed after a bounded EBUSY retry was added to benchmark helper [chrome-protocol.mjs](../benchmarks/thin-layer/chrome-protocol.mjs); this was not a product defect.

## Status

The probe, tests, and raw data are in local commit `15605cd` and have not been pushed. Product package APIs, dependencies, and versions are unchanged.

## Follow-up: runtime cost and snapshot-retained heap (`6979c84`)

[73](73-thin-layer-runtime-cost.md) records isolated cost and heap measurements of the same synchronous layer and product core. The constructor-contract observations and determination in this document remain valid.
