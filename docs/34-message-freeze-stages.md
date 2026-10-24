# 34. Internal-stage measurement of message freezing

Using the product code after reverting the experiment in [33](33-owned-message-freeze-trial.md), I divided the internal cost of message freezing. AST freezing was the largest child stage in 18 of 20 10k measurements. Absolute-position creation had a per-sample median share of 1.86% of all message freezing. The next candidate is removing per-call creation of an internal helper in the AST freezing function; it is not yet applied to the product.

## Conditions and boundaries

```sh
node --test benchmarks/live-update/parser-probe.test.mjs
node benchmarks/live-update/parser-stages.mjs benchmarks/results/parser-stages-message-freeze-split-cold.json cold
```

gitRevision was `eae473eb87f0313507b8c08631c5768c5b37a3fe` and measuredAt was `2026-10-07T14:15:27.226Z`. This ran under Node 24.18.0 on Windows x64 with a Ryzen 5 7430U. A file contained 1k or 10k ordinary-text and ASCII `{name}` messages, and I collected 5 warmups and 20 measured runs without a previous catalog at each scale. Inputs were 36,772/387,772 B, and one equal-length probe changed each iteration. The namespace was bench and the locale was en-GB. Forced GC was not used.

Transformation occurs only in memory through a Node load hook that reads core dist. Product source and dist were unchanged. The result format is `saylo-parser-stages-v3`. I added three boundaries and per-sample remainders to the existing detailed cold probe.

| Field | Work included |
| --- | --- |
| messagePositionMs | Absolute-coordinate lookup from `positionAt(entry.valueOffset)` and position-object creation. Position-object freezing is excluded |
| messageAstFreezeMs | The entire `freezeMessageAst(ast)` call. Includes node/array freezing, core WeakSet lookup and registration, required position freezing, and internal helper creation |
| messageRecordFreezeMs | Generic `freeze` on an already-created message record. Includes recursive position-object freezing, AST/argument cache checks, and record freezing and registration |
| messageFreezeOtherMs | Per-sample remainder of parent messageFreeze after subtracting the three stages above. Includes record creation, map assignment, probe recording, and work between stages |

Position creation → AST freezing matches the product's original argument-evaluation order. The older v2 detailed probe ran AST freezing first. Because stage count, order, and timer overhead differ, I do not compare total time with the past or use it as a before/after optimization comparison. Record creation is outside recordFreeze timing but inside parent messageFreeze. AST and argument inference are separate sibling stages, and the existing argumentFreeze is a child of arguments.

Input stringify, heapUsed reads, assertions, disk I/O, the watcher, translation validation, and the browser are outside measurement. Each stage is synchronous wall time including probe overhead, GC, and scheduling. p50 and p95 use nearest rank. I do not add nested p95 values, deduct GC/control time, or mix Node and browser clocks.

## Results

| Stage | 1k p50 | 1k p95 | 10k p50 | 10k p95 |
| --- | --- | --- | --- | --- |
| total | 25.66 | 61.23 | 172.09 | 277.32 |
| Parent messageFreeze | 11.76 | 46.20 | 81.89 | 202.42 |
| Absolute-position creation | 0.29 | 0.45 | 1.52 | 1.98 |
| AST freezing | 5.04 | 39.77 | 36.24 | 166.01 |
| Record freezing | 4.51 | 6.17 | 31.93 | 38.93 |
| Parent remainder | 1.62 | 5.25 | 9.39 | 12.08 |

Units are ms. Comparing the four child stages per sample, AST was largest in 18 runs and the remainder in 2 at 1k; at 10k, AST was largest in 18 runs, record freezing in 1, and the remainder in 1. AST was larger than record freezing in 20/20 and 19/20 samples. Absolute-position creation/parent shares were 2.38% and 1.86% at p50, and 2.93% and 2.16% at p95. Position freezing belongs to the record stage, so this share does not explain all position-related cost.

A GC timestamp overlapped the full parsing interval in 9/20 and 11/20 measurements. I did not analyze whether GC overlap caused the AST-freezing tail and did not deduct overlap time. This measurement does not support a claim that the 250 ms target for real locale lists was met or that end-to-end performance improved.

## Validation and next candidate

The new probe checks run detailed mode on and off in separate Node processes. They reconciled ordinary, Unicode, CRLF, plural, and number-skeleton results and malformed ICU and duplicate JSON-key diagnostics with the original parser. They also verified deep freezing, AST reuse after position movement, message-reference reuse within the same file, cold child-call counts, and parent timing boundaries. One test passed. The five dist hashes were unchanged, and they also matched the [pre-experiment snapshot in 33](../benchmarks/results/parser-stages-owned-message-before.json).

For the 25 raw runs per scale, I checked call counts, finite times, and stage remainders, and recalculated every summary for the 20 measured runs. I reconciled core, harness, and lockfile hashes with current files. Because product code was unchanged, I did not repeat full-workspace, build, consumer typecheck, pack, browser, or release checks.

I also rechecked the per-sample comparison analysis against raw data. All 182 local links in the six changed Markdown files, code fences, the 40 KB limit, and `git diff --check` passed.

The next small product experiment is to move the `seal` helper created by `freezeMessageAst` on every call into a shared module-scope function. It will retain internal WeakSet trust and generic freezing of complex ICU messages delegated to FormatJS. This measurement did not isolate the cost of helper creation, so the effect is unknown. A cold/incremental cross-comparison will decide adoption. I will not reapply the already-reverted direct message-freezing experiment.

## Data

- [Summary](../benchmarks/results/parser-stages-message-freeze-split-cold.json)
- [1k raw samples](../benchmarks/results/parser-stages-message-freeze-split-cold.1000.samples.json)
- [10k raw samples](../benchmarks/results/parser-stages-message-freeze-split-cold.10000.samples.json)
- [Per-sample comparison analysis](../benchmarks/results/parser-stages-message-freeze-split-cold-analysis.json)

No version change, push, publish, or deploy was performed.
