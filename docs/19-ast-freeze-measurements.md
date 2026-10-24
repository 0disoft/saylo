# 19. Parser-Owned AST Freeze Optimization

The catalog parser now directly freezes the known structure of literal and argument ASTs it creates. This reduces the cost of recursive calls for every numeric source-position field and string node field and of creating `Object.values` arrays. Complex ICU nodes, branches, skeletons, and external inputs retain the existing deep freeze.

## Scope and verification

The internal `freezeMessageAst` is used only for newly created parser ASTs. It freezes in this order: location start/end, location, node, and finally the AST array, and it also registers the AST in the existing trusted `WeakSet`. Ordinary freezing of the message object no longer revisits an AST that is already frozen. This function is not exported from the public package entry. Positions, text, argument types, and serialization contents are unchanged.

For externally shallow-frozen objects, the existing `freeze` checks children. Reuse of unchanged message and AST references from the previous catalog also remains. Checks confirmed that every object in simple ASTs, FormatJS quoted literals, nested plural/select nodes, and number/date skeletons is deeply frozen and registered as trusted. Existing tests continue to cover ICU errors and UTF-16 source positions.

The core build, 164 workspace tests (core 73, React 9, typegen 5, Vite 77), and the workspace consumer typecheck passed. Workspace checks also include the production lazy/SSR build and the parser-free `astRuntime` verification.

## Cold cross-comparison

```sh
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs 6e67555 benchmarks/results/parse-compare-ast-freeze-cold.json cold
node benchmarks/live-update/parser-stages.mjs benchmarks/results/parser-stages-ast-freeze-cold.json cold
node benchmarks/live-update/parse-compare.mjs 6e67555 benchmarks/results/parse-compare-ast-freeze-incremental.json
```

This ran on 2026-10-07 with Node 24.18.0 on Windows x64 and an AMD Ryzen 5 7430U. Baseline `6e67555` includes [shared argument schemas](18-shared-argument-schemas.md). In the same process, 10,000 English literal and ASCII `{name}` messages were parsed alternately by the two parsers. Cold means creating a new catalog without a previous catalog on every run, not starting a new process. After 5 warmup pairs, 20 pairs were measured, and the full parse results of every pair were compared. stringify, equality checks, disk, watcher, translation validation, and browser were excluded from timing.

| Parser | p50 (ms) | p95 (ms) |
| --- | --- | --- |
| Existing generic freeze | 135.39 | 356.05 |
| Structure-specific AST freeze | 107.54 | 279.60 |

Fifteen of 20 pairs were faster, and the per-pair after−before median was −19.20 ms. Raw pairs and code hashes are in the [cold comparison results](../benchmarks/results/parse-compare-ast-freeze-cold.json). p50 and p95 are nearest-rank values. These are observations from a single run, not a causal estimate with load and GC separated, nor a speed guarantee for all ICU inputs.

## Internal instrumentation and incremental path

The [instrumentation summary](../benchmarks/results/parser-stages-ast-freeze-cold.json), [1k raw samples](../benchmarks/results/parser-stages-ast-freeze-cold.1000.samples.json), and [10k raw samples](../benchmarks/results/parser-stages-ast-freeze-cold.10000.samples.json) each contain 5 warmups and 20 measurements.

| Message count | Total p50 (ms) | Total p95 (ms) | Message freeze p50 (ms) | Message freeze p95 (ms) |
| --- | --- | --- | --- | --- |
| 1,000 | 16.09 | 50.39 | 9.66 | 38.63 |
| 10,000 | 219.54 | 589.42 | 114.18 | 408.94 |

The current messageFreeze interval also includes AST freezing, message construction, and position creation. The earlier hook constructed message inputs outside the timing window, so improvement is not calculated from stage times in the earlier independent run. Instrumentation clock and counter costs are included, and nested metric p95 values are not added together. Every sample froze argument schemas twice and message freezing ran once per message. GC overlap occurred in 12 of the 20 10k measurements. GC duration is not treated as actual pause or CPU cost and is not subtracted from parsing time.

The [incremental comparison](../benchmarks/results/parse-compare-ast-freeze-incremental.json) changed one message of the same length in the 10k input and reused the previous immutable catalog. It used 50 warmup pairs and 100 measurements. p50 went from 49.90 to 52.53 ms and p95 from 119.25 to 88.36 ms; the per-pair median difference was +1.17 ms, and 45 pairs were faster. No speed improvement was confirmed for ordinary editing. Previous message references and parse-result equality were preserved.

Raw sample counts, nearest-rank summaries, residual intervals, GC windows, and current code hashes were compared.

## Reverted experiment and next work

The first experiment changed `Object.values` in the generic `freeze` to an own-key `for...in` traversal and recursed only into object children. The [experiment results](../benchmarks/results/parse-compare-freeze-traversal-cold.json) show that 6 of 20 cold pairs were faster; the median difference was +11.54 ms and p95 went from 250.71 to 350.16 ms. That code was reverted, and the hashes in the result file identify the code from the experiment. They differ from the hashes of the final code.

The next task is an end-to-end remeasurement from actual locale addition through list display and selection to the first translation update. Browser latency was not measured this time, and no claim is made that the 250 ms list-display target was met. Freezing dedicated to complex ICU and broad changes to generic freezing are outside the scope of this change. This is a local commit target and is not yet in the npm published version.
