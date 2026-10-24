# 32. Prebundle server-file stage measurement

With detailed instrumentation disabled, the large list p95 in [31](31-prebundle-freeze-locale-add.md) was 268.54 ms, above the 250 ms target. I remeasured the current server without changing product source/dist or the harness.

## Measurement conditions

```sh
node benchmarks/live-update/run.mjs --mode locale-add --server-file-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-prebundle-server-files.json
```

gitRevision was `7306fb115f4c87182a66d429b439a3667565b8ae` and measuredAt was `2026-10-07T13:49:34.594Z`; the worktree was clean at the start.

The initial scale was 10k messages × 20 locales/files with 7,755,280 B of JSON. There was one bench namespace, and each iteration added 387,783 B of en-GB JSON. There were 2 warmups, 10 measured runs, and 10 controls, for 12 raw runs. Nearest-rank p95 over 10 runs is the maximum. The default prebundle and typegen were enabled, and only detailed server-file measurement was on. Detailed CPU, browser, reply, and client measurements were off. The environment was Node 24.18.0, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, Windows x64, and Ryzen 5 7430U.

Measurement spans from immediately before the save through the list DOM ack. Initial boot, the full response after selection, return to en, and file removal are excluded from this server interval. Generated declaration mtime/size, input DOM node/value, and React state were preserved, and return/removal completed without reload.

## Measurement hooks

The Node hook transforms `packages/typegen/dist/catalog-files.js` in memory and wraps methods on `LiveRegistry` and `CatalogRegistry`. `readAndCandidate` spans from drain through entry into prepareTranslations and includes path checking, file reading, parsing, candidate filtering, baseline-file stat, and serialization wait. Parsing is the synchronous wall time of the parseCatalog call and argument construction; path checking and reading are asynchronous wall time. Translation preparation includes schema lookup, new-translation validation, and quarantine setup and is distinct from final active validation. candidateOther is the per-sample remainder of readAndCandidate after subtracting path checking, reading, and parsing.

Stages overlap, so I do not add p95 values. Wall time includes probe overhead and pauses and is not pure CPU time. GC and scheduling delays were not separately observed. I do not mix Node and browser clocks or deduct control/GC costs.

## Results

| Interval | p50 | p95 |
| --- | --- | --- |
| List | 230.40 | 390.49 |
| save→broadcast | 215.57 | 373.78 |
| Browser selection → commit | 201.60 | 402.60 |
| Node selection preparation → ack | 205.14 | 407.16 |
| Node save → translation ack | 445.15 | 656.50 |
| control | 2.90 | 5.28 |
| queue→drain | 47.85 | 54.24 |
| readAndCandidate | 137.86 | 308.22 |
| path | 0.65 | 3.22 |
| UTF8 read | 1.09 | 8.04 |
| parse | 133.78 | 306.39 |
| candidateOther | 1.24 | 16.57 |
| translationPrep | 9.52 | 12.27 |
| final validate | 0.04 | 0.05 |
| registry replace | 0.09 | 0.17 |

Units are ms. Excluding the nested readAndCandidate interval, parsing was the largest individual stage in 10/10 runs. Per-sample parsing/readAndCandidate shares ranged from 84.43% at minimum to 95.99% at p50 and 99.41% at maximum. These are wall-time shares within candidate and do not represent total latency or CPU share.

List rendering finished within 250 ms in 7/10 runs, with a minimum of 199.73 ms and maximum of 390.49 ms; p95 missed the target. I reconciled raw counts, instrumentation options, finite times, call counts, summaries, bytes, Node timing boundaries, controls, and code hashes. All 12 raw runs had one drain, two file events, and one each of path checking, reading, and parsing. catalogDelta was zero because the post-selection full load is outside the measured interval. There were zero responses before selection and one compact full response after it. Serialized JSON frame p95 was 1,241,400 B and is not actual network bytes. Measurement-code hashes matched the normal run in 31.

## Parser-only revalidation

The reuse evidence is the 20 measured runs in the [existing cold internal instrumentation](../benchmarks/results/parser-stages-position-pool-cold.json) and [10k raw samples](../benchmarks/results/parser-stages-position-pool-cold.10000.samples.json). The SHA values for core's catalog, json, diagnostics, schema, and simple-message files matched the current files. I rechecked the raw summary; messageFreeze was larger than JSON, AST parsing, argument inference, and messageLoopOther in 17/20 runs. messageFreeze p50/p95 was 39.17/94.92 ms, AST parsing 20.19/56.79 ms, argument inference 22.07/41.30 ms, and JSON 30.21/72.66 ms. messageFreeze includes AST freezing, absolute-position creation, message-record creation, and freezing, so I do not assign it solely to the cost of freezing a plain object. Samples, fixtures, and probes differ from the server run, so I do not combine or causally compare them.

## Next experiment

The next candidate is a small experiment that uses the structure of newly created message and numeric-position objects from the parser to reduce generic Object.values traversal. It will preserve deep-freeze trust for AST and argument schemas, UTF-16 source positions, Unicode and ICU error semantics, and recursive traversal of externally shallow-frozen objects. A cold/incremental cross-comparison will decide adoption. This work did not implement the optimization.

Because product and harness code were unchanged, I did not rerun tests, typechecks, build, pack, or release checks. No temporary fixture or benchmark browser remained.

## Links

- [Result summary](../benchmarks/results/locale-add-prebundle-server-files.json)
- [Raw samples](../benchmarks/results/locale-add-prebundle-server-files.10k-20-locales.samples.json)
- [Analysis](../benchmarks/results/locale-add-prebundle-server-files-analysis.json)

The earlier [21](21-locale-add-server-remeasurement.md) and [31](31-prebundle-freeze-locale-add.md) differ in load, code, instrumentation, and samples, so I do not make causal comparisons of total time. No version change, push, publish, or deploy was performed.
