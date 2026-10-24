# 75. Early disk rechecks (`08b1d7c`, `eb66af8`)

## Scope

This records an attempt after [74](74-immutable-validation-reuse.md) to catch the second save within Vite watcher's short throttle window earlier than the trailing 60 ms recheck. The only product source change is `packages/vite/src/disk-rechecks.ts`; instrumentation is in `benchmarks/live-update/profile.mjs` and benchmark-only probes.

It verifies the contracts and passing tests of the two-stage product change, decomposition by enqueue origin, small and large ABBA comparisons in the same harness, and a single locale-list run. Performance conclusions are limited to these conditions; the work does not establish the full cause, memory behavior, or a release. Observations were made on 2026-10-11 (KST) with Node v24.18.0, Vite 8.3.2, headless Chromium, and React 19.3.0 in development mode.

## Code

### Instrumentation (`c184fcb`)

- `benchmarks/live-update/profile.mjs` wraps `DiskRechecks.verify` in a separate `AsyncLocalStorage` origin and records the caller origin and offset of `LiveRegistry.enqueue`. Actual trailing rechecks are labeled `disk-recheck`; reads originating outside are labeled `external-enqueue`.
- External enqueues are not guaranteed to accompany a real OS watcher event. Counting both paths in one bucket would misattribute tail latency, so this distinction is the basis for the tail assessment.
- The one probe `benchmarks/live-update/enqueue-origin.test.mjs` checks the external-enqueue origin and hasReader, the disk-recheck origin and hasReader, `offsetMs >= 0`, and no change to product dist hashes around instrumentation (parent run passed).

### Product (`08b1d7c` → `eb66af8`)

- `08b1d7c` adds an early 10 ms check before the existing 60 ms recheck. If it detects a change, it cancels both timers and enqueues; if the early check matches, the trailing recheck remains. Without a change, one extra stat runs and the parser runs only when content changed.
- `eb66af8` adds a 30 ms midpoint check, producing the current 10/30/60 stages. It retains the 60 ms guard even when 10 and 30 match, and any detected change cancels all three timers before enqueueing. Reset and stop also cancel all three.
- Stat duration and timer resolution mean the checks do not run at exactly 10, 30, and 60 ms. Public APIs, dependencies, and versions are unchanged. The only `packages/vite/package.json` change in `08b1d7c` adds `test/disk-rechecks.test.mjs` to the `test` script on one line.

## Validation

- `08b1d7c` passed its three timer mocks (`early change`, `change after early match`, and `reset and stop`) plus all 104 Vite tests, 4 benchmark tests, and the build.
- `eb66af8` passed 54 Vite plugin, server, and timer tests, including four timer unit tests (`early change`, `change after early match`, `change after middle match`, and `reset and stop`). Module hashes in comparison snapshots confirmed that only `dist/disk-rechecks.js` differed.
- All five real-watcher SSR rapid-recovery cases (`json-0-a`, `json-60`, `json-0-b`, `schema-0`, and `valid-0`) report `recovered: true`. The author of this document did not rerun the tests and is reporting the parent's results.

## Observed results

### Enqueue-origin breakdown (`c184fcb`)

- Among 25 enqueues in 25 detailed-instrumentation small samples (1k×3), 13 were disk-recheck and 12 were external-enqueue. SaveToAck ranges were 64.98–83.84 ms and 9.04–14.19 ms, respectively, showing that the slow tail is concentrated on actual rechecks.
- Under the same conditions, runtime-probe and tail records had p95 of 83.28 and 80.35 ms. These are detailed-instrumentation figures and do not replace the 108.61 ms normal-condition small result in [74](74-immutable-validation-reuse.md) as a performance determination.

### 10 ms standalone stage (`08b1d7c`)

- A fresh Vite and browser ABBA run (before/after/after/before) replacing only `disk-rechecks.ts` in the same harness had pooled p50 21.42→62.69 ms and p95 83.81→86.23 ms; all 50/50 samples in both variants were within 100 ms.
- Per-run p50 varied from 21.42 and 64.74 ms before to 66.55 and 62.69 ms after, while both variants still met the target. The 10 ms standalone stage has no evidence of improvement and was not adopted.

### Three-stage 30 ms addition (`eb66af8`)

- Under the same ABBA conditions (before `c184fcb`, after `eb66af8`), small pooled p50 was 19.43→17.61 ms and p95 was 82.05→49.57 ms. The two after runs had p95 of 45.97 and 50.16 ms, and both variants placed 50 of 50 samples within 100 ms.
- Large (10k×20) p95 changed from 85.60 ms before to 80.25 ms after; the two after runs had p95 of 80.25 and 76.30 ms. Of the 50 after samples, 49 were within 100 ms, with a maximum of 101.93 ms.
- Both sizes met the p95 target under these conditions. Per-run load variation in the large comparison prevents a causal conclusion.

### Single locale-list run (`eb66af8` product)

- The list p95 was 77.46 ms (maximum 100.57 ms) for small and 177.83 ms (maximum 374.94 ms) for large. These were single 25-sample runs, and both p95 values met the 250 ms target. Selection translation was p50/p95 18.60/28.98 ms for small and 158.90/227.98 ms for large.

## Interpretation and limitations

- The 10 ms standalone configuration showed no benefit under these conditions; the final configuration has 10, 30, and 60 ms stages. Adoption is based on small and large ABBA runs and the single locale-list run.
- The 60 ms guard remains even when 10 and 30 ms match, so a save arriving later is still caught by the trailing recheck. The cost of three stats and timer resolution were not measured.
- Large-run variation is high and the locale list was a single run, so this does not claim stable achievement. Memory, RSS, and release behavior are not covered.

## Source data and reproduction

- Origin breakdown: [origins](../benchmarks/results/validation-cache-small-origins-2026-10-11.json) and [samples](../benchmarks/results/validation-cache-small-origins-2026-10-11.1k-3-locales.samples.json).
- 10 ms stage: [small ABBA](../benchmarks/results/early-rechecks-small-comparison-2026-10-11.json) and [rapid recovery](../benchmarks/results/early-rechecks-rapid-recovery-2026-10-11.json).
- Three stages: [small ABBA](../benchmarks/results/midpoint-rechecks-small-comparison-2026-10-11.json), [large ABBA](../benchmarks/results/midpoint-rechecks-large-comparison-2026-10-11.json), [rapid recovery](../benchmarks/results/midpoint-rechecks-rapid-recovery-2026-10-11.json), and [locale add](../benchmarks/results/midpoint-rechecks-locale-add-2026-10-11.json).

```powershell
npm run build
node benchmarks/live-update/locale-compare.mjs --baseline c184fcb --current eb66af8 --experiment early-rechecks --mode edit --scenario 1k-3-locales --out benchmarks/results/midpoint-rechecks-small-comparison-current.json
node benchmarks/live-update/locale-compare.mjs --baseline c184fcb --current eb66af8 --experiment early-rechecks --mode edit --scenario 10k-20-locales --out benchmarks/results/midpoint-rechecks-large-comparison-current.json
```

## Status

Product source is in `08b1d7c` and `eb66af8`; public APIs, dependencies, and versions are unchanged. Comparison code and raw data are in `05b1fe6`; locale raw data is in `a763e80`; product commit `eb66af8` has not been pushed.
