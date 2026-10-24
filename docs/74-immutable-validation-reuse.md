# 74. Immutable-validation reuse (`5586bf2`)

## Scope

This records changing core `validateTranslation` after [73](73-thin-layer-runtime-cost.md) so it does not revalidate immutable schema and catalog pairs that already passed. The only product source change is `packages/core/src/schema.ts`.

This verifies the change's contracts, test status, and smoke measurements under current conditions. It does not claim long-term stability of the end-to-end goals, an architecture replacement, or completion of remaining work. Observations were made on 2026-10-11 (KST) with Node v24.18.0, Vite 8.3.2, and headless Chromium.

## Code

- It adds `validatedCatalogs = new WeakMap<CatalogSchema, WeakSet<ParsedCatalog>>()`. At the start of `validateTranslation`, it returns immediately only when both `isDeepFrozen(base)` and `isDeepFrozen(translation)` are true and that identity pair was previously accepted.
- A pair is recorded only after full validation succeeds. Mutable and shallow-frozen inputs are not cached and are checked every time; a new immutable identity is checked first and recorded only on success. The existing per-argument `validatedArguments` WeakMap remains. Weak references do not retain snapshots.
- The public API, dependencies, and versions are unchanged. The change and tests are in local commit `5586bf2` (not pushed).

## Validation

The parent ran 256 passing tests: core 82, Vite 101, typegen 9 (192 total), plus 64 thin-layer contract cases. The core build and consumer typecheck also pass. The author of this document did not rerun the tests.

## Observed results

### Isolated runtime cost

The same probe as [73](73-thin-layer-runtime-cost.md) ran again on `5586bf2`. Eight children times 38 commits produced 304 commits, and each worker validates eight old snapshots, for 64 total.

| key | variant | commit p50 from 73→74 | commit p95 from 73→74 | steady heap | retained heap |
| --- | --- | --- | --- | --- | --- |
| 1k | core | 1.48→1.51ms | 2.25→2.41ms | 0.48MB | 0.52~0.55MB |
| 1k | layer | 4.18→3.43ms | 6.20→5.17ms | 0.79~0.80MB | 1.01MB |
| 10k | core | 13.01→14.55ms | 16.46→23.49ms | 2.19MB | 4.35~4.57MB |
| 10k | layer | 30.43→23.23ms | 40.50→34.24ms | 1.49~1.52MB | 7.70~7.72MB |

- The two raw results were taken at different times and are not a paired same-time ABBA comparison. At 10k, core p95 rose from 16.46 to 23.49 ms while layer fell from 40.50 to 34.24 ms. The result does not support the conclusion that everything got faster. Heap deltas are within a range similar to 73, with the same direction by size.

### CPU samples (`ad7b55e`)

- Sampling was 1 ms per full worker and includes imports, fixture parsing, constructor warmup, copy/freeze, refresh, assertions, retained snapshots, GC, and idle time. Counts and timeDelta are not exact function CPU time.
- Among 1454 core samples, `validateTranslation` has self 270 (18.6%) and inclusive 274; among 2205 layer samples, it has self 522 (23.7%) and inclusive 529. These are reference samples, not causal or CPU-time attribution.
- The profile's `packages/core/dist/schema.js` hash is the pre-change baseline file.

### End-to-end smoke tests

- Two runs of 25 large-edit samples (10k×20 locales, one key) produced saveToAck p95 of 70.35 and 61.91 ms, with pooled p95 66.16 ms and 49 of 50 samples within 100 ms (first-run maximum 100.54 ms).
- The 25 small-edit samples (1k×3) had p95 108.61 ms and failed to meet the 100 ms target (23/25). The two slow samples were 108.61 and 183.96 ms, with receiveToCommit 3.8 and 3.6 ms, queueToDrain 16.04 and 19.56 ms, and candidate intervals 28.23 and 107.97 ms. The cause is not established.
- Timing uses Node `performance.now` from file-write resolution through receipt of the DOM-commit acknowledgement body. It includes HTTP acknowledgement cost; control round trips are reported separately and are not added to or subtracted from stage p95.
- The edit fixture checks input-node identity and value, React component state, exact DOM text, and wire receipt. It does not check all focus, caret, or modal behavior.
- The locale-add small list (1k×3) had p95 84.29 ms (25/25 within 250 ms), and selectToTranslationAck p95 was 32.33 ms. The large list (10k×20) had 137.09 ms (24/25) in run 1 and 159.75 ms (25/25) in run 2; pooled p95 across 50 samples was 159.75 ms, with 49 of 50 within 250 ms. Large selectToTranslationAck p95 was 267.80 and 262.38 ms, separate from the list figures.

## Interpretation and limitations

- Reuse applies only to deeply frozen identity pairs. New identities, mutable inputs, and shallow inputs are rechecked through the existing path.
- Passing validation is the gate for this change, and the figures above are measurements under limited conditions. Because small edits fail to meet the target, this does not claim full or stable achievement of the edit goal.
- The isolated runtime raw data and 73 are not a paired same-time comparison, and the CPU samples are reference data for the pre-change source.
- All 152 `codeHashes` across four follow-up browser raw results (37, 37, 39, and 39), 12 in the after-runtime raw result, and 13 in the lazy-contracts raw result matched current files.

## Source data and reproduction

- Isolated runtime cost: [thin-layer-runtime-cost-validation-cache-2026-10-11.json](../benchmarks/results/thin-layer-runtime-cost-validation-cache-2026-10-11.json)
- CPU samples: [thin-layer-runtime-cpu-2026-10-11.json](../benchmarks/results/thin-layer-runtime-cpu-2026-10-11.json) (includes core and layer cpuprofiles)
- Edits: [large](../benchmarks/results/validation-cache-edit-large-2026-10-11.json), [large-repeat](../benchmarks/results/validation-cache-edit-large-repeat-2026-10-11.json), and [small](../benchmarks/results/validation-cache-edit-small-2026-10-11.json). Locales: [add](../benchmarks/results/validation-cache-locale-add-2026-10-11.json) and [add-large-repeat](../benchmarks/results/validation-cache-locale-add-large-repeat-2026-10-11.json).
- Both large-edit raw results record `gitRevision` `ad7b55e` (the then-current HEAD with a working tree being modified for `schema.ts`), and their `schema.js` hash equals the file at `5586bf2`. The small edit and large locale repeat record `c5bfabc`; the first locale measurement records `5586bf2`. The measured product code is the same.

```powershell
npm run build
node benchmarks/live-update/run.mjs --mode edit --scenario 10k-20-locales --samples 25 --calibrations 10 --out benchmarks/results/validation-cache-edit-large-repeat-2026-10-11.json
node benchmarks/live-update/run.mjs --mode locale-add --scenario 10k-20-locales --samples 25 --calibrations 10 --out benchmarks/results/validation-cache-locale-add-large-repeat-2026-10-11.json
node benchmarks/thin-layer/runtime-cost-probe.mjs --iterations 30 --out benchmarks/results/thin-layer-runtime-cost-validation-cache-2026-10-11.json
```

## Status

The product source change is in `5586bf2`; public APIs, dependencies, and versions are unchanged. CPU raw data is in `ad7b55e`; after-runtime and lazy-contract raw data are in `5586bf2`; repeat, locale, and small raw data are in `9093d46`. None has been pushed or reflected remotely.

The following early disk-recheck attempt and adoption of the 30 ms addition are covered in [75-early-disk-rechecks.md](75-early-disk-rechecks.md).
