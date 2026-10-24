# 35. Module-level AST freezing helper

I adopted the single optimization identified as the next candidate in [34](34-message-freeze-stages.md): eliminating per-call creation of the `seal` helper inside `freezeMessageAst`. I moved `seal` to module scope in `packages/core/src/diagnostics.ts` so every new AST reuses the same function. Deep-freeze traversal, `WeakSet` trust, generic freezing of complex ICU messages delegated to FormatJS, and the public API remain unchanged.

## Change scope

I moved `seal` out of `freezeMessageAst` to module scope. Its body (`Object.freeze` and `frozen.add`) and call order are unchanged. This path is used only for new ASTs owned by the parser, so generic freezing of external input and error semantics remain unchanged. Public entries, versions, and published packages are unchanged.

## Conditions and boundaries

```sh
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs cbd6871 benchmarks/results/parse-compare-shared-ast-seal-cold.json cold
node benchmarks/live-update/parse-compare.mjs cbd6871 benchmarks/results/parse-compare-shared-ast-seal-incremental.json incremental
```

The baseline revision was `cbd6871`. This ran on 2026-10-08 KST under Node 24.18.0. A file contained 10,000 ordinary-text and ASCII `{name}` messages, and the two parsers were called alternately in the same process. One `probe` value changed to another value of equal length each iteration. Full parsing results from both parsers were checked with `deepEqual` for every pair, including warmups (25 cold and 150 incremental pairs, all equal). Cold mode parses without a previous catalog; incremental mode reuses the immediately preceding immutable catalog. `stringify`, equality checks, disk I/O, the watcher, translation validation, and the browser were excluded from timing.

Cold mode had 5 warmup and 20 measured pairs; incremental mode had 50 warmup and 100 measured pairs. p50 and p95 use nearest rank. I do not deduct GC/control or add nested p95 values. I make no causal comparison with runs at different times.

## Cold cross-comparison

| Parser | p50 (ms) | p95 (ms) | min (ms) | max (ms) |
| --- | --- | --- | --- | --- |
| Baseline revision | 178.4783 | 332.6223 | 96.3825 | 359.4802 |
| Module-level `seal` | 151.7772 | 323.8107 | 98.7914 | 357.4289 |

Thirteen of 20 pairs were faster, and the per-pair after−before median was -26.1658 ms. Per-pair difference p95 was +24.8066 ms.

## Incremental cross-comparison

| Parser | p50 (ms) | p95 (ms) | min (ms) | max (ms) |
| --- | --- | --- | --- | --- |
| Baseline revision | 48.1476 | 88.6328 | 32.1344 | 156.1319 |
| Module-level `seal` | 47.5307 | 80.2430 | 27.5103 | 246.9130 |

Fifty-three of 100 pairs were faster, and the per-pair median difference was -0.7381 ms. Per-pair difference p95 was +30.1070 ms.

## Interpretation and limitations

Parsing p50 and p95 were observed lower in both comparisons, and the implementation is smaller because it moves an internal helper, so I adopted the change. The cold per-pair median was -26.1658 ms and the incremental median was -0.7381 ms. Per-pair difference p95 was positive in both comparisons, and the longest incremental duration increased from 156.1319 to 246.9130 ms. GC and load were uncontrolled on a single machine, so I do not establish the timing difference as helper-creation cost. I do not claim stable tail improvement or general speedup. I did not measure an improvement toward the 250 ms target for real locale lists.

## Validation

The core build, 75 core tests, and consumer typechecks passed. One `node --test benchmarks/live-update/parser-probe.test.mjs` test passed. I reconciled summaries, per-pair differences, five dist hashes, and temporary-directory cleanup against the cold and incremental raw samples. Of the five product dist files, only `diagnostics.js` differs from the baseline revision; `catalog.js`, `json.js`, `simple-message.js`, and `schema.js` match the earlier baseline.

Because the public API and wire format were unchanged, I did not repeat full-workspace, pack, browser, or release checks.

I checked the documentation tables against the result JSON. All 186 local links in the six changed Markdown files, code fences, the 40 KB limit, and `git diff --check` passed.

## Next work

Next is to remeasure actual large locale-add list rendering time with detailed instrumentation disabled and check whether the product change meets the 250 ms target.

## Data

- [Cold comparison](../benchmarks/results/parse-compare-shared-ast-seal-cold.json)
- [Incremental comparison](../benchmarks/results/parse-compare-shared-ast-seal-incremental.json)

The change did not alter the public API, version, or publication, and it was not pushed or published.
