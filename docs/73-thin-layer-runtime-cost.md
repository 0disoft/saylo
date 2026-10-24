# 73. Thin-layer runtime cost and snapshot-retained heap

## Scope

This records isolated measurements of benchmark-only synchronous layer (`createLazyLayerSync`) and product core `createI18n` on the same fixture after [72](72-thin-layer-sync-construction.md). Measurements cover synchronous construction time, commit time for 30 same-width single-message edits, 1,500 hot reads, and heap at each forced GC point.

This verifies isolated Node cost for the two libraries. It does not measure the end-to-end 100 ms edit or 250 ms locale targets, browser memory, RSS or peak usage, Vite wire decoding, React or DOM, or module loading. Observations were made on 2026-10-11 (KST) with Node v24.18.0.

## Code

- Executed code: [runtime-cost-probe.mjs](../benchmarks/thin-layer/runtime-cost-probe.mjs) · layer implementation [lazy-layer.mjs](../benchmarks/thin-layer/lazy-layer.mjs) · [lazy-source-cache.mjs](../benchmarks/thin-layer/lazy-source-cache.mjs) · [catalog-layer.mjs](../benchmarks/thin-layer/catalog-layer.mjs) · [ast-format.mjs](../benchmarks/thin-layer/ast-format.mjs)
- The runner executes eight `--expose-gc` child processes sequentially. At each key count of 1k and 10k, the order is `core, layer, layer, core` ABBA. Layer children also report resourceDictionaries and instances through `getProbeStats()`, which core lacks.
- The fixture has one namespace, two locales (en base and ru target), and two prepared immutable catalogs. Before construction, both variants warm the base-schema cache equally, after one untimed warmup.
- An edit replaces one item0 message at the same width. Message parsing, O(N) dictionary copying, and source freezing are outside timing; `refresh()` and three translation assertions are timed.
- Heap is captured after draining tasks and microtasks and forcing `globalThis.gc()`. `retained` compares the state after 30 edits while retaining eight old snapshots with the state after releasing them, at the same final source version.

## Observed results

| key | variant | commit p50 | commit p95 | steady heap delta | retained delta | 1,500 hot reads | 3 constructions |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1k | core | 1.48ms | 2.25ms | 0.43~0.45MB | 0.55MB | 19.0·19.4ms | 2.02~2.88ms |
| 1k | layer | 4.18ms | 6.20ms | 0.75~0.76MB | 1.02~1.04MB | 39.1·39.4ms | 5.17~8.02ms |
| 10k | core | 13.01ms | 16.46ms | 2.18MB | 4.59~4.71MB | 18.6·19.4ms | 8.82~11.01ms |
| 10k | layer | 30.43ms | 40.50ms | 1.50MB | 7.72MB | 38.0·41.6ms | 33.86~51.76ms |

- Commit p50 and p95 use 60 samples, excluding the eight retained-phase samples (two runs × 30 for each of core and layer). Commit and hot-read times are wall time around `refresh()` and `t()` in the same process.
- Both variants perform 38 source loads (30 edits plus 8 retained snapshots). The two layer runs have identical stats: resourceDictionaries 40 and instances 39.
- Heap delta is relative to each child's own `before` value. Absolute `before` values are about 8.5 MB for core and 8.8 MB for layer at 1k, and about 23.4 MB for core and 24.4 MB for layer at 10k.

## Interpretation and limitations

- The layer is slower under the same conditions. Commit p50 is 4.18 versus 1.48 ms at 1k (about 2.8×) and 30.43 versus 13.01 ms at 10k (about 2.3×); 1,500 hot reads and construction time are also larger for the layer. The layer is a benchmark-only prototype and not a product entry path.
- Retained-snapshot memory growth is larger for the layer. The eight-snapshot delta is 1.02–1.04 versus 0.55 MB at 1k, and 7.72 versus 4.59–4.71 MB at 10k.
- Live steady-state delta differs by size. At 10k the layer's 1.50 MB is lower than core's 2.18 MB; at 1k the layer's 0.75–0.76 MB is higher than core's 0.43–0.45 MB. This does not generalize to "the layer always uses more memory".
- Heap delta is not library-only bytes. Absolute baselines differ and the input graph keeps changing. This is not a leak, broad-scale, or production-size determination.
- ABBA order is the observation design. It does not claim that machine scheduling, JIT, and other-process load are identical across runs, and p50/p95 differences are not attributed as causes.

## Source data and reproduction

The source data is [thin-layer-runtime-cost-2026-10-11.json](../benchmarks/results/thin-layer-runtime-cost-2026-10-11.json). Its `summaries` form the table above, and its eight `observations` are raw data for each child run. All 12 `codeHashes` matched files at the observation time. They will differ if product source changes later.

```powershell
node benchmarks/thin-layer/runtime-cost-probe.mjs --iterations 30 --out benchmarks/results/thin-layer-runtime-cost-2026-10-11.json
```

The benchmark workspace script `probe:runtime-cost` runs the same probe with the default `out` (current file).

## Status

Code and raw results are in local commit `6979c84` and have not been pushed. Product packages, public APIs, and versions did not change; these measurements do not decide an architecture replacement or performance adoption. This document is the historical baseline at `6979c84`, and the next document covers remeasurement after a later product source change.

## Follow-up: immutable-validation reuse (`5586bf2`)

[74](74-immutable-validation-reuse.md) covers the later remeasurement and validation-reuse change. The `packages/core/dist/schema.js` hash measured in 74 differs from this document's baseline.
