# 54. Reusing plain argument contracts

This document records the core `schema.ts` optimization in local commit `169e72b`. It memoizes plain argument schemas produced by the parser by name. The change was adopted locally based on a cold cross-comparison, and a real Vite and browser ABBA comparison observed a passing large target for the locale list. The edit-propagation target failed.

## Background: current cold parser profile

Observations were collected from 25 cold runs at revision `ae40ba6` on 2026-10-10 (KST).

| Item | Value |
| --- | --- |
| Cold 25 runs p50 / p95 | 73.66 ms / 159.48 ms |
| CPU samples | Total 1334 = parserStack 281 + coreWithoutParserStack 489 (combined attribution 770) + GC 95 + outside 469 + idle 0 |
| Top self shares | readJson 30.78%, inferArguments 23.90%, parseSimple 16.75%, freeze 13.12% |
| Input | One file with 10k simple ASCII names |
| Profiler sample interval / forcedGC | 1000 µs / false |

Self shares are percentages of attributed samples, not CPU time or allocation volume. Rankings can change with hardware, JIT, and inlining state.

## Implementation scope (core/schema.ts only)

- Apply the shortcut only to literals or cases where the same single plain argument repeats.
- Memoize schemas by name in a `WeakMap` keyed by the canonical per-parse `Map`, avoiding repeated `Map` construction. Compute the repeated JSON signature once, then reuse the memo.
- Keep the AST classification loop unchanged.
- Keep the normal walk and conflict checks for multi-argument and nested ICU messages.
- Preserve canonical signature, identity, accepted type order, null prototype, and deep immutability.
- Leave `parseSimpleMessage` and the combined parse-and-collect experiment ([40](40-simple-argument-trial.md)) unchanged.
- The comparison baseline is `4aacb93`.

## Measurement results

Units are milliseconds, and diff is after−before.

| Segment | before p50 / p95 | after p50 / p95 | diff median | diff p95 | improved |
| --- | ---: | ---: | ---: | ---: | --- |
| Paired cold, first 20 pairs | 84.02 / 163.97 | 62.92 / 125.31 | -27.81 | -0.26 | 19/20 |
| Cold confirmation, 20 pairs | 86.10 / 163.90 | 72.41 / 133.11 | -14.67 | +54.71 | 18/20 |
| Incremental, 100 | 27.24 / 38.98 | 25.16 / 38.01 | -1.16 | +6.00 | 61/100 |

| Maximum | before | after |
| --- | ---: | ---: |
| cold | 208.32 | 127.41 |
| cold confirmation | 189.92 | 165.31 |
| edit | 100.01 | 88.20 |

## Interpretation and limitations

- Cold p50 and median improved in both runs. The sign of diff p95 varies by run (-0.26 for the first 20 pairs and +54.71 for the confirmation).
- Incremental improved only slightly, with median -1.16 ms, while diff p95 increased by 6.00 ms. No general edit improvement was confirmed.
- The two parsers processed the same input in the same process, alternating order and pairing samples. There was no randomization, forced GC, or load control, so this is not treated as proof of causation.
- The change was adopted locally based on cold evidence, but these numbers alone do not establish an end-to-end improvement or target achievement.

## Validation

- All 78 core tests and the consumer typecheck passed.
- Five typegen tests, nine Vite patch/wire tests, and one probe passed, for 93 total.
- A separate validation check confirmed the profile's 25 wall samples, 1334 CPU samples, and nine hashes. It also confirmed the comparison's 140 measured pairs (250 total deepEqual pairs including warmups), the nearest-rank summaries and pairwise differences for three runs, and matching hashes for all five current dist files.

## Raw sources

- [parser-cpu-cold-2026-10-10.json](../benchmarks/results/parser-cpu-cold-2026-10-10.json) · [.cpuprofile](../benchmarks/results/parser-cpu-cold-2026-10-10.cpuprofile)
- [plain-contracts-cold-2026-10-10.json](../benchmarks/results/plain-contracts-cold-2026-10-10.json)
- [plain-contracts-cold-confirm-2026-10-10.json](../benchmarks/results/plain-contracts-cold-confirm-2026-10-10.json)
- [plain-contracts-incremental-2026-10-10.json](../benchmarks/results/plain-contracts-incremental-2026-10-10.json)

## Status

The final local adoption is local commit `169e72b`, which has not been pushed. There was no version bump, publication, or deployment.

The live before/after comparison used ABBA ordering with 50 measured runs per mode and variant. The tool policy is plain-contracts at `40bfa5a`, replacing only `schema.ts`.

## Real Vite and browser before/after comparison

Isolated snapshots changing only `schema.ts` from `4aacb93` to `169e72b` ran with the same dependencies and harness. Edits and locale additions each followed before/after/after/before order, with 25 measured runs, 5 warmups, and 10 controls per run. Normal prebundling and typegen remained enabled, while detailed CPU, GC, file, and browser instrumentation was disabled. Edits ran before locale additions. The p50/p95 values (ms) below are nearest-rank results across the 50 measured runs for each variant.

| Segment | before p50 / p95 | after p50 / p95 |
| --- | ---: | ---: |
| Edit save→DOM ack | 136.94 / 259.15 | 143.58 / 197.22 |
| Locale save→list ack | 201.50 / 536.37 | 151.79 / 193.56 |
| Locale save→first-translation ack | 406.65 / 784.11 | 323.79 / 491.51 |
| Selection ready→translation ack (Node) | 193.28 / 258.73 | 164.72 / 279.53 |
| setLocale→commit (Browser) | 190.30 / 256.10 | 161.90 / 217.50 |

| ABBA run p95 | 1 before | 2 after | 3 after | 4 before |
| --- | ---: | ---: | ---: | ---: |
| Edit | 284.54 | 199.98 | 153.54 | 153.66 |
| Locale list | 536.37 | 193.56 | 184.78 | 445.72 |

For this condition, both locale after runs met the 250 ms list target. Samples within 250 ms were 36/50 before and 48/50 after; no samples met the 100 ms edit target in either variant (0/50 each). The pooled edit p95 was lower, but p50 rose and the second block showed almost no p95 difference. Selection ready→translation ack p95 also rose. The results do not establish that every segment became consistently faster. These were independent sequential blocks without per-sample pairing, randomization, GC, or load control. Do not use this result as proof that the code change caused an improvement, subtract Node and browser clocks from each other, or add quantiles across segments.

Control RTT p95 changed from 4.80 to 4.72 ms for edits and from 4.01 to 4.89 ms for locales. Raw comparison covered 240 raw samples (200 measured and 40 warmup), 80 controls, and 78 timing summaries. Hashes for 39 files, including the comparison policy and runner, match the current dist and harness, and the only difference between variants is `schema.js`. All runs passed input-node, input-value, React-state, translated-DOM, and locale revert/delete checks; `.d.ts` mtime and size were also unchanged. Measured edits produced one-message patches and zero position updates; locale runs had zero responses before selection and one compact full response after selection. Temporary snapshots were cleaned up.

Raw sources: [edit comparison](../benchmarks/results/plain-contracts-edit-comparison-2026-10-10.json) and [locale comparison](../benchmarks/results/plain-contracts-locale-comparison-2026-10-10.json). Each comparison's `runs[].file` and each run's `results[].samplesFile` point to independent run results and raw samples in the same directory.

Reproduction commands:

```sh
node benchmarks/live-update/locale-compare.mjs --experiment plain-contracts --mode edit --baseline 4aacb93 --current 169e72b --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/plain-contracts-edit-comparison-2026-10-10.json
node benchmarks/live-update/locale-compare.mjs --experiment plain-contracts --mode locale-add --baseline 4aacb93 --current 169e72b --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/plain-contracts-locale-comparison-2026-10-10.json
```

On the remaining edit path, the after server's queueToDrain p50/p95 is 47.56/55.64 ms, readAndCandidate is 33.63/52.86 ms, and catalogDelta is 15.09/23.21 ms. The next step is to examine wait policy and unnecessary delta generation and application for already-current pairs across real request scopes, then choose improvement candidates.

## Follow-up: reducing patch allocations (2026-10-11 KST)

The baseline is `ed2bc8c` → `49b260f`. Current source hashes are `c9e96e12` for `catalog-patch.ts` and `2e034408` for `catalog-registry.ts`; dist hashes are `911c60fe` and `86938035`. The artifact values match the current files.

`createCatalogPatch` no longer allocates the `Object.entries` tuple array or a shift object per message, and calculates deltas with local variables. `remove` uses `for...in` and `Object.hasOwn` to exclude inherited messages, and the dense check reuses the already-computed `patch.messageCount`.

The micro benchmark alternated before and after on the same input and compared each pair with deepEqual. All 300 measured pairs plus 60 warmup pairs produced identical patch content. Table times are in milliseconds.

| Scenario | before p50 / p95 | after p50 / p95 | diff median |
| --- | ---: | ---: | ---: |
| sameLength | 14.19 / 16.69 | 10.00 / 12.61 | -3.96 |
| uniform | 14.73 / 22.39 | 10.09 / 15.67 | -4.53 |
| mixed | 11.24 / 16.16 | 7.66 / 10.75 | -3.50 |

The live run measured current alone for edits (10k-20-locales, 25 measured runs, 5 warmups, and 10 calibrations). Save→ack measured p50 131.71 ms and p95 161.53 ms. Wire results were 25 patches, 0 full responses, response size p50/p95 935 B (range 931–935 B), 1 changed message, and 0 position updates; DOM, state, typegen, and wire checks passed.

The output from two initially overlapping processes was discarded; only the final artifacts from separately rerunning each experiment are used as evidence. With no before browser comparison, the live result is a current-only measurement, and the paired micro comparison does not establish browser causation. The 100 ms edit target failed.

The parent passed 43 functional regression tests, the Vite typecheck, all 206 tests and all typechecks in the full check, and independent JS/TS pack validation. `49b260f` contains two source files, `test/patch.test.mjs`, `patch-compare.mjs`, and three result files.

Raw sources: [micro](../benchmarks/results/patch-allocations-2026-10-11.json), [live](../benchmarks/results/patch-allocations-live-2026-10-11.json), and [live raw](../benchmarks/results/patch-allocations-live-2026-10-11.10k-20-locales.samples.json).

Reproduction commands:

```sh
node benchmarks/live-update/patch-compare.mjs --baseline ed2bc8c --out benchmarks/results/patch-allocations-2026-10-11.json
node benchmarks/live-update/run.mjs --mode edit --scenario 10k-20-locales --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/patch-allocations-live-2026-10-11.json
```
