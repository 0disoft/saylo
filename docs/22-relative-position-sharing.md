# 22. Relative-position sharing for simple ASTs

I implemented a local optimization that shares identical relative coordinates and identical start/end position objects within one catalog parsing call for simple ASTs. In a new parsing cross-comparison, 15 of 20 pairs were faster, and p50 was observed lower at 118.42 → 95.26 ms. The longest duration increased, so I do not claim to have resolved long-tail latency or stably met a performance target.

## Implementation and contract

- `parseCatalog` creates a `createSimplePositionPool` for each call. Only the simple literal and ASCII-argument parsers use the pool; complex ICU messages delegated to FormatJS keep the existing path. This is an internal function and is not exported from a public package entry.
- Coordinates distinguish all three values: offset, line, and column. For the first line where column=offset+1, only the numeric offset key is used to avoid constructing tuple strings. Other positions use string keys containing all three coordinates, so different Unicode columns and line numbers at the same UTF-16 offset remain distinct.
- start/end coordinates are deeply frozen and shared, and identical position spans are also shared using the two coordinate objects as keys. AST nodes and arrays and each message's absolute catalog position object remain distinct. Serialized AST values and wire format are unchanged.
- `freezeMessageAst` skips freezing position spans that are already registered as trusted. Untrusted positions and complex ICU messages retain the existing deep freeze.
- The pool is not cached across calls. Unchanged messages reuse their existing ASTs, while new messages do not carry earlier relative positions into the new pool. AST output references only coordinate and span objects and retains no Map. Inputs with many unique positions add key and Map overhead, so I do not claim improvement for every message shape.

The existing parser checks for Unicode/UTF-16 offsets, CRLF, lone surrogates, FormatJS AST agreement, and ICU error positions are retained. I additionally verified identical-coordinate/span sharing, separation between calls, distinct absolute source positions, incremental reference reuse, and ICU fallback diagnostics after a failed simple parse. The core build, 166 workspace tests (75 core, 9 React, 5 typegen, 77 Vite), and workspace consumer typechecks passed. The workspace tests also cover the production lazy/SSR build and parser-free astRuntime verification.

## Cold and incremental cross-comparison

```sh
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs 0a1beb2 benchmarks/results/parse-compare-position-pool-final-cold.json cold
node benchmarks/live-update/parse-compare.mjs 0a1beb2 benchmarks/results/parse-compare-position-pool-final-incremental.json
node benchmarks/live-update/parser-stages.mjs benchmarks/results/parser-stages-position-pool-cold.json cold
```

This ran on 2026-10-07 under Node 24.18.0 on Windows x64 with a Ryzen 5 7430U. Baseline `0a1beb2` included the existing argument-schema sharing and AST-specific freezing. The comparison fixture contained 10,000 English literal and ASCII `{name}` messages. The two parsers were called alternately in one process, and the full result of every pair was reconciled. Stringify, equality checks, disk I/O, the watcher, translation validation, and the browser were excluded from timing.

| Mode | Baseline p50 (ms) | Shared p50 (ms) | Baseline p95 (ms) | Shared p95 (ms) | Faster pairs |
| --- | --- | --- | --- | --- | --- |
| cold | 118.42 | 95.26 | 382.37 | 271.70 | 15/20 |
| incremental | 25.78 | 25.15 | 52.45 | 53.10 | 62/100 |

Cold mode had 5 warmup and 20 measured pairs without a previous catalog. Incremental mode changed one equal-length value, reused the previous catalog, and had 50 warmup and 100 measured pairs. These are nearest-rank summaries; the median per-pair after−before difference was -13.81 ms and -0.83 ms, respectively.

Raw data is in the [final cold comparison](../benchmarks/results/parse-compare-position-pool-final-cold.json) and the [incremental comparison](../benchmarks/results/parse-compare-position-pool-final-incremental.json). The longest cold duration increased from 413.83 to 680.49 ms, and the per-pair difference p95 was +126.35 ms. The longest incremental duration was 86.54 → 124.58 ms, and no p95 improvement was confirmed. Load, GC, and scheduling effects within a single run were not separated, so I do not interpret every tail as improved.

Using the same 10k comparison fixture, I built a standalone simple parser without the pool and the catalog parser with the pool and verified that their AST values were equal. The AST referenced 39,998 → 10 unique coordinate objects and 19,999 → 9 span objects. These are object counts in the reference graph; they are not measurements of total allocation, heap bytes, memory use, or reduced transport size.

## Internal measurement and initial experiment

The [internal summary](../benchmarks/results/parser-stages-position-pool-cold.json), [1k raw samples](../benchmarks/results/parser-stages-position-pool-cold.1000.samples.json), and [10k raw samples](../benchmarks/results/parser-stages-position-pool-cold.10000.samples.json) use 5 warmups and 20 measured runs and include clock/counter overhead. For 10k, total p50/p95 was 143.08/282.73 ms, the AST stage was 20.19/56.79 ms, and message freezing was 39.17/94.92 ms.

The cost of first constructing and freezing coordinates and spans is now included in the AST stage. I do not compare only message-freezing times from earlier independent runs to calculate improvement, nor do I add nested p95 values. GC overlapped in 10 of the 20 10k measurements; I do not treat GC duration as actual pause/CPU cost or subtract it from parsing time.

The first version shared only coordinates and added a trust lookup for each AST seal. The [initial experiment result](../benchmarks/results/parse-compare-position-pool-cold.json) showed 11 of 20 faster pairs with a pair median of -9.40 ms, but p95 was 245.66 → 249.98 ms. The final implementation also shares position spans and performs one trust lookup per span. Hashes in the initial files correspond to the experimental code at that time and are distinct from the current hashes. I do not subtract timings from independent runs to calculate the difference between the two experiments.

I reconciled raw pairs, sample counts, nearest-rank summaries, stage remainders, call counts, GC windows, and final code hashes, and confirmed that no temporary benchmark directory remained.

## Next work

I locally adopted the final implementation based on the reduction in object count and the improved cold median. The next step is to remeasure list rendering and selection → first-translation rendering for an actual large locale addition. This work did not remeasure end-to-end browser latency again and does not claim that the existing 250 ms list-render target has been met. The optimization is not yet in the npm release.
