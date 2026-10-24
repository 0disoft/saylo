# 83. Push-subscription lifetime and locale re-addition validation

This is a local validation record for push-subscription maintenance and benchmark results verified on `main` at `19640b9` on 2026-10-24. The product fix is `a9e8b80`; the benchmark instrumentation fix is `19640b9`. `19640b9` did not change product behavior and corrected receipt and server batch boundaries.

The execution evidence and hashes of eight raw-result files are collected in the [maintenance follow-up record at `59ea8dd`](../review/maintenance-followup-2026-10-24.json).

## Reproduction path and cause

The issue reproduced in this order:

1. Use the target locale, return to the original locale, and delete all namespace files for the target locale.
2. After the target locale's pairs are evicted from cache, add the same locale again.
3. Before the new pair is selected, the old server scope remains, so a large full-catalog push arrives.
4. When the benchmark counted only request receipts, it did not record this push as a pre-selection transfer. The pre-selection response therefore appeared falsely as zero, making validation incomplete.

The cause was that manifest updates removed evicted cache entries without resending server subscription scope. The server kept the old subscription until scope was explicitly replaced.

## Product fix

`a9e8b80` computes evicted pairs in [catalog-source.ts](../packages/vite/src/catalog-source.ts) and calls `sendScope()` immediately after removing them from cache. Connected push clients receive the reduced subscription scope. Recreating the same locale no longer sends a full push before selection; a fresh full request is made once when the user selects it.

A regression test for this path was added to [push.test.mjs](../packages/vite/test/push.test.mjs). After removing a locale and two namespace pairs, the new test verifies:

- Evicted pairs are removed from server scope.
- Recreating the locale produces no pre-selection push for it.
- Keeping the original locale and selecting the new locale produces exactly one request and reads the new translation.

The new test failed before the fix and passed after it.

## Validation scope

- All 62 tests passed across eight files covering push, lazy, sync-state, receipts, and profiles.
- `npm run build` passed on root source before the fix, and `npm run build --workspace=@0disoft/saylo-vite` passed after it.
- The full 536-check suite was not rerun, and no new candidate freeze, pack or tarball or registry consumption, or deployment was performed.

The 62 tests verify this fix path and instrumentation changes. They are not evidence for the full suite or acceptance of a new candidate.

## Benchmark instrumentation correction

The benchmark changes in `19640b9` corrected receive paths and batch boundaries before producing performance figures.

- Edit and locale-add receipts recognize both request `saylo:catalog` and push `saylo:catalog-push`.
- Pre-selection pushes are counted as locale-add transfers, so the earlier false zero-count pass is not reproduced.
- Server stages use `boundaryVersion: 3`, starting at actual `startBatch` entry instead of a drain timer and ending at `prepareTranslations` or `processBatch` settlement for superseded and error batches.
- The browser stage transform instruments the current product module's `immutableSnapshot` boundary.

These changes are benchmark-only and are not evidence of product performance improvement.

## Final 50-run results

The run used 5 warmups, 50 samples, and 25 calibrations with detailed CPU, browser, reply, and client instrumentation disabled. Both sizes had `pushReplies` 50, `requestReplies` 0, and `patchReplies` 50, editing one key at a time. Edits preserved input, nodes, and state and did not rewrite the generated `.d.ts`. Locale-add had zero pre-selection transfers at both sizes, 50 full responses after selection, and no declaration rewrite.

| Mode and size | Metric | p50 | p95 | Target | Result |
| --- | --- | ---: | ---: | ---: | --- |
| edit small (1k×3) | save→DOM ack | 22.60 ms | 53.12 ms | 100 ms | Passed |
| edit large (10k×20) | save→DOM ack | 400.00 ms | 866.01 ms | 100 ms | Failed to meet target |
| locale-add small (1k×3) | save→list ack | 56.44 ms | 282.33 ms | 250 ms | Failed to meet target |
| locale-add large (10k×20) | save→list ack | 227.13 ms | 1,969.58 ms | 250 ms | Failed to meet target |
| locale-add large (10k×20) | select→DOM commit | 531.80 ms | 795.60 ms | — | Recorded separately from performance targets |

Transfer and preservation contracts passed, but only edit-small passed among the four performance targets. Locale-add p95 exceeded the 250 ms target for both small and large; large p50, 227.13 ms, was within the target.

Locale-add file-write p95 was 568.74 ms for small and 403.51 ms for large. Wall time includes file I/O, scheduling, and machine load and is highly variable, so these values are not compared directly with earlier or detailed 10-run results to claim optimization or regression effects.

## Detailed 10-run diagnostic

This is a separate 10-sample diagnostic run for large locale-add with server file stages and boundary v3 enabled. It used 2 warmups and 10 calibrations and is not the same execution as the final 50-run performance result.

| Stage | p50 | p95 |
| --- | ---: | ---: |
| `queueToDrainMs` | 4.63ms | 18.52ms |
| `readAndCandidateMs` | 105.01ms | 356.17ms |
| `pathCheckMs` | 0.97ms | 4.81ms |
| `fileReadMs` | 1.50ms | 6.22ms |
| `catalogParseMs` | 96.03ms | 353.28ms |
| `candidateOtherMs` | 1.25ms | 39.65ms |
| `translationPreparationMs` | 12.14ms | 66.50ms |
| `validationMs` | 0.03ms | 0.04ms |

Most of `readAndCandidateMs` in this sample was recorded as `catalogParseMs`. This is a single run with instrumentation overhead and high wall-time variation in file stages. Parsing is not established as the cause, and no optimization or regression effect is claimed. Candidate and queue values under v3 are not compared directly with v2 or earlier.

## Candidate and release boundaries

- `.release/candidate-0.1.0-alpha.5-fTJYGI` is an earlier frozen candidate and validation record for product source `d3e5252`. It remains valid for that frozen input but does not include product fix `a9e8b80`.
- Current `main` package manifests remain at `0.1.0-alpha.4` for all five public packages and Vue; Vue is `private: true`. No version promotion was performed.
- No git push, npm publish, or workflow run was performed. There was also no new candidate freeze, full suite, pack, framework browser consumer acceptance for a new candidate tarball, or registry consumer acceptance.
- Deploying current source requires freezing a new candidate that includes the eviction fix and passing full validation again.

The initial locale run was insufficient because it did not count pushes as pre-selection transfers. `.release/maintenance-locale-add-before-fix-2026-10-24.json` is retained only and is not used as a valid historical result or before/after performance comparison.

## Raw results

- Edit: [summary JSON](../benchmarks/results/maintenance-edit-2026-10-24.json), [small samples](../benchmarks/results/maintenance-edit-2026-10-24.1k-3-locales.samples.json), and [large samples](../benchmarks/results/maintenance-edit-2026-10-24.10k-20-locales.samples.json).
- Locale-add: [summary JSON](../benchmarks/results/maintenance-locale-add-2026-10-24.json), [small samples](../benchmarks/results/maintenance-locale-add-2026-10-24.1k-3-locales.samples.json), and [large samples](../benchmarks/results/maintenance-locale-add-2026-10-24.10k-20-locales.samples.json).
- Detailed locale stages: [summary JSON](../benchmarks/results/maintenance-locale-stages-2026-10-24.json) and [large samples](../benchmarks/results/maintenance-locale-stages-2026-10-24.10k-20-locales.samples.json).

The new 50-run edit and locale-add results were measured with the `19640b9` harness. Edit figures from earlier runs are not mixed into current results. Historical performance values in [75](75-early-disk-rechecks.md) remain unchanged.
