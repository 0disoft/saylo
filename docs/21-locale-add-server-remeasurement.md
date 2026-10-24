# 21. Server-side measurement of locale addition with the current parser

On 2026-10-07 KST, I remeasured the server-side stages of large locale addition with the current code. Across the individual stages collected in all 10 runs, catalog parsing took the longest. Parsing p50 was 191.37 ms, translation preparation was 13.06 ms, and final validation was 0.04 ms. Product code and the measurement harness were unchanged.

## Run and scope

```sh
node benchmarks/live-update/run.mjs --mode locale-add --server-file-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-ast-freeze-server-files.json
```

I reused the dist built in the immediately preceding work. The measured revision was `95d2c9807baf15bb80658a87bb40a221eb5460a5`, and the worktree was clean at the start. Product code included simple-message parsing, compact transport, argument-schema sharing, and AST freezing optimization. I reconciled the recorded code SHA-256 values against the current dist, measurement code, and lockfile.

The fixture and options match the earlier [measurement 14](14-locale-add-server-measurements.md): 10,000 initial messages across 20 locales in 20 files, 7,755,280 B of JSON, and one namespace. Each iteration adds a new en-GB directory and one valid translation JSON file containing 10,000 messages and 387,783 B. There are 2 warmups, 10 measured runs, and 10 control round trips. Typegen and the existing dependency prebundle are enabled; the CPU profiler and detailed browser measurements are disabled.

The environment was Node 24.18.0, Windows x64, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, Ryzen 5 7430U, with 31.3 GiB memory. I preserved the [summary](../benchmarks/results/locale-add-ast-freeze-server-files.json) and [raw samples from 12 runs](../benchmarks/results/locale-add-ast-freeze-server-files.10k-20-locales.samples.json). Statistics use nearest rank; p95 over 10 measured samples is the maximum.

Instrumentation uses the existing prototype wrapper and Node module hook to collect from immediately before the save through the list DOM ack. Subsequent language selection, full response, return to en, and deletion are excluded from the server samples. readAndCandidate spans from entering drain to entering translation preparation and includes path checking, reading, parsing, and remaining work. Parsing is the wall time of the synchronous parseCatalog call plus argument construction. Translation preparation includes schema lookup, new-translation validation, and quarantine preparation and is distinct from final active validation. Path checking and reading are asynchronous wall time.

## Results

| Item | p50 (ms) | p95 (ms) |
| --- | --- | --- |
| Save → list DOM ack | 330.19 | 1,092.85 |
| Save → manifest broadcast | 311.03 | 1,056.37 |
| Selection → first translation commit (browser) | 306.10 | 548.80 |
| Selection preparation → first translation ack (Node) | 309.53 | 815.26 |
| Control round trip | 4.30 | 7.17 |
| queue→drain | 60.30 | 106.40 |
| readAndCandidate (including file stages) | 227.99 | 968.97 |
| Path check | 2.84 | 15.08 |
| UTF-8 read | 6.29 | 94.66 |
| Catalog parsing | 191.37 | 960.89 |
| Remaining candidate work | 3.96 | 27.41 |
| Translation preparation and validation | 13.06 | 20.27 |
| Final active validation | 0.04 | 0.08 |
| registry replace | 0.13 | 0.79 |

Calculating the parsing/readAndCandidate share for each sample gave a minimum of 65.76%, a median of 85.52%, and a maximum of 99.17%. These are shares of wall time within the candidate stage, not total save → list latency or CPU utilization. I do not add p95 values from nested measurements. GC and scheduling delays were not separated, and I do not attribute the parsing tail to a specific cause.

In this run, 0/10 iterations finished list rendering within 250 ms, and even the minimum was 307.32 ms. Selection-preparation ack and browser commit use different clocks and completion points, and the former includes Node control-response and ack costs, so I do not subtract the values directly. A catalogDelta of zero up to the list ack in the server measurements does not mean there is no full-response cost after selection.

Final validation reuses the successful catalog/fingerprint records in `LiveRegistry.validated`. New-translation validation is included in the preceding translation preparation, so 0.04 ms is not the total translation-validation cost.

## Verified behavior and limitations

For the 10 measured samples, after excluding 2 warmups from the 12 raw runs, I reconciled timing, control, byte summaries, unique tokens, call counts, per-sample candidate remainder, and code hashes. Every run had one drain, one path check, one read, one parse, and two file events. In all 10 measured runs there were zero target catalog responses before selection and one compact full response without a baseline after selection. Response-object JSON p95 was 1,241,400 B and is not total physical network bytes.

In the actual browser, I preserved the input node, entered value, and React state after list addition, language selection, and deletion, and returned to baseline without a document reload. Generated `.d.ts` files also retained their mtime and size. After completion no owned temporary fixture/profile directories or benchmark browser processes remained. Because product and measurement code were unchanged, I did not repeat the full test suite, consumer typecheck, build, release check, or pack.

The fixture and options match run 14, but product changes and load differed in between, so I do not attribute timing differences to a single change. Sample count, instrumentation, and load also differ from the immediately preceding [50-iteration run without instrumentation](20-locale-add-remeasurement.md), whose large list p95 was 1,056.40 ms, so they are not a direct before/after comparison. Multiple namespaces, invalid translations, full-message rendering, cold startup, and paint are outside this scope. The 250 ms target for large remains unmet.

## Next implementation candidates

Reduce object construction and freezing costs in the cold parser before revisiting final validation and registry replacement. [Internal measurement 19](19-ast-freeze-measurements.md) and the current code show that simple ASTs repeatedly create and freeze relative-position objects. The next candidate experiment is to share identical relative-position values within a single parsing call. It will preserve absolute source positions, Unicode offset/line/column information, ICU error locations, and deep immutability, and will be adopted only after a separate cross-comparison confirms its effect. This work did not implement that optimization.
