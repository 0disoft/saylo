# 40. Simple-message argument collection experiment

I experimented with eliminating the generic AST re-traversal by collecting arguments during the simple parsing path from [15](15-simple-message-parser.md). Both p50 and p95 for cold new parses increased, so I judged the performance evidence insufficient and reverted it. Product code and the measurement harness remain at `cbf30aa7b915038efa6b5f7e369142877adad688`. The experiment is preserved in a [patch](../benchmarks/results/simple-arguments-experiment.patch).

## Experiment scope

I added an optional Set argument to `parseSimpleMessage` and collected ASCII argument names in encounter order. When parsing succeeded, `inferSimpleArguments` received the collected result and skipped the generic AST walk. The Set removed duplicates and shared the same JSON schema signature and per-parse cache as the existing generic ICU path. If the simple path failed, it discarded the collected prefix and fell back to existing FormatJS parsing and `inferArguments`, preserving conflict and error-position validation. Public exports, versions, and wire format were unchanged, and I also adjusted the measurement boundaries in `parser-probe`.

The reverted files were `packages/core/src/simple-message.ts`, `packages/core/src/schema.ts`, `packages/core/src/catalog.ts`, `packages/core/test/simple-message.test.mjs`, and `benchmarks/live-update/parser-probe.mjs`. I rebuilt core dist after reverting.

## Measurement conditions

This ran under Node v24.18.0 on Windows x64. Cold results were recorded at 2026-10-09T07:57:34.713Z and incremental results at 2026-10-09T07:58:43.423Z. A file contained 10,000 ordinary-text and ASCII `{name}` messages, and one probe changed to an equal-length value every iteration. A parser built from baseline commit `cbf30aa` source in a temporary directory and the experimental parser were called alternately in the same process.

Cold mode had 5 warmup and 20 measured pairs without a previous catalog. Incremental mode reused the previous catalog and had 50 warmup and 100 measured pairs. Every pair's full parsing result was checked with `assert.deepEqual`. Only call wall time was measured; input stringify, equality checks, disk I/O, the watcher, translation validation, and the browser were excluded. p50 and p95 use nearest rank, and per-pair differences are experiment minus baseline. I do not add p95 values or deduct GC/control time.

```sh
git apply benchmarks/results/simple-arguments-experiment.patch
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs cbf30aa benchmarks/results/parse-compare-simple-arguments-cold.json cold
node benchmarks/live-update/parse-compare.mjs cbf30aa benchmarks/results/parse-compare-simple-arguments-incremental.json incremental
```

To reproduce, use a separate checkout of the baseline commit and copy the preserved patch to the same paths in that checkout. The result's `baselineRevision` is `cbf30aa7b915038efa6b5f7e369142877adad688`. `currentCodeHashes` refers to the experimental dist before reversion and is the same for cold and incremental runs.

```text
catalog.js        fd4f90aabdce544ec23f9f18cfe6929325b9c5da59638de21802f68e47162ea2
simple-message.js d451f910d0e82577a95e51ed2e58cc91d4835e8bc57447c5f1af5b1598c28fe5
schema.js         fa82dfd0b7ece567b8f01b9e27cd6a297356f2fa415bef079048b8bf76bb8c17
json.js           ab6c3ba9b7a534e453b9468baa8a6513da3e5fc1ab82f660f12df793f0cdf80b
diagnostics.js    3d512b1fba5b545937309dced114bd52da5a67b1e4f2fe01deef33080c923ed7
```

## Results and adoption decision

| Mode | Baseline p50 | Experiment p50 | Baseline p95 | Experiment p95 | Per-pair difference median | Per-pair difference p95 | Faster pairs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 98.46 | 117.02 | 183.20 | 207.63 | +11.62 | +53.64 | 4/20 |
| incremental | 41.36 | 40.18 | 61.25 | 60.20 | −0.90 | +13.38 | 54/100 |

Units are ms. For cold new parsing, both p50 and p95 increased and only 4 of 20 pairs were faster. The maximum fell from 284.12 to 222.94 ms, but the aggregate result worsened. In incremental mode, aggregate p50 and p95 were slightly lower and 54 of 100 pairs were faster, but the per-pair difference p95 was +13.38 ms and the maximum increased from 76.56 to 140.43 ms, about 1.8 times higher. The minimum decreased from 24.12 to 21.12 ms. Even though aggregate results improved slightly in one mode, the cold-path increase and single-run variability were insufficient to justify the experiment's cost. I reverted all changes across the three product files, test, and probe.

Run load, GC, and scheduling were uncontrolled on a single machine, so I do not establish the code as the cause of the increase or as a regression. I also do not judge the experiment's effect on UI rendering or locale-add targets. The next step is to review other structural bottleneck candidates without committing to a specific optimization.

## Validation and preserved data

In the experimental state, the core build, 76 tests, and consumer typechecks passed. Thirty-three selected catalog, simple, and probe tests also passed, but they overlap with the 76 and are not added separately. I checked 121 generated combinations against argument-contract references and verified cross-path sharing, collection order, prototype names, conflicts, and immutability. Full parsing-result deep equality passed for every pair in 25 cold pairs (5 warmup + 20 measured) and 150 incremental pairs (50 warmup + 100 measured). I did not run new live, browser, or release verification or achieve a performance target or publication.

After reversion, the core build and `parser-probe.test.mjs` passed. I confirmed that the product and probe worktrees had no diff, that the three changed dist modules had different hashes from the experiment, and that unchanged JSON and diagnostics hashes were equal. I reconciled raw pair counts, differences, nearest-rank summaries, and code hashes for both runs, and used `git apply --check` to verify that the preserved patch can be reapplied. The temporary parser directory was cleaned up.

- [Cold comparison and raw pairs](../benchmarks/results/parse-compare-simple-arguments-cold.json)
- [Incremental comparison and raw pairs](../benchmarks/results/parse-compare-simple-arguments-incremental.json)
- [Reverted experiment patch](../benchmarks/results/simple-arguments-experiment.patch)

No version change, push, publish, or deploy was performed.
