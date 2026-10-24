# 25. Core outcome-acceptance measurement for the first language selection

The earlier [24](24-full-selection-browser-stages.md) divided the full language-selection interval but did not expose the internals of the core acceptance path. This measurement splits `acceptOutcome` into check, deep freeze, and other work, then measures how much of total first-selection time (adding en-GB) is spent accepting the core outcome. It ran on 2026-10-07 KST at revision `576161f` (`576161fea0a32c23f0ad8bb111b9cc45c1bced20`); the benchmark changes were uncommitted at measurement time.

## Run and conditions

```text
node benchmarks/live-update/run.mjs --mode locale-add --browser-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-accept-stages.json
```

The scenario has 10,000 messages per locale, 20 locales, one namespace, and 20 initial catalog files totalling 7,755,280 bytes. Each iteration creates a new en-GB directory and one catalog with 10,000 messages, then selects the locale automatically after the list option commits. Every round returns to en, waits for locale removal, and starts the next sample.

Saylo prebundling was disabled, React and ReactDOM were prebundled, and typegen was enabled. `declarationRewritten` was false. The environment was Windows, Node v24.18.0, AMD Ryzen 5 7430U with 12 logical CPUs, Vite 8.3.2, React 19.3.0, and HeadlessChrome 154.0.0.0. CPU and server profiling were disabled. Product source and dist matched the earlier study, including their hashes, and I newly recorded the `packages/core/dist/catalog-loader.js` hash (`77ba98db0821dd70dab644232d3ddd2bd71d4fc122544693e752f7eeca68297c`).

## Measurement boundaries

- `decodeMs`: compact decoding and validation. WebSocket `JSON.parse` is excluded.
- `freezeMs`: Vite `freezeCatalogs`.
- `acceptMs`: The entire core `acceptOutcome` call.
- `acceptCheckMs`: Metadata, session, key, state, version, and payload checks, plus the base-fingerprint check when the baseline locale is selected. This run selects en-GB, so it does not calculate the base fingerprint.
- `acceptFreezeMs`: Core `diagnostics.freeze` after copying the outcome and key, including its deep traversal.
- `acceptOtherMs`: Per-sample accept time minus check and freeze.
- `snapshotMs`: Includes translator and signature; `snapshotOtherMs` subtracts those per sample.
- `selectionOtherMs`: Per-sample browser select-to-commit time minus decode, Vite freeze, accept, and snapshot. It mixes transport, server work, WS parsing, other work, and React commit, so it is not pure network time.
- `translatorMs`: Includes handling of cross-language argument compatibility.
- The earlier study's `selectionOther` did not subtract accept and therefore has a different boundary; I do not compare the two directly.

With 10 samples and nearest-rank, p95 equals the maximum. The tables below show only p50, minimum, and maximum. I do not add p95 values from nested intervals, subtract Node and browser clocks from each other, or deduct control round-trip or GC time. Per-function measurements are synchronous elapsed time including runtime pauses and GC, not CPU-only time. Selection remainder and end-to-end intervals include asynchronous waits. Clock calls and counter overhead are also included.

## Results

Stage summary (ms):

| Stage | p50 | Minimum | Maximum |
| --- | --- | --- | --- |
| decodeMs | 9.20 | 5.90 | 22.80 |
| freezeMs(Vite) | 42.30 | 35.50 | 53.80 |
| acceptMs | 66.00 | 60.00 | 341.90 |
| acceptCheckMs | 0.00 | 0.00 | 0.10 |
| acceptFreezeMs | 66.00 | 59.90 | 341.90 |
| snapshotMs | 19.30 | 16.20 | 38.30 |
| translatorMs | 13.90 | 11.50 | 32.60 |
| signatureMs | 5.20 | 4.20 | 7.40 |
| acceptOtherMs | 0.00 | 0.00 | 0.20 |
| snapshotOtherMs | 0.00 | 0.00 | 0.20 |
| selectionOtherMs | 86.50 | 73.50 | 118.60 |

Interval summary (ms):

| Interval | p50 | Minimum | Maximum |
| --- | --- | --- | --- |
| saveToListAckMs | 201.24 | 179.98 | 237.62 |
| selectToTranslationAckMs | 254.56 | 202.18 | 535.21 |
| saveToTranslationAckMs | 463.77 | 394.91 | 735.07 |
| selectToCommitMs | 248.50 | 199.10 | 530.90 |
| saveToBroadcastMs | 184.13 | 166.64 | 217.96 |
| fileWriteMs | 12.60 | 8.80 | 16.55 |

Wire and control:

| Item | p50 | Minimum | Maximum |
| --- | --- | --- | --- |
| catalogReplyBytes | 1,241,400 | 1,241,399 | 1,241,401 |
| addedCatalogBytes | 387,783 | 387,783 | 387,783 |
| controlRoundTripMs | 3.02 | 2.48 | 3.88 |

Per-sample ratios (minimum / p50 / maximum):

| Ratio | Minimum | p50 | Maximum |
| --- | --- | --- | --- |
| acceptFreezeMs / selection | 24.94% | 28.13% | 64.40% |
| selectionOtherMs / selection | 16.03% | 37.45% | 45.03% |

Server startup was 4,516.73 ms and browser boot was 8,642.84 ms.

Save → list ack was within 250 ms in all 10/10 iterations, but this was observed in an instrumented run with Saylo prebundling disabled. It is not evidence that the list target was met under the normal configuration.

## Interpretation

Core freezing was the largest collected synchronous stage. `acceptFreezeMs` exceeded decode, Vite freeze, and snapshot in all 10/10 samples, and it was nearly equal to `acceptMs`, accounting for most of acceptance time. Its p95 (the maximum) was 341.90 ms. In contrast, `acceptCheckMs` had p50 0.00 ms and p95 (the maximum) 0.10 ms, mostly below clock resolution. `acceptOtherMs` and `snapshotOtherMs` were also small, with p50 0.00 ms and maximum 0.20 ms. A value of 0.00 ms does not mean the work did not occur.

I identified the mechanism: Vite `freezeCatalogs` uses `Object.isFrozen` checks and its own traversal, while core `diagnostics.freeze` records objects traversed by core in a module-local WeakSet. Data frozen by Vite is absent from core's WeakSet, so core traverses the same tree again. This is a verified mechanism and a measured high-cost stage; it is not proof of the cause of every pause and is not a measured improvement.

The `selectionOtherMs` median of 86.50 ms is a remainder that mixes transport, server work, WS parsing, other client work, and React commit, not pure network time. I make no causal performance claim across runs. The sharp p95 increase has no confirmed explanation.

## Validation

All 12 raw runs (2 warmups plus 10 measured) called each of the eight metrics exactly once. There were zero responses before selection and one compact full response after selection. I controlled the input node/value/React state, generated `.d.ts` files retained their mtime and size, the page did not reload, and reset/removal completed before the next sample.

I verified raw counts, unique tokens, nearest-rank summaries, remainders/call counts, wire data, and hashes across four runs. The small full smoke run (2 measured plus 1 warmup) is in [../benchmarks/results/locale-add-accept-stages-smoke.json](../benchmarks/results/locale-add-accept-stages-smoke.json), the edit-patch regression (2 plus 1) in [../benchmarks/results/accept-stages-edit-regression-smoke.json](../benchmarks/results/accept-stages-edit-regression-smoke.json), and the disabled smoke run (1 plus 0) in [../benchmarks/results/accept-stages-disabled-smoke.json](../benchmarks/results/accept-stages-disabled-smoke.json). Five harness tests passed, covering measured accept semantics, stale/payload/schema rejection, deep freezing of an externally shallow-frozen catalog, fail-closed behavior for a changed dist, edit and disabled operation, and nested-remainder validation. Product tests and consumer typechecks were reused from an earlier stage with unchanged product inputs; I did not rerun build, release checks, or pack.

Results are in the [summary](../benchmarks/results/locale-add-accept-stages.json) and [raw samples](../benchmarks/results/locale-add-accept-stages.10k-20-locales.samples.json). I confirmed that no temporary fixture, profile, or benchmark browser remained. I also verified local document links, code blocks, the under-40 KB size limit, and `git diff --check`.

## Next work

The next step is to avoid duplicate deep traversal of trusted transport catalogs by having Vite and core share core-owned deep-freeze paths and trust tracking. Do not add objects that core has not traversed to the trusted set based only on `Object.isFrozen`. Continue to deeply freeze externally shallow-frozen objects and preserve AST immutability, schema behavior, and error semantics. Then compare against this run using the same instrumentation and options.

This task stopped at instrumentation; the optimization was not implemented. Limitations include one machine, one namespace, headless development mode, and one rendered probe message, with paint and cold start excluded.
