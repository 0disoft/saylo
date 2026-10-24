# 60. Removing the wait window for new catalogs

## Scope

In `32e120c`, `LiveRegistry.enqueueAdded(file)` in `packages/vite` queues only a new path that is absent from desired and accepted for `readFile`, scheduling the read for the next event-loop turn with a 0 ms timer. Path checks, stat, file reads, and parsing still take time.

- Adds and replacements for existing paths, unlinks, and pending `settleDisk: true` entries retain the existing 40 ms quiet window.
- ENOENT keeps the existing 40 ms retry, and the trailing metadata recheck 60 ms after the first publish remains.
- The original large locale-add goal is 250 ms.
- The main API, dependencies, and versions are unchanged, and nothing was pushed or published.

## Server file stages

The [server file-stage source data](../benchmarks/results/locale-add-json-leaf-stages-2026-10-11.json) was recorded against source `6927064`.

- Queue p50 was 49.94 ms and p95 was 54.05 ms.
- `catalogParse` was the longest of the ten file stages in all 10 runs, with a maximum of 302.30 ms.

## Reverting initial-load parser optimization trials

Neither trial showed a benefit in the cold comparison, so both were reverted.

| Trial | File | p50 before→after | p95 before→after | Faster |
| --- | --- | --- | --- | --- |
| argument-node-pool | [source](../benchmarks/results/argument-node-pool-cold-compare-2026-10-11.json) | 77.55→88.26ms | 117.49→133.63ms | 4/20 |
| lazy-parser-diagnostics | [source](../benchmarks/results/lazy-parser-diagnostics-cold-compare-2026-10-11.json) | 64.46→73.85ms | 133.46→152.34ms | 5/20 |

The patches (`*-trial-2026-10-11.patch`) and raw data are preserved in `19dab47`, and core is currently identical to `6927064`. Memory use was not measured quantitatively. The initial-load parser trials were removed, so no improvement to initial parsing is claimed. `32e120c` is the only adopted source change.

## Single end-to-end run

The [locale-add source data](../benchmarks/results/next-turn-locale-add-2026-10-11.json) uses 25 samples, 5 warmups, 10 calibrations, and typegen enabled.

| Scenario | p50 | p95 | Within goal |
| --- | --- | --- | --- |
| small 1k×3 | 72.27ms | 91.62ms | 25/25 |
| large 10k×20 | 135.88ms | 189.30ms | 24/25 |

The large scenario includes one maximum of 402.11 ms, so it does not establish stable tail latency. One successful run is not stable achievement or causal proof; this record shows one passing current-condition run and does not guarantee other environments.

## Validation and tests

- `npm run check` passed (`32e120c`): all builds and workspace tests, including core 81, React 14, Svelte 14, typegen 9, Vite 95, and scripts 5, plus consumer typechecks.
- After an additional tests-only run verified recovery from a malformed new file, `node --test packages/vite/test/plugin.test.mjs` passed all 43 tests.
- These plugin tests are separate from the full root check; the full 96-test Vite suite was not rerun.
- New paths schedule a read without a separate 40 ms wait. If a valid write follows an invalid new JSON file without a watcher event, the 60 ms recheck recovers it.
- Existing 40 ms atomic and paired-namespace convergence tests still pass.
- This path handles real Saylo Vite new-file events.

## Reproduction

```sh
npm run build
node benchmarks/live-update/run.mjs --scenario all --mode locale-add --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/next-turn-locale-add-2026-10-11.json
```

## Comparison environment

The browser ABBA comparison replaces only `packages/vite/src/index.ts` and `live-registry.ts` in the snapshot. The baseline is `6927064` and the current source is `32e120c`. Each run uses a fresh Vite server and browser, 25 measurements, 5 warmups, 10 controls, and typegen enabled. Samples are not paired; the order is before/after/after/before.

The detailed-instrumentation ABBA run exited 1 during the second after run, after the first before run, because `finishFileSample` asserted the `exactly 1` path check, read, and parse condition (`next-turn-locale-add-stages-failure-2026-10-11.json`; the completed before run is `next-turn-locale-add-compare-2026-10-11.1-before.json`). Call counts were not printed, so the cause was not established, and no after or pooled result exists. The single-parse condition was not relaxed. A separate [cross comparison](../benchmarks/results/next-turn-locale-add-comparison-2026-10-11.json) with detailed instrumentation disabled completed. It validates locale-list propagation time and does not establish the cause within file stages.

## Cross-measurement results

| Metric | before, 50 samples | after, 50 samples |
| --- | ---: | ---: |
| List p50 (ms) | 214.09 | 150.97 |
| List p95 (ms) | 417.47 | 642.02 |
| Within 250 ms | 31/50 | 40/50 |
| List maximum (ms) | 1042.45 | 2499.83 |
| Control round-trip p95 (ms) | 17.29 | 33.27 |
| File-write p95 (ms) | 54.90 | 104.35 |

Per-run p95 was 427.52 and 241.77 ms before, and 642.02 and 463.31 ms after. The median and count within goal improved, but p95 and the maximum grew, and the locale goal remains unmet. File-write timing measures waiting for the asynchronous completion callback, not pure disk time. Because control and file-write timings also changed, the result does not establish a tail regression in the code or an overall performance gain. Performance adoption for `32e120c` remains provisional, and the single 189.30 ms run is not evidence of stable achievement.

All five fresh Vite SSR [recovery cases](../benchmarks/results/next-turn-additions-recovery-2026-10-11.json) report `recovered: true`, and the gap-free [eight-case thin-layer browser smoke test](../benchmarks/results/next-turn-additions-browser-2026-10-11.json) passes. The latter covers a prototype comparison and does not validate the full adapter. The code hashes and sample aggregates for the current single run, the pooled cross-comparison recalculation, and hashes for both probes were verified.

```sh
node benchmarks/live-update/locale-compare.mjs --baseline 6927064 --current 32e120c --experiment fast-additions --mode locale-add --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/next-turn-locale-add-comparison-2026-10-11.json
```

## Remaining work

Remaining work includes diagnosing the detailed-instrumentation multi-read limitation and long samples, deciding whether to adopt the wait-window removal, deciding provisionally adopted owned-map behavior, completing the full thin-layer comparison, and choosing a release for unpublished changes. This does not claim completion of the long-term goal.
