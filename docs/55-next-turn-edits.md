# 55. Next-turn edit merging

This document records the Vite `live-registry.ts` optimization in local commit `29970fc` and the comparison harness extension in `2aa5f7d`. It merges guarded readers passed by Vite for ordinary `update` events on the next timer turn. The edit p95 improved in a real Vite and browser ABBA comparison, but still failed to meet the 100 ms target.

## Implementation scope (packages/vite/src/live-registry.ts)

- Reads with a `read` callback (the guarded reader supplied by Vite `update`) drain on the next timer turn (`0 ms`) without waiting.
- If any entry without `read` is mixed into the queue (disk `add` or `unlink`, or a requeue from an earlier attempt), the existing 40 ms quiet window still applies.
- If a reader arrives later for the same path, the disk stabilization flag remains set until the batch finishes.
- `drain` resets the flag together with the queue, waiters, and `firstQueued`; the `MAX_WAIT_MS` cap of 200 remains unchanged.

Disk stabilization still waits 40 ms, while ordinary edits are handled on the next timer turn. The harness now rebuilds only packages that contain policy sources in the snapshot and adds the `fast-edits` policy (`live-registry.ts`).

## Measurements

Units are milliseconds. The edit scenario uses 10k messages by 20 locales with 25 measured runs, 5 warmups, and 10 controls in before/after/after/before order.

| Metric (pooled 50) | before | after |
| --- | ---: | ---: |
| Save→DOM ack p50 / p95 | 125.10 / 140.13 | 78.26 / 107.49 |
| Samples within 100 ms | 0/50 | 44/50 |
| queueToDrain p50 / p95 | 46.25 / 54.74 | 2.67 / 3.82 |

| ABBA run p95 | 1 before | 2 after | 3 after | 4 before |
| --- | ---: | ---: | ---: | ---: |
| Save→ack | 140.26 | 107.49 | 101.75 | 134.60 |
| control RTT | 5.62 | 3.33 | 3.86 | 5.26 |

## Interpretation and limitations

- The runs were sequential and independent, with no sample pairing, randomization, forced GC, or load control. They do not establish causality.
- Control RTT p95 also fell, so the run does not separate the change's effect from runtime and measurement-condition differences. Paint timing was not observed.
- Node and browser clocks are not subtracted from each other, and segment quantiles are not added together.
- The 100 ms edit goal remains unmet, and the overall goal is not complete.

## Validation

- All 37 feature tests passed: 35 Vite plugin tests and 2 server tests, along with the Vite consumer typecheck.
- The one comparison-policy test passed.
- The 1k locale-add smoke passed once before and once after. Smoke output went to a temporary directory and was cleaned up; it is not performance evidence.
- Recalculation from the raw samples verified 36 summaries and 37 file hashes. The only variant difference was the `live-registry.js` file in dist. The temporary snapshot was cleaned up.

## Source data and reproduction

In the [comparison summary](../benchmarks/results/fast-edits-comparison-2026-10-11.json), each `runs[].file` points to one of the four run results and each `results[].samplesFile` points to its raw samples.

```sh
node benchmarks/live-update/locale-compare.mjs --experiment fast-edits --mode edit --baseline 95eb41b --current 29970fc --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/fast-edits-comparison-2026-10-11.json
node benchmarks/live-update/locale-compare.mjs --experiment fast-edits --mode locale-add --smoke --baseline 95eb41b --current 29970fc
```

## Status

The changes are in local commits `29970fc` and `2aa5f7d` and have not been pushed. No version bump, publication, or deployment was performed.

## Missing-file rechecks and follow-up standalone measurements

`2aea993` requeues a deletion for disk stabilization instead of publishing it immediately when a reader returns `ENOENT`. It keeps the 40 ms flag even when a newer reader is already queued. All 90 Vite tests, including the two regression cases and existing tests, passed along with the Vite consumer typecheck.

The [follow-up standalone measurement](../benchmarks/results/guarded-edit-current-2026-10-11.json) ran 25 measured samples, 5 warmups, and 10 controls against product source containing that fix. Save→ack p50/p95 was 163.30/252.95 ms, with 2 of 25 samples within 100 ms. Every measured response used a single-message patch, and the input, state, and typegen preservation checks passed. The longest sample showed two events and three drains; file-write p95 was 60.71 ms. With no before-change control or GC and load control, the run does not establish that the fix caused the latency. This result is retained alongside the earlier ABBA result, and the performance goal remains unmet.
