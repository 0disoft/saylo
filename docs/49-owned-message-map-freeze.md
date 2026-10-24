# 49. Freezing parser-owned message maps

I locally applied an optimization that skips re-traversal of the final map when its messages are already deeply frozen. In both edit-parser cross-comparisons, p50, p95, and the per-pair difference median were all observed lower. New parsing produced mixed metrics, so I do not claim a consistent improvement. Actual watcher and UI-update paths have not yet been remeasured.

Follow-up measurements on actual updates and their limitations are recorded in [50-owned-message-map-live-measurements.md](50-owned-message-map-live-measurements.md).

## Change and trust boundary

`catalog.ts` freezes a successfully parsed message map with the internal `freezeOwnedMessageMap` and registers it in the deep-freeze trust WeakSet. The final catalog itself still finishes through the existing generic `freeze`. The change removes `Object.values` allocation for the map and the traversal that checked trust for every message. `Object.freeze` still freezes the map; heap use and total allocation were not measured.

This function is used only for new maps owned by the parser. New messages complete the existing `freeze`, and reused messages come only from deeply frozen previous catalogs. Reused messages whose positions changed have new records frozen by the existing `freeze`. If there are diagnostic errors, finalization fails before the map. Therefore every child is already trusted when the map is frozen, and an empty map is also safe. Generic `freeze` and recursive traversal of externally shallow-frozen objects remain unchanged. The code does not assume that external input satisfies this internal function's preconditions.

Public entries, types, wire format, and versions were unchanged. This differs from the direct per-message freezing experiment ([33](33-owned-message-freeze-trial.md)) and the generic for-in freezing experiment ([19](19-ast-freeze-measurements.md)). The CPU evidence is in [48](48-parser-cpu-profile.md), and I do not attribute every freeze sample in that profile to this final-map cost. `parser-probe.mjs` now measures final-map and catalog freezing together within the existing `freezeMs` boundary.

## Same-process cross-comparison

The baseline is `49fe1eb`, Node v24.18.0, Windows x64. One probe among 10,000 plain/ASCII-argument messages changes to an equal-length value, and the baseline and changed parsers are compared with alternating call order. Cold mode had 5 warmup and 20 measured pairs; incremental had 50 warmup and 100 measured pairs. Every pair's full parsed catalog was checked for equality. Input stringify, equality checks, disk I/O, the watcher, and the browser were outside timing; there was no detailed clock instrumentation or forced GC. OS load and GC were uncontrolled. The order was cold → incremental → cold remeasurement → incremental remeasurement.

```sh
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs 49fe1eb benchmarks/results/parse-compare-owned-map-cold.json cold
node benchmarks/live-update/parse-compare.mjs 49fe1eb benchmarks/results/parse-compare-owned-map-incremental.json incremental
```

Remeasurements used the same commands with `-confirm` appended to the output names and ran in separate Node processes. Units are ms, quantiles use nearest rank, and differences are changed minus baseline.

| Mode | Baseline p50 | Changed p50 | Baseline p95 | Changed p95 | Per-pair difference median | Faster pairs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| First cold | 213.58 | 183.26 | 430.55 | 351.92 | -36.31 | 14/20 |
| First incremental | 58.07 | 45.77 | 123.28 | 86.54 | -10.27 | 79/100 |
| Cold remeasurement | 168.93 | 200.40 | 565.77 | 430.53 | -4.05 | 10/20 |
| Incremental remeasurement | 50.67 | 41.35 | 99.27 | 85.97 | -8.62 | 82/100 |

For edits, both runs had lower medians and p95 values, and 79/100 and 82/100 pairs were faster. I adopted the change based on this evidence for removing duplicate traversal in the edit path. Cold remeasurement p50 increased and only half the pairs were faster, so I did not confirm a consistent benefit for new parsing. In the first run, the longest calls also increased from 434.34 to 486.58 ms in cold and from 237.79 to 381.25 ms in incremental. The remeasurement reduced the maxima, but I do not claim stable improvement across the full tail or achievement of end-to-end targets. Fixed order, a single machine, and load differences prevent interpretation as CPU time or causal proof.

## Validation and sources

- The core build, 77 core tests, and JS/TS consumer typechecks passed.
- One parser-probe test, nine Vite patch/wire tests, and five typegen tests passed. Including core, 92 tests passed in total; pack, release, and browser checks were not run.
- New regression tests verified deep immutability for empty maps, complex ICU messages, literal prototype IDs, and new, reused, and position-changed messages; rejection of map addition and deletion; and rejection of untrusted, contaminated ASTs from a shallow-frozen previous catalog. Existing external shallow-freeze, duplicate-JSON, ICU error-position, Unicode, schema, and snapshot checks also remained in place.
- Full result deep equality passed in all 350 pairs, including warmups. I rechecked differences and p50/p95/min/max for 240 measured pairs from raw data; all five core code hashes matched across the four runs and current dist. No temporary parser directory remained.

Raw data: [first cold](../benchmarks/results/parse-compare-owned-map-cold.json), [cold remeasurement](../benchmarks/results/parse-compare-owned-map-cold-confirm.json), [first incremental](../benchmarks/results/parse-compare-owned-map-incremental.json), [incremental remeasurement](../benchmarks/results/parse-compare-owned-map-incremental-confirm.json).

This is a local change and is not yet in the npm release. Next is to remeasure actual large edit propagation and locale addition with the normal prebundle and typegen. No version change, push, publish, or deploy was performed.
