# 17. Cold Parser Instrumentation Results

This document reports the results of adding benchmark-only instrumentation for the cold internal parser path. It is not a product optimization. Product source and dist were unchanged, and the instrumentation runs only inside the benchmark harness. All numbers apply to parser instrumentation; watcher, validation, and browser paths are out of scope.

## Execution

```
node benchmarks/live-update/parser-stages.mjs benchmarks/results/parser-stages-cold-final.json cold
```

The final run used Node 24.18.0 on Windows x64. Here, cold does not mean a cold process start; it means parsing without a previous catalog (previous is always undefined).

## Measurement setup

- Cold settings: warmup 5, samples 20, inputs of 1k and 10k each, and en-GB English literal plus ASCII `{name}` placeholders.
- Three instrumentation modules and an in-memory Node hook (catalog/json/schema). Product source and dist were not changed.
- Measured stages: per-message AST, argument inference (inclusive), argument schema freeze, message freeze, and final catalog freeze.
- jsonMs includes strict parse and tokenScan. argumentsMs includes argumentFreeze, and messageLoop includes AST, arguments, and messageFreeze.
- Per-sample residuals are calculated first, then summarized. Values at p95 were not added together.
- Instrumentation clock and counter overhead are included in the measurements.

## Results

The final results are in [parser-stages-cold-final.json](../benchmarks/results/parser-stages-cold-final.json), with raw data in the [1k samples](../benchmarks/results/parser-stages-cold-final.1000.samples.json) and [10k samples](../benchmarks/results/parser-stages-cold-final.10000.samples.json) (25 rows each, including warmups).

| Input | Total p50 (ms) | Total p95 (ms) |
| --- | --- | --- |
| 1k | 24.78 | 77.65 |
| 10k | 321.21 | 598.09 |

Stage p95 for 10k (ms): json 17.82, AST 90.23, argumentInferenceOnly 95.50, argumentFreeze 219.30, messageFreeze 213.98, finalFreeze 6.20.

For 10k, the combined share of the three non-overlapping freeze stages in each individual sample was at least 52.16%, with a median of 71.25% and a maximum of 90.62%. This is not a sum of p95 values. It is the wall-time share of the freeze calls and should not be treated as CPU utilization or as a cost with GC removed.

The 10k input was 387,772 B. It differs from the locale-add fixture's 387,783 B by the probe difference.

## GC observations

The startTime of GC PerformanceObserver entries is mapped against the parser perf.now window. Entries are not attributed based on when the callback was delivered, and overlapping intervals are merged into a union so they are not counted twice. No forced GC was used. heapUsed is read before and after parsing outside the timing window. Its difference includes uncollected garbage and is a change in usage, not total allocation or a V8 heap snapshot. GC observation duration does not measure actual stop-the-world pause or CPU time, so it cannot be subtracted from parsing time.

GC overlap was observed in 15 of 20 samples, and the GC interval union p95 was 112.89 ms. The five samples with no observed overlap had a p95 of 585.69 ms, so GC alone cannot be identified as the cause of the tail. The p95 for the 15 samples with observed GC overlap was 648.26 ms. Do not generalize category p95 values from this small sample.

## Incremental regression check

The incremental regression smoke results are in [parser-stages-incremental-gc-smoke.json](../benchmarks/results/parser-stages-incremental-gc-smoke.json), with raw data in the .1000/.10000.samples.json files with the same stem (warmup 10, samples 50). Reuse of unchanged message references and AST freeze checks passed. Total p95 for 1k/10k was 2.74/36.12; this was a regression check run, not a comparison for measuring a later performance improvement. GC interval clipping, union, boundaries, and empty intervals were checked with independent inputs, and the detailed hook was also checked with nested ICU, skeleton, freezing, duplicate IDs, and ICU error handling. Raw sample counts, summaries, residual intervals, GC windows, and code hashes were also compared.

## Limitations and next candidates

This run added instrumentation; it did not optimize anything, so it cannot claim that the 250 ms list-display target was met. After the first exploratory run (p95 774.68 ms), duplicate GC unions were fixed and the raw files were split. The first exploratory raw data was not retained and is not used for before/after performance comparisons.

The later [preceding cold run](../benchmarks/results/parser-stages-cold.json) had a 10k total p95 of 1,054.05 ms and freeze shares of at least 51.59% with a median of 58.67%. Before the final run, the representation of heap metadata was corrected; the measurement logic and product code were not changed. The raw samples from both runs are retained separately. Because load, GC, and scheduling were not separated, the change from 1,054.05 to 598.09 ms is not interpreted as a performance improvement. The earlier result's `heap snapshots` and `live-heap` labels are also inaccurate: the actual collection used before/after `process.memoryUsage().heapUsed` values.

Candidate product optimizations are reducing object creation and traversal during freezing and examining reuse of identical argument schemas or structure-specific AST freeze paths. Immutability, ICU, and error-position contracts remain in place.
