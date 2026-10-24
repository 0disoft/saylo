# 47. Combined JSON field-regex experiment

I tested a candidate that read keys, colons, and string values with one regex call. The edit-parser p95 improvement did not hold on remeasurement, so **I did not adopt the change and reverted it**. Product source matches `e76a3a1`; only one JSON boundary and error-priority regression test and this experiment record remain.

## Candidate and reproduction

The candidate combined the three regex calls for key, separator, and value in `readJson` into one call with capture groups. It returned `INVALID_CATALOG` immediately when a string value was not captured. It retained the initial strict `JSON.parse`, per-key `JSON.parse`, decoded-duplicate checks, entry array, source-value and position calculations, and ICU handling and freezing. This differs from skipping key decoding in [11](11-parser-measurements.md) and removing the entry array in [41](41-json-entry-visitor-trial.md). I did not measure allocation or heap reduction.

The [reproduction patch](../benchmarks/results/json-fields-experiment.patch) contains only product `packages/core/src/json.ts`. Copy it to the same path in a separate checkout of baseline commit `e76a3a1` and run the following commands. Change the last argument to `incremental` for an edit comparison that reuses unchanged messages.

```sh
git apply benchmarks/results/json-fields-experiment.patch
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs e76a3a1 benchmarks/results/parse-compare-json-fields-cold.json cold
```

On 2026-10-10 KST under Node v24.18.0 on Windows x64, I used the existing same-process cross-comparison tool. One probe among 10,000 literal/ASCII-argument messages changed to an equal-length value. Cold mode had 5 warmup and 20 measured pairs without a previous catalog; incremental had 50 warmup and 100 measured pairs. Call order alternated, and every full result was checked with `assert.deepEqual`. stringify, equality checks, disk I/O, the watcher, translation validation, and the browser were outside timing. There was no detailed clock instrumentation or forced GC, and OS load and GC were uncontrolled.

## Results

Units are ms, p50 and p95 use nearest rank, and per-pair differences are experiment minus baseline. I excluded the first cold run from the adoption decision because core tests ran concurrently, and preserved only its raw data. The other three runs did not overlap this work's tests or build.

| Comparison | Baseline p50 | Experiment p50 | Baseline p95 | Experiment p95 | Per-pair difference median | Faster pairs |
| --- | --- | --- | --- | --- | --- | --- |
| First cold (excluded from decision) | 105.16 | 102.82 | 183.26 | 168.79 | -0.94 | 11/20 |
| Cold remeasurement | 106.61 | 102.74 | 153.35 | 155.12 | -2.54 | 13/20 |
| First incremental | 39.63 | 37.42 | 68.02 | 56.10 | -2.55 | 67/100 |
| Incremental remeasurement | 48.47 | 47.02 | 68.47 | 74.67 | -0.89 | 58/100 |

All medians were observed lower, but edit p95 increased on remeasurement and cold p95 did not decrease. The evidence for a stable tail improvement was insufficient, so I reverted the change. I do not establish the code as the cause of the increase, and this work did not measure end-to-end performance or achievement of existing UI-update targets.

## Validation and sources

- In the experimental state, the core build, 76 core tests, and JS/TS consumer typechecks passed.
- Full catalog equality passed in all 350 pairs, including warmups. I recalculated counts, differences, and nearest-rank statistics for 240 measured pairs from raw data, and all four runs had the same experimental code hash.
- After reversion, the core build, 76 core tests, and one parser-probe test passed. There was no product source diff, and among the five rebuilt core modules only `json.js` differed from the experimental build. The patch reapplication check passed, and no temporary parser directory remained.
- The retained regression test covers escaped quotes and fake JSON fields inside values, backslashes, Unicode escapes, empty strings, and precedence plus exact CRLF source positions for a non-string token after duplicate-ID/ICU errors. It also passes on the existing implementation.

Raw data: [first cold](../benchmarks/results/parse-compare-json-fields-cold.json), [cold remeasurement](../benchmarks/results/parse-compare-json-fields-cold-confirm.json), [first incremental](../benchmarks/results/parse-compare-json-fields-incremental.json), [incremental remeasurement](../benchmarks/results/parse-compare-json-fields-incremental-confirm.json).

No version change, push, publish, or deploy was performed. Before repeating another micro-optimization, the next step is to inspect the current parser's CPU profile to narrow down functions with real execution cost. Existing elapsed-stage measurements alone do not establish a CPU bottleneck or GC cause.
