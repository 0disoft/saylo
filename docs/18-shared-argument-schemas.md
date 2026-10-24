# 18. Sharing Identical Argument Schemas

The parser now shares argument schemas with the same names, argument types, and order within a single `parseCatalog` call. This reduces schema object creation and deep freezing for repeated messages. Each message retains its own AST and source position.

## Implementation and contracts

- Each call creates its own `Map` and uses JSON of the argument occurrence order and acceptedTypes order as the key. There is no global cache across calls. Catalogs with many unique contracts add key-generation and Map costs, so no speed improvement is claimed for all inputs.
- The AST of every message is traversed first to detect argument conflicts. Even when a schema has already succeeded, subsequent messages do not omit `ARGUMENT_CONFLICT` errors or their locations.
- Returned schemas are deeply frozen. Incremental reuse of unchanged messages remains, and schemas from earlier calls are not added to the new pool.
- `validateTranslation` records successful baseline schemas for each deeply frozen translation schema in a `WeakSet`. It checks whether the ID exists in the baseline first, then reuses only successful results for the same object pair. Mutable inputs and new baseline contracts are validated again, and failure diagnostics are not cached.

## Cold cross-comparison

```sh
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs 4b69398 benchmarks/results/parse-compare-schema-sharing-cold.json cold
node benchmarks/live-update/parser-stages.mjs benchmarks/results/parser-stages-schema-sharing-cold.json cold
```

This ran on 2026-10-07 with Node 24.18.0 on Windows x64 and an AMD Ryzen 5 7430U. Cold means parsing with no previous catalog on every run, not starting a new process. In the same process, 10,000 English literal and ASCII `{name}` messages were alternately parsed with the previous and current code. After 5 warmup pairs, 20 pairs were measured, and parse results for every pair were checked for equality. JSON.stringify, equality checks, disk, watcher, translation validation, and browser were excluded from timing.

Raw pairs and code hashes are in [parse-compare-schema-sharing-cold.json](../benchmarks/results/parse-compare-schema-sharing-cold.json). The baseline is `4b69398126032d35872bb93bc20d511e96cf6ce1`.

| Parser | p50 (ms) | p95 (ms) |
| --- | --- | --- |
| Previous | 167.60 | 396.18 |
| Schema sharing | 125.54 | 563.63 |

Seventeen of 20 pairs were faster, and the per-pair after−before median was −36.08 ms. p95 increased, so no tail-latency improvement was confirmed. The median is a nearest-rank p50, not the average of the two middle values of an even sample. This is one run with load and GC not separated, and it does not extend to screen-update time.

## Internal instrumentation

The detailed instrumentation is a separate run. The [summary](../benchmarks/results/parser-stages-schema-sharing-cold.json), [1k raw samples](../benchmarks/results/parser-stages-schema-sharing-cold.1000.samples.json), and [10k raw samples](../benchmarks/results/parser-stages-schema-sharing-cold.10000.samples.json) each contain 5 warmups and 20 measurements. Clock and counter costs are included.

| Message count | Total p50 (ms) | Total p95 (ms) | Argument freeze p95 (ms) | Message freeze p95 (ms) |
| --- | --- | --- | --- | --- |
| 1,000 | 24.95 | 68.97 | 0.06 | 48.77 |
| 10,000 | 324.52 | 644.15 | 0.10 | 494.82 |

This fixture has two kinds of argument contracts: an empty schema and `{name}`. Every sample froze argument schemas twice, while AST traversal and message freezing ran once per message. This confirms fewer freeze calls; it is not a calculation of improvement against the absolute time of an earlier independent run. Nested p95 values were not added together.

Fourteen of 20 10k runs observed GC overlap, and the GC interval union p95 was 123.64 ms. GC duration is not an actual pause or CPU cost, so it is not subtracted from parsing time. The before/after heapUsed difference is not total allocation. Sample counts, nearest-rank summaries, residual intervals, freeze call counts, GC windows, and code hashes were compared with the raw files.

## Verification and next work

The core build, workspace tests (core 72, React 9, typegen 5, Vite 77), and workspace consumer typecheck passed. Checks covered shared identical schemas, separation of AST and position, deep immutability, ICU conflict positions, reuse of validation with multiple baseline contracts, unknown IDs/arguments, and type-narrowing regressions.

The freezing paths for message objects and ASTs are the next optimization candidates. End-to-end locale addition and browser selection latency were not remeasured this time, and no claim is made that the existing 250 ms list-display target was met. This is a local change and is not yet in the npm published version.
