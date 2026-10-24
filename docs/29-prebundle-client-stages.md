# 29. Client post-receipt, publication, and commit measurement under the default prebundle

Following [28](28-full-reply-stages.md), I divided the client-side boundaries. In 50 large runs with normal prebundling, I separated receipt → first store publication → DOM commit. The same Vite-frozen catalog reference reached core acceptance in 50/50 runs, but core deep-freeze trust was present in 0/50. Source and dist were unchanged.

## Implementation and boundaries

- `--client-stages` is locale-add only and requires `--reply-stages`. `optimizeDeps.include` remains the original list (`react`, `react-dom/client`, `@0disoft/saylo-core`, `@0disoft/saylo-react`), and only the benchmark transform is added to optimizer `rolldownOptions`.
- The same transform is attached through both the Vite plugin and the optimizer rolldown plugin. Instrumented optimizer transforms applied to `packages/core/dist/loading-registry.js` and `packages/core/dist/translator.js`. This list identifies files with instrumentation, not all bundled modules.
- Helper state is shared only within the benchmark through the global key `Symbol.for('saylo.benchmark.client-stages')` and does not alter the product freeze cache.
- Trust observation only reads reference identity from the return value of Vite `freezeCatalogs` and `isDeepFrozen` in core. A guard prevents it from preempting the original error from a malformed outcome.
- Receipt starts at the reply hot listener (after Vite WS `JSON.parse`), publication starts at the first `instance.subscribe` call (before the React subscription), and commit is the point where the `useLayoutEffect` verifies the DOM.

Nested p95 values are not added; per-sample remainders are calculated first. Node and browser clocks are not mixed. Per-function values are synchronous wall time including pauses and probe overhead, and GC was not separately observed. A value of 0.00 ms means there was no measurable difference at the browser clock's resolution.

## Run

```sh
node benchmarks/live-update/run.mjs --mode locale-add --reply-stages --client-stages --scenario 10k-20-locales --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/locale-add-client-stages.json
```

2026-10-07 KST, revision `4d2783c`, measuredAt `2026-10-07T13:06:35.789Z`, 5 warmups, 50 measured runs, and 25 controls; 55 raw runs → 50 measured, with nearest-rank p95 equal to the 48th sorted value. The scenario had 10k messages × 20 locales, one namespace, and a new 387,783 B en-GB JSON file per round. Product dist hashes match the [run in 28](../benchmarks/results/locale-add-reply-stages.json); only the benchmark harness hash differs between the two JSON files.

## Results

Times are in ms. Remainders are calculated per sample before summarization.

| Interval | p50 | p95 |
| --- | ---: | ---: |
| decode | 10.20 | 11.90 |
| Vite freeze | 88.40 | 288.20 |
| core accept (nested) | 83.70 | 281.90 |
| core acceptCheck | 0.00 | 0.10 |
| core acceptFreeze | 83.60 | 281.90 |
| snapshot (nested) | 27.70 | 50.90 |
| translator (nested) | 20.80 | 42.60 |
| signature (nested) | 6.00 | 11.90 |
| clientOther | 0.70 | 0.90 |
| receiveToPublish | 218.60 | 603.10 |
| publishToCommit | 1.40 | 1.80 |
| receiveToCommit | 219.90 | 604.40 |
| Selection → commit | 335.90 | 716.10 |
| saveToListAck | 316.30 | 627.45 |
| Per-sample freezeSum (Vite freeze + core acceptFreeze) | 175.80 | 570.10 |

- Trust: sameCatalog 50/50, trusted 0/50. Target responses before selection were 0; compact full responses after selection were 1.
- Per-sample freezeSum was larger than decode + snapshot + clientOther + publication-to-commit in all 50/50 runs.
- List rendering finished within 250 ms in 7/50 runs. The list target does not apply to the first locale selection.
- Worst sample 10k-20-locales:75 totalled 2,986.10 ms (Vite freeze 1,383.90 + core freeze 1,424.50, publication → DOM 1.40). Long samples remain in the raw data.

## Interpretation

- The references are identical, but core has no deep-freeze trust. Core freeze trust is a module-local WeakSet. Based on core root's `optimizeDeps.include`, the Vite client's `/runtime` import path, and the observed trusted=false values, the trust sets for the two paths appear to be separate in this run. I did not dump the full bundle graph to compare module identities.
- Global state sharing in the benchmark helper is instrumentation-only and does not substitute for product trust markers.
- Because publication occurs before the React subscription, most post-receipt time is synchronous processing before publication. These values alone do not identify React, GC, or the network as the cause.
- This was a single-machine run with different options and load from run 28, so I do not attribute timing differences between the runs to added instrumentation or code.

## Validation

- All 14 harness tests passed (5 reply + 5 browser + 4 client), and 33 existing core-loading and Vite-lazy tests also passed in this run.
- Four regression smoke runs exited 0: [small client stages](../benchmarks/results/locale-add-client-stages-smoke.json), [full browser regression](../benchmarks/results/client-stages-full-browser-regression-smoke.json), [edit regression](../benchmarks/results/client-stages-edit-regression-smoke.json), and [disabled instrumentation](../benchmarks/results/client-stages-disabled-smoke.json).
- Three incompatible CLI combinations are rejected: `--client-stages` alone, `--reply-stages` + `--client-stages` + `--browser-stages` together, and `--reply-stages` + `--client-stages` in default edit mode. I did not verify CPU options in this work.
- I checked raw summaries, remainders, request identity, trust counts, current hashes, and product dist hashes, and confirmed that no temporary fixture or Chrome process remained.
- I did not rerun the full product check, build, release check, or pack because product inputs were unchanged. No version bump, push, publish, or deploy was performed.
- Artifacts: [summary](../benchmarks/results/locale-add-client-stages.json), [raw samples](../benchmarks/results/locale-add-client-stages.10k-20-locales.samples.json).

## Proposed next product fix

- Because the core root barrel already re-exports `freezeCatalogs` through `export * from './runtime.js'`, consider changing Vite `freeze.ts` to import from the root instead of `/runtime` and share the same prebundle path. It is not implemented yet.
- First verify that importing the root entry, which includes `parseCatalog`, does not break parser removal from the production `astRuntime`.
- I will not introduce a global WeakSet into the product or trust externally shallow-frozen objects based on `Object.isFrozen`.
- This commit covers instrumentation and documentation only; it contains no product optimization.
