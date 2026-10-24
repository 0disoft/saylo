# 37. Isolated locale-add comparison before and after sharing the seal

## Purpose

After [35](35-shared-ast-seal.md) moved the `seal` helper inside `freezeMessageAst` to module scope, the large remeasurement with detailed instrumentation OFF in [36](36-shared-ast-seal-locale-add.md) observed list-render p95 increase to 767.54 ms. Because 36 was a single run at a different time, it could not establish whether this change was a benefit or a regression from moving `seal` to module scope. This comparison ran the baseline `cbd6871` and the shared-helper experiment `4f6b5cd` sequentially as isolated snapshots at close times and under identical conditions to determine whether sharing `seal` benefits end-to-end locale addition. I added the comparison tool `benchmarks/live-update/locale-compare.mjs`.

## Run

```sh
node benchmarks/live-update/locale-compare.mjs --baseline cbd6871 --current 4f6b5cd --out benchmarks/results/locale-add-seal-comparison.json
```

The final tool defaults to `--baseline cbd6871`, `--current 28d7fe5`, `--samples 25`, `--warmup 5`, and `--calibrations 10`. `28d7fe5` and the measured `4f6b5cd` have the same product source. The reproduction commands above specify the measured refs. The product was reverted after this comparison, so the current core source is `cbd6871`, and `4f6b5cd` is the earlier experiment ref. This ran on 2026-10-08 KST under Node 24.18.0 on Windows x64 with a Ryzen 5 7430U and Vite 8.3.2.

- The order was before/after/after/before (AB/BA blocks), with a fresh Vite process, browser, and temporary fixture for each run.
- Each run used one large scenario (10k × 20, one namespace) with 25 measured runs, 5 warmups, and 10 controls. Across four runs there were 120 raw runs, 100 measured, and 40 controls.
- Detailed CPU profile, browser, server-file, reply, and client measurements were all OFF; the default prebundle and typegen were ON; `declarationRewritten` was false.
- Each iteration added one en-GB file with 10,000 messages. Initial catalogs comprised 20 files and 7,755,280 B; the added catalog was 387,783 B. Each run result records the serialized JSON size of the compact full response; this is not actual network bytes.

## Conditions and boundaries

- The tool checks that the `packages` diff between the two refs contains only `packages/core/src/diagnostics.ts` and that the checkout's packages worktree is clean.
- It creates before/after snapshots under `benchmarks/.live-update-compare-*/`. It copies `package.json` and `package-lock.json`, shares external dependency node_modules through junctions, and points `@0disoft/saylo-*` aliases at each snapshot's packages. It copies core `src` and `tsconfig.json`, replaces `diagnostics.ts` with each ref's version, builds with the same tsc, and copies the harness mjs, jsx, and html files. The original checkout's product source and dist are therefore unchanged, and the two snapshots differ only in `diagnostics.ts`.
- The tool checks that 36 common codeHashes are equal within the before runs and that only `packages/core/dist/diagnostics.js` differs within the after runs. It includes a guard so the two snapshots can be recreated even after the checkout returns to an explicit historical ref, and I confirmed that the same command works again after reversion. The collector `run.mjs` code was unchanged.
- Pooling uses the 50 measured raw values per variant and summarizes them with nearest-rank quantiles. It is not the average of run p95 values. It excludes 10 warmups and summarizes 20 controls separately.
- Save → list/translation ack spans from completion of the Node file write through receipt of the ack and includes ack delivery. Browser selection → commit spans from immediately before `setLocale` through the `useLayoutEffect` that verifies the translated DOM. I do not subtract process clocks, deduct GC/control, or add nested p95 values.
- This was not a per-sample paired comparison or randomized assignment; it used a fixed order on one machine and did not control GC or load, so it is not causal proof. The snapshot structure and default prebundle differ in paths and module locations from a normal checkout, so I do not compare performance directly with 767.54 ms in 36.
- The `gitRevision` in the four run result JSON files points to the parent harness checkout `4f6b5cd`. The measured targets are identified by `snapshotSourceRevision` and `snapshotVariant`: before is `cbd6871`, after is `4f6b5cd`.

## Results

Units are ms, based on 50 pooled measured samples.

| Metric | before p50 | before p95 | after p50 | after p95 |
| --- | --- | --- | --- | --- |
| List saveToListAck | 208.81 | 547.74 | 252.49 | 682.94 |
| Node selection preparation → translation ack | 185.81 | 320.33 | 216.18 | 296.96 |
| Node save → translation ack | 396.51 | 818.26 | 477.54 | 901.37 |
| Browser selection → commit | 183.00 | 236.40 | 212.60 | 293.50 |
| Node save → broadcast | 190.58 | 516.74 | 233.94 | 665.45 |
| fileWrite | 11.08 | 17.10 | 12.14 | 18.66 |
| control | 4.04 | 5.98 | 3.73 | 5.60 |

List rendering met the 250 ms target in 38/50 before runs and 23/50 after runs. Both variants failed to meet the 250 ms list target.

Per-run list-render values were:

| run | variant | measured time (UTC) | list p50 | list p95 |
| --- | --- | --- | --- | --- |
| 1 | before | 2026-10-08T10:54:27Z | 217.52 | 595.13 |
| 2 | after | 2026-10-08T10:55:07Z | 252.89 | 682.94 |
| 3 | after | 2026-10-08T10:55:49Z | 246.72 | 543.92 |
| 4 | before | 2026-10-08T10:56:27Z | 199.75 | 524.96 |

In both blocks, after list p50 and p95 were larger than before. Pooled list results pointed in the same direction. Browser selection → commit p95 was larger after (236.40 → 293.50 ms), while Node selection-preparation → translation-ack p95 was larger before (320.33 → 296.96 ms), so individual metrics disagreed.

## Interpretation and decision

I did not confirm a benefit from sharing `seal` in list rendering, and after list p50 and p95 were observed larger in both blocks. Metrics disagreed, and the comparison was not paired per sample, so I do not establish a causal code regression. The evidence was insufficient to keep it as a performance optimization, so I reverted the product change from 35 that shared `seal`. `seal` in `packages/core/src/diagnostics.ts` is again a function inside `freezeMessageAst`, and the core product source is at `cbd6871`.

The pooled before list p95 of 547.74 ms is an isolated comparison value for the reverted change, not the latest p95 from a normal single run. It also cannot be compared directly with the single after value of 767.54 ms in 36 because conditions, snapshots, and run shape differ.

## Validation

The added tool's `--smoke` mode ran one small (1k-3-locales) before and after run plus one control, and verified different diagnostic hashes for the two refs, preservation of input form state and `.d.ts` files, and temporary-fixture cleanup. The four main runs verified that the tool detected instrumentation OFF, typegen ON, `declarationRewritten` false, zero responses before selection and one `saylo-catalog-v1` compact full response after selection, per-sample Node boundary inequalities, recomputed summaries, codeHash difference rules, and temporary-snapshot cleanup.

After reversion, the core build, 75 core tests, and consumer JS/TS typechecks passed, and the final core `diagnostics` dist SHA matches before in this comparison. I independently reconciled sample counts, token uniqueness, warmup position, options, Node timing boundaries, summaries, pooling, frame bytes, wire JSON byte summaries, and 36 common hashes (with only `packages/core/dist/diagnostics.js` differing by variant), plus temporary-snapshot cleanup, across 120 raw runs, 100 pooled measured samples, and 40 controls. I completed the product reversion in commit `d408500`; after reversion, `node benchmarks/live-update/locale-compare.mjs --baseline cbd6871 --current 4f6b5cd --smoke` passed with one small sample each for before and after, confirming support for reproducing an older product scope. I do not use that smoke result for performance claims. `node --check` also passed. I did not rerun full-workspace checks, pack, or release checks; no public API, version, push, publish, or deploy changed.

I reconciled the pooled and per-run documentation tables with the result JSON. All 171 local links in the five changed Markdown files, code fences, the 40 KB limit, and `git diff --check` passed.

## Next work

Large still fails to meet the list target, and neither variant met it, so structural bottleneck work is needed. This comparison does not determine the next optimization candidate.

## Links

- [Pooled comparison](../benchmarks/results/locale-add-seal-comparison.json)
- [1 before summary](../benchmarks/results/locale-add-seal-comparison.1-before.json), [samples](../benchmarks/results/locale-add-seal-comparison.1-before.10k-20-locales.samples.json)
- [2 after summary](../benchmarks/results/locale-add-seal-comparison.2-after.json), [samples](../benchmarks/results/locale-add-seal-comparison.2-after.10k-20-locales.samples.json)
- [3 after summary](../benchmarks/results/locale-add-seal-comparison.3-after.json), [samples](../benchmarks/results/locale-add-seal-comparison.3-after.10k-20-locales.samples.json)
- [4 before summary](../benchmarks/results/locale-add-seal-comparison.4-before.json), [samples](../benchmarks/results/locale-add-seal-comparison.4-before.10k-20-locales.samples.json)

Related documents: [35](35-shared-ast-seal.md), [36](36-shared-ast-seal-locale-add.md).
