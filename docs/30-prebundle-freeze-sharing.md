# 30. Sharing the Vite/core deep-freeze path in the development prebundle

In [29](29-prebundle-client-stages.md), the same Vite-frozen catalog reference reached core acceptance in 50/50 runs, but core deep-freeze trust was present in 0/50. Core freeze trust lives in a module-local WeakSet and is not shared when the development core root prebundle and the `/runtime` subpath resolve to different graphs. I changed one line so Vite `freeze.ts` imports the existing `freezeCatalogs` from the core root instead of `/runtime`.

## Implementation

- In `packages/vite/src/freeze.ts`, change the `freezeCatalogs` import from `@0disoft/saylo-core/runtime` to `@0disoft/saylo-core`. The root already exports the same function.
- Because other core imports in the development app use the root, Vite now shares the freeze cache with the same prebundled module.
- Deep-freeze trust continues to use the existing module-local WeakSet. Externally shallow-frozen objects are still traversed all the way through.

## Scope

- The confirmed fact is that deep-freeze cache is shared in normal prebundling for a development app that imports core root (sameCatalog 50/50, trusted 50/50).
- I did not separately measure development apps that use `/runtime` only or user optimizer `exclude`/`alias` settings. I did not dump the full bundle graph to compare module identities.

## Run

```sh
node benchmarks/live-update/run.mjs --mode locale-add --reply-stages --client-stages --scenario 10k-20-locales --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/prebundle-freeze-shared.json
```

This ran on 2026-10-07 KST from the worktree containing the revision `6ee51ff` change, with measuredAt `2026-10-07T13:22:54.610Z`, default prebundle and typegen enabled, 5 warmups, 50 measured runs, and 25 controls. The implementation was committed in `3da29d4`. The 50-run nearest-rank p95 is the 48th sorted value.

## Results

Times are in ms and remainders are calculated per sample before summarization. Nested p95 values are not added.

| Interval | p50 | p95 |
| --- | ---: | ---: |
| decode | 7.70 | 11.60 |
| Vite freeze | 75.20 | 92.80 |
| core acceptFreeze | 0.00 | 0.00 |
| snapshot | 20.00 | 23.00 |
| receiveToPublish | 102.70 | 126.30 |
| publishToCommit | 1.20 | 1.40 |
| receiveToCommit | 103.90 | 127.60 |
| Selection → commit | 190.00 | 449.70 |
| List render | 205.53 | 479.11 |
| Per-sample combined freeze (Vite freeze + core acceptFreeze) | 75.20 | 92.80 |

- Trust: sameCatalog 50/50, trusted 50/50, a change from trusted 0/50 in [29](29-prebundle-client-stages.md).
- Core acceptFreeze was 0.00/0.00 ms, with a maximum of 0.10 ms and 2 nonzero samples. Zero does not mean no work occurred; it means no difference was measurable at the browser clock's resolution.
- List rendering finished within 250 ms in 37/50 runs. Typegen remained enabled, input state and DOM were preserved, and there was no reload.
- Compared with the run in [29](29-prebundle-client-stages.md), core freezing was observed at 83.60/281.90 → 0/0 ms and per-sample combined freezing at 175.80/570.10 → 75.20/92.80 ms. These values come from different runs.

## Interpretation and limitations

- Because this compares separate runs, I do not establish the entire reduction as a causal improvement from this change. The verified fact is that duplicate deep traversal of trusted catalogs disappeared in the development prebundle.
- This was a single-machine warm run with normal prebundling. Function wall time includes pauses and probe overhead; GC was not separately observed. Node and browser clocks are not mixed.
- Per-sample comparisons are in [prebundle-freeze-comparison.json](../benchmarks/results/prebundle-freeze-comparison.json).
- Next is a 50-run small/large end-to-end remeasurement with detailed instrumentation disabled.

## Validation

- `npm run build` (workspace Vite) and the workspace Vite consumer typecheck passed.
- Forty-three Vite client, lazy, patch, and production tests plus 14 harness tests, 57 total, passed.
- Parser removal from the production runtime is preserved. The fixture's uncompressed JS total changed from 169,275 to 118,204 B; external FormatJS string consumption retains the parser, and lazy-chunk, fallback, and error tests passed.
- Three smoke runs exited 0: [shared-smoke](../benchmarks/results/prebundle-freeze-shared-smoke.json), [edit-smoke](../benchmarks/results/prebundle-freeze-edit-smoke.json), and [disabled-smoke](../benchmarks/results/prebundle-freeze-disabled-smoke.json).
- I did not repeat the full `check`, `pack`, or release checks for all four packages.
- I reconciled raw samples, summaries, remainders, call counts, wire data, and hashes. Compared with run 29, only one measurement-code hash changed, in `packages/vite/dist/freeze.js`. No temporary fixture or benchmark browser remained.
- Artifacts: [summary](../benchmarks/results/prebundle-freeze-shared.json), [raw samples](../benchmarks/results/prebundle-freeze-shared.10k-20-locales.samples.json). No version bump, push, publish, or deploy was performed.
