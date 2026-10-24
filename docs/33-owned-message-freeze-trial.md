# 33. Parser-owned message freezing experiment

I implemented and compared the next candidate from [32](32-prebundle-server-measurements.md), but it did not show an improvement, so I reverted it. Product code and the measurement harness remain at `a218fb13eb9deeda82626bb9b792f6973b008c32`. The experiment is preserved as a [patch](../benchmarks/results/owned-message-freeze-experiment.patch).

## Experiment scope

I applied `freezeParsedMessage` to new messages. When the AST and argument schema were in core's deep-traversal WeakSet, the code directly froze and registered the numeric-position object and message record in the cache. Untrusted ASTs and arguments used the existing generic freeze traversal. A shallow external `Object.freeze` alone was not treated as trust in the contents. I changed both the `catalog.ts` call site and the in-memory instrumented transform, and added checks that message-field mutation is rejected and that external shallow-freeze cases fall back correctly. Public exports, wire format, and versions were unchanged.

## Measurement conditions

This ran under Node 24.18.0 on Windows x64 with a Ryzen 5 7430U. A file contained 10,000 ordinary-text and ASCII `{name}` messages, and one equal-length probe changed every iteration. A parser built from the baseline-commit source in a temporary directory and the experimental parser were called alternately in the same process.

Cold mode had 5 warmup and 20 measured pairs without a previous catalog. Incremental mode received the previous immutable catalog and had 50 warmup and 100 measured pairs. Every pair's full parsing result was checked with `assert.deepEqual`. Only call wall time was measured; input stringify, equality checks, disk I/O, the watcher, translation validation, and the browser were excluded. This was a comparison with detailed internal probes disabled. p50 and p95 use nearest rank, and per-pair differences are experiment minus baseline.

```sh
node benchmarks/live-update/parser-stages.mjs benchmarks/results/parser-stages-owned-message-before.json cold
# Collect the snapshot above from the baseline commit, then apply the preserved patch.
git apply benchmarks/results/owned-message-freeze-experiment.patch
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs a218fb1 benchmarks/results/parse-compare-owned-message-cold.json cold
node benchmarks/live-update/parse-compare.mjs a218fb1 benchmarks/results/parse-compare-owned-message-incremental.json incremental
```

To reproduce, use a separate checkout of the baseline commit. currentCodeHashes in the measurement results refer to the experimental dist before reversion and are distinct from the final product dist recorded by this document. The five core hashes are the same between the two comparisons.

## Results and adoption decision

| Mode | Baseline p50 | Experiment p50 | Baseline p95 | Experiment p95 | Per-pair difference median | Per-pair difference p95 | Faster pairs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 118.04 | 120.36 | 195.72 | 221.65 | -3.82 | +128.50 | 10/20 |
| incremental | 49.76 | 50.45 | 76.64 | 86.21 | +0.80 | +24.58 | 47/100 |

Units are ms. The cold per-pair median was lower, but only half the pairs were faster and overall p50/p95 were higher. Incremental mode also showed no confirmed improvement. The evidence from these samples was insufficient to adopt the change, so I reverted all experimental changes in the four files. Run load, GC, and scheduling were uncontrolled on a single machine, so I do not establish the code as the cause of the increase. I do not deduct GC or control time or extend this result to an end-to-end locale-add improvement.

The detailed cold snapshot before the experiment came from a separate run. For 10k, total p50/p95 was 141.07/317.35 ms and messageFreeze was 55.81/237.76 ms. In 11 of 20 measured runs, a GC timestamp overlapped the parsing interval. messageFreeze includes AST freezing, absolute-position creation, message-record creation, and generic freezing together. I do not add nested p95 values or use this snapshot as the baseline time for the cross-comparison.

The next small task is to split the existing messageFreeze measurement into AST freezing, absolute-position creation, and record freezing. After identifying the larger costs, I will choose the next product experiment. Large list rendering still fails to meet the 250 ms target, and I did not add end-to-end measurements in this work.

## Validation and preserved evidence

In the experimental state, the core build, 76 tests, and JS/TS consumer typechecks passed. Full parsing-result equality passed for all 25 cold and 150 incremental pairs. After reverting, I rebuilt core, and 24 catalog tests plus `git apply --check` for the preserved patch passed. The five final core dist hashes and the probe matched the pre-experiment snapshot. I recalculated comparisons and stage summaries from the raw samples and reconciled them. All 179 local links in the six changed Markdown files, code fences, the 40 KB limit, and `git diff --check` passed. Because no product change was adopted, I did not repeat the full workspace, pack, browser, or release checks.

- [Cold comparison and raw pairs](../benchmarks/results/parse-compare-owned-message-cold.json)
- [Incremental comparison and raw pairs](../benchmarks/results/parse-compare-owned-message-incremental.json)
- [Pre-experiment internal measurement](../benchmarks/results/parser-stages-owned-message-before.json)
- [1k raw samples](../benchmarks/results/parser-stages-owned-message-before.1000.samples.json)
- [10k raw samples](../benchmarks/results/parser-stages-owned-message-before.10000.samples.json)
- [Reverted experiment patch](../benchmarks/results/owned-message-freeze-experiment.patch)

No version change, push, publish, or deploy was performed.
