# 41. JSON entry visitor-callback experiment

I experimented with removing the temporary entry array from the JSON-reading path. The performance evidence was insufficient for both cold and incremental modes, so I reverted it. Product code and the measurement harness remain at `257ea857126a1d4856bbfb7a125db28b9417dd16`, and the experiment is preserved in a [patch](../benchmarks/results/json-entry-visitor-experiment.patch).

## Experiment scope

`readJson` in `packages/core/src/json.ts` took a visitor callback instead of a `JsonEntry[]` and returned `void`. It passed each item as it was encountered without accumulating a temporary array. Because it still creates each entry object and regex match, I do not claim complete elimination of allocation or lower memory use.

Strict `JSON.parse` validation and duplicate-ID checks across string and decoded IDs were retained. When a duplicate is found, the callback stops but the scanner continues so that a following non-string value still returns `INVALID_CATALOG` in preference to `DUPLICATE_ID`. `catalog.ts` handles messages through the callback, collects `INVALID_ID`, ICU, and `ARGUMENT_CONFLICT`, and checks them after the reader finishes, so JSON errors take precedence. The position index is created lazily on the first `positionAt`, so an invalid source type raises the existing `INVALID_JSON` instead of a native `TypeError`. Public exports, versions, and wire format were unchanged. The reverted files were the product's `json.ts` and `catalog.ts` plus `catalog.test.mjs`.

## Measurement conditions

This ran under Node v24.18.0 on Windows x64. Cold results were recorded at 2026-10-09T08:24:35.395Z and incremental results at 2026-10-09T08:25:55.980Z. One probe among 10,000 simple messages and ASCII arguments changed to an equal-length value each iteration. A parser built from baseline commit `257ea85` source in a temporary directory and the experimental parser were called alternately in the same process. Cold mode had 5 warmup and 20 measured pairs; incremental had 50 warmup and 100 measured pairs, and every full result was checked with `assert.deepEqual`. Only call wall time was measured; stringify, equality checks, disk I/O, the watcher, translation validation, and the browser were excluded. p50 and p95 use nearest rank, per-pair differences are experiment minus baseline, and I do not add p95 values or deduct GC/clock time. To reproduce, use a separate checkout of the baseline commit, copy the patch above to the same paths and apply it with `git apply`, build core, and run `benchmarks/live-update/parse-compare.mjs` in cold and incremental modes. `baselineRevision` in both results is `257ea857126a1d4856bbfb7a125db28b9417dd16`; `currentCodeHashes` refers to the experimental dist before reversion and is the same in both modes.

## Results and adoption decision

| Mode | Baseline p50 | Experiment p50 | Baseline p95 | Experiment p95 | Per-pair difference median | Per-pair difference p95 | Faster pairs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 81.22 | 99.03 | 141.77 | 152.26 | +10.50 | +68.05 | 5/20 |
| incremental | 23.37 | 24.42 | 35.70 | 35.47 | +0.72 | +9.26 | 37/100 |

Units are ms. For cold parsing, both p50 and p95 increased and only 5 of 20 pairs were faster. In incremental mode, p50 increased and only 37 of 100 pairs were faster, while the maximum increased from 40.86 to 56.63 ms and only aggregate p95 decreased slightly from 35.70 to 35.47 ms. Because this cold comparison showed no improvement, I did not adopt the change based on a marginal incremental p95 decrease, and reverted the two product and test changes. Run load, GC, and scheduling were uncontrolled on a single machine, so I do not establish the code as the cause of the increase or as a regression. I did not measure heap and do not claim improvement in actual HMR or locale targets or a direct causal connection to earlier run numbers.

## Validation and preserved data

In the experimental state, the core build, 32 selected catalog/simple tests, all 76 core tests, and consumer typechecks passed. The 32 selected tests are included in the 76 and are not added again. New JSON tests verified that later duplicate-key and non-string value errors take precedence over ICU, ID, and argument-conflict errors, escaped duplicate keys, overwritten non-string values, and the order and offsets of two duplicate errors. Existing Unicode, ICU position, identical-message reference reuse, and deep-immutability tests also passed, and full-catalog deep equality passed for all 25 cold and 150 incremental pairs. I did not run the detailed `parser-probe` because its boundaries changed during the experiment; the comparison tool ran with detailed instrumentation disabled.

After reverting the three files, the core build and `parser-probe.test.mjs` passed. I confirmed there was no diff in the product or measurement paths and that both runs' code hashes were equal. The rebuilt catalog and JSON hashes differed from the experimental version, while the other three modules were unchanged. I checked raw pair counts, differences, nearest-rank summaries, and used `git apply --check` to verify that the preserved patch can be reapplied. The temporary parser directory was cleaned up.

- [Cold comparison and raw pairs](../benchmarks/results/parse-compare-json-visitor-cold.json)
- [Incremental comparison and raw pairs](../benchmarks/results/parse-compare-json-visitor-incremental.json)
- [Reverted experiment patch](../benchmarks/results/json-entry-visitor-experiment.patch)

No version change, push, publish, or deploy was performed. The next step is to review other structural bottleneck candidates without forcing another experiment.
