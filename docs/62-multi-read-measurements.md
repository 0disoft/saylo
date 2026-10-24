# 62. Multi-read stage instrumentation and batch ownership

## Background

`c19ca34` and [61](61-superseded-parse-reuse.md) addressed reads occurring twice on a new-catalog path. The v1 instrumentation, however, overwrote the owning batch for the `this.running` callback and `prepareTranslations` with the values at the start of each drain. When a second drain started, callbacks from the first batch were mixed into the new batch's window, and the single-path, one-read, one-parse assertion stopped because there were two reads.

This fix is benchmark-only. Product source remains `c19ca34`; commit `a0e47d5` changes only the profile, run, and server-file-profile code under `benchmarks/live-update` and their tests. Shipped package and dist code did not change, and no clock was introduced.

## v2 instrumentation

- `AsyncLocalStorage` binds each drain's `this.running` callback and `prepareTranslations` to its own batch. A window opened by one drain contains only that batch's callbacks.
- A batch window runs from drain start to that batch's `prepareTranslations`. A window ending with a superseded or error result extends until the running promise settles.
- Overlapping wait windows are unioned to produce `readAndCandidateMs`. Each file metric is likewise the union of completed operation intervals.
- `candidateOther` is the length of the parent union minus every file-operation union.

## Batch boundary definitions

| Boundary | Start | End |
| --- | --- | --- |
| queue | Update event arrival | Drain start |
| running | Drain start | That batch's `prepareTranslations` |
| superseded or error | Drain start | Running-promise settlement |

## Child recording rules

- A child outside its parent, with no operations, with unfinished operations, with a count mismatch, or without a successful parse is recorded as an error.
- Multiple path checks, reads, and parses, along with retries for a failed path, are allowed. The record retains them as observed.
- `queueToDrainMs` is the queue wait for the first batch. Each wait is stored separately as the raw `drainWaitMs` value.
- `boundaryVersion` 2 is recorded in summaries and samples.
- Because of the union calculation, these values are not directly comparable with v1 candidate and queue values.

## Validation

- All three `server-file-profile.test` tests and both `runtime-profile.test` tests passed.
- Two serial superseded reads ran successfully. Both runs had 1 publication, 2 parent windows, and operations 2/2/2, passed interval-partition validation, and left dist hashes unchanged.

## Measurements from this run

Detailed instrumentation and the runtime observer's 10 ms timer were enabled, with typegen on, 25 samples, 5 warmups, and 10 controls.

| Metric | p50 | p95 | Maximum |
| --- | --- | --- | --- |
| List propagation | 97.87 ms | 115.88 ms | 265.87 ms |
| Candidate stage | 62.64 ms | 78.92 ms | 226.87 ms |
| Parser stage | 59.95 ms | 70.32 ms | 212.93 ms |

- The list was within 250 ms in 24 of 25 samples; one sample reached 265.87 ms.
- Three of 25 measured samples read twice. Each had two path checks, reads, and parses, and the second parse had `hasPrevious: true`. The second parse stages for those samples were 0.2549 ms, 0.1291 ms, and 0.1360 ms.
- The runtime parser observed zero GC events and zero observer overlap; the maximum late timer was 204.64 ms.
- The longest sample had a 265.87 ms list time and a 212.93 ms parser clock.

## Interpretation limits

- Zero observed GC events does not prove that GC is impossible.
- Timer lateness includes synchronous JavaScript, GC, JIT, and OS delay, so it does not identify a cause.
- This run used detailed instrumentation. No 115 ms improvement or stable achievement under normal conditions is claimed.
- The normal-condition records in [61](61-superseded-parse-reuse.md) (small p95 279.47 ms and large p95 247.25 ms) are retained as historical values.

## Record verification

- Interval partitioning passed for all 30 samples, including the 5 warmups.
- The result files were checked for code-hash fingerprints, summaries, all 30 candidate and file intervals, child containment, and remainder calculations.

## Reproduction

```sh
node benchmarks/live-update/run.mjs --scenario 10k-20-locales --mode locale-add --samples 25 --warmup 5 --calibrations 10 --server-file-stages --runtime-stages --out benchmarks/results/multi-read-stages-2026-10-11.json
```

The raw results are in the [summary](../benchmarks/results/multi-read-stages-2026-10-11.json) and [samples](../benchmarks/results/multi-read-stages-2026-10-11.10k-20-locales.samples.json).

## Remaining goals

Remaining work includes the performance-stability goal, decisions on the provisional owned-map and fast-additions changes, full thin-layer evaluation across contracts, lazy loading, SSR, production, time zones, and performance, and the release decision. This run closes one multi-read instrumentation item; it does not complete the whole effort. The public API, dependencies, and versions are unchanged, with no push or publication.
