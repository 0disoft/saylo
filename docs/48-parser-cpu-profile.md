# 48. CPU profile of the current parser

Without changing product code, I added a V8 CPU collector and summarizer for the parser. In edit mode, samples concentrated around the JSON-read call site and generic freezing; in cold mode, they concentrated around generic freezing, JSON reading, AST sealing, and argument inference. The next small candidate is **skipping re-traversal of the final message map after its messages have already been deeply frozen**. This work neither implemented the candidate nor confirmed a performance improvement.

## Conditions and collection scope

On 2026-10-10 KST at baseline revision `abdf076`, under Node v24.18.0 on Windows x64 with a Ryzen 5 7430U, I reused the existing core build. I recorded hashes for the five product dist files, runner, summarizer, statistics, and lockfile. A file contained 10,000 plain/ASCII `{name}` messages, and one probe changed to an equal-length value. Incremental mode used the previous immutable catalog; cold mode parsed without a previous catalog. This fixture measures the parser portion of an added locale; it is not a real 20-locale registry, watcher, or browser run.

```sh
node benchmarks/live-update/parser-cpu.mjs incremental benchmarks/results/parser-cpu-2026-10-10-incremental.json 100
node benchmarks/live-update/parser-cpu.mjs cold benchmarks/results/parser-cpu-2026-10-10-cold.json 100
```

The final two runs executed sequentially in separate Node processes. Each had 100 measured runs; warmups were 50 for incremental and 5 for cold. JSON generation, warmups, startup preparation, validation, and file writing were outside the profiler. All input JSON was created and retained in advance. The measurement loop, per-call clock, and observed GC were included. The requested sampling interval was 1,000 µs. There were no detailed stage clocks or forced GC, and OS load and GC were uncontrolled. No other repository tests or builds ran concurrently with collection.

## Sample distribution

The denominator in the function table is **attributable samples** where `parseCatalog` or the core dist stack appears. GC and unattributable samples are not assigned to functions. Shares are sample counts, not exact CPU time or allocation volume. Compare self values only; do not add inclusive rows.

| Sample category | incremental | cold |
| --- | ---: | ---: |
| Total | 1,868 | 7,295 |
| parseCatalog stack | 1,754 | 6,586 |
| Core-only stack without a parser parent | 0 | 0 |
| GC | 97 | 685 |
| idle/program | 1 | 1 |
| Outside parser or unattributable | 16 | 23 |
| Negative timeDelta | 0 | 0 |

| Function self / attributable samples | incremental | cold |
| --- | ---: | ---: |
| parseCatalog | 59.35% | 9.16% |
| freeze | 22.92% | 25.27% |
| readJson | 17.50% | 19.85% |
| seal (AST) | 0.06% | 17.13% |
| inferArguments | 0% | 13.39% |
| parseSimpleMessage | 0.06% | 9.35% |

Inline and native call costs may be attributed to `parseCatalog` in incremental mode. Of the profiler line ticks for this function, 744 are at the `readJson(source, context)` call site on dist line 20, and 307 of `readJson`'s ticks are at the strict `JSON.parse(source)` call on dist line 9. Do not interpret all of `parseCatalog` self time as message-loop cost. In generic `freeze`, 311 incremental and 766 cold ticks were recorded at the `Object.values` traversal on dist line 9. Line ticks are V8 line counters and do not represent per-statement TypeScript CPU time.

With the profiler enabled, call wall-time p50/p95 was 26.88/42.35 ms for incremental and 99.82/133.66 ms for cold, and the cold maximum was 1,134.78 ms. Load, GC, and profiler effects were not separated, so I do not compare these with earlier unprofiled baselines or classify them as improvement or regression. GC samples alone also do not establish the cause of the longest call.

## Next candidate and limitations

Every successfully parsed message in `catalog.ts` has either been deeply frozen or reused from a trusted previous catalog. The final `freeze({ ...context, messages })` then traverses the map's messages again. The condition where most messages are reused in incremental mode, together with the share of samples in generic freezing, supports testing a candidate that reduces this final map traversal. I do not attribute all freeze samples to the final-map cost.

The next experiment is limited to parser-owned maps. It will retain deep immutability for messages, ASTs, and positions and the generic `freeze` contract that recursively traverses externally shallow-frozen objects. Adoption will be decided by a same-process cold/incremental cross-comparison. It is not a reintroduction of directly freezing new message records from [33](33-owned-message-freeze-trial.md) or replacing generic for-in from [19](19-ast-freeze-measurements.md).

In initial collection, a negative timeDelta stopped validation, and another preliminary cold collection contained many core stacks without parser parents and anonymous runner frames. The summarizer preserves negative values without correction and uses sample counts. It accepts core-only stacks separately without inventing a missing parent. The final files come from two runs collected with the revised tool and are not mixed with preliminary runs. JIT, inlining, native attribution, sampling interval, and machine state can also change function rankings. This is a literal/simple-argument fixture, so do not generalize it to catalogs dominated by complex plural/select messages.

## Validation and sources

One summarizer test verified separation of GC, idle, and external samples; core-only stacks without a parent; deduplication of recursive inclusive samples; dist line ticks; preservation of negative deltas; and rejection of invalid array lengths and node IDs. After 100 runs in each mode, I checked the final probe value and total key count and confirmed that incremental mode retained unchanged-message references. I reconciled wall-time statistics from 200 runs, all 9,163 CPU samples from both raw files, bucket decomposition, and function summaries, and all nine code hashes matched both modes and current files. There was no product source diff. I did not repeat existing product tests, build, pack, or browser checks because inputs were unchanged.

- [incremental summary and call samples](../benchmarks/results/parser-cpu-2026-10-10-incremental.json), [raw cpuprofile](../benchmarks/results/parser-cpu-2026-10-10-incremental.cpuprofile)
- [cold summary and call samples](../benchmarks/results/parser-cpu-2026-10-10-cold.json), [raw cpuprofile](../benchmarks/results/parser-cpu-2026-10-10-cold.cpuprofile)

No version change, push, publish, or deploy was performed.
