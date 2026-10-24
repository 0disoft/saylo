# 15. Simple Message Parsing Path

On 2026-10-07, an internal parsing path limited to ordinary strings and ASCII `{name}` interpolation was implemented. In 20 same-process cold cross-comparisons with the baseline parser, 18 pairs were faster, and the median after−before difference was −167.99 ms. Parser p95 did not improve. A later 10-run large locale addition observed list p95 of 514.47 ms, still failing the 250 ms target.

This change exists only in the local checkout. It is absent from npm `0.1.0-alpha.1` and does not change public APIs, catalog format, or the argument contract.

## Implementation scope

`packages/core/src/simple-message.ts` reads only top-level literals and ASCII-identifier arguments to build a FormatJS-shaped AST. Ordinary text may include Unicode, LF, CRLF, tags, and top-level `#`. It handles `{name}`, `{_value9}`, `{__proto__}`, and similar forms but delegates names beginning with digits, Unicode argument names, and whitespace inside arguments to the existing FormatJS parser.

Messages with apostrophes, number/date/time, skeleton, plural/select/ordinal, and other forms also use FormatJS. Argument-name validation requires the entire string to match exactly. A strict end condition prevents JavaScript regex `$`, which also matches before a trailing newline, from incorrectly accepting `{name\n}`. If unsupported syntax is found later, the partial AST is discarded and the full original text is parsed by FormatJS. Cases that are allowed as top-level literals, such as a standalone closing brace, also go to the existing parser.

`parseCatalog` receives either the simple AST or a FormatJS AST and then applies the existing `inferArguments` and deep freeze. Locale canonicalization, strict JSON, duplicate IDs, incremental previous-catalog reuse, error-position mapping, and translation validation also retain existing paths. No separate global cache or cross-locale AST reuse was added.

AST offsets are UTF-16, and columns use Unicode code points like FormatJS. One supplementary character occupies offset 2 and column 1. AST lines increment on LF, and CR is an ordinary column. JSON-file `SourcePosition` retains existing UTF-16 columns. AST positions and file positions are not calculated with the same locator.

The installed `@formatjs/icu-messageformat-parser` 3.5.20 already has a shortcut for ordinary strings. Simple interpolation is the main target of this change; it does not replace the full existing parser.

## Verification

- Core 69, typegen 5, and Vite 72 tests (146 total) passed.
- Five new tests compare directly against a FormatJS AST reference. They cover Unicode, isolated surrogates, LF/CRLF, repeated arguments, prototype names, empty strings, tags, `#`, apostrophes, argument whitespace, and malformed suffixes. They also compare 121 fragment combinations.
- Argument contracts, actual translations, deep immutability, and escaped JSON error positions were checked. Existing duplicate-ID, ICU-conflict, incremental-reuse, SSR, and production AST-chunk tests also passed.
- The full workspace build and core consumer typecheck passed. The core npm pack dry-run list included the new internal JS and `.d.ts`. Actual tarball installation into an external consumer and release publishing were not run.
- In a real headless Chrome browser, add→list→select→first translation→return to en→delete ran 12 times. Input nodes, values, and React state remained with no reload. Generated declaration file mtime and size remained unchanged; there were zero new-catalog responses before selection and one fresh full response after selection. Fixture, browser profile, and corresponding browser process were absent after shutdown.

## Same-process cold comparison

```sh
node benchmarks/live-update/parse-compare.mjs a7367b9 benchmarks/results/parse-compare-simple-cold.json cold
```

Added `cold` as the third optional argument to `parse-compare.mjs`. The default `incremental` retains 50 warmups and 100 measured pairs. `cold` uses 5 warmups and 20 measured pairs and reparses 10,000 messages from scratch without passing a previous catalog each time. en-GB uses English literals and ASCII `{name}` interpolation. Execution order alternates between the two parsers, and all results are compared each time. Stringify, equality checks, disk, watcher, translation validation, and browser are excluded from timing.

The baseline is the parser from core source at `a7367b9` compiled in a temporary directory. Raw pairs and actual current module SHA-256 values are in [comparison result](../benchmarks/results/parse-compare-simple-cold.json). The hash identifies the same final parser as the browser run below. Node 24.18.0 and the same checkout dependencies were used.

| parser-only | Baseline | Fast path |
| --- | --- | --- |
| p50 | 514.92 ms | 353.77 ms |
| p95 | 995.91 ms | 1,050.21 ms |

The median per-pair after−before difference was −167.99 ms and p95 was +54.30 ms; 18/20 pairs improved. A representative cost reduction was observed, but no tail-latency improvement is claimed. GC and scheduling effects were not separated. Do not generalize to every ICU form or machine.

## Actual locale-addition remeasurement

```sh
node benchmarks/live-update/run.mjs --mode locale-add --server-file-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-simple-server-files.json
```

This used the [conditions from 14](14-locale-add-server-measurements.md) on Node 24.18.0, Vite 8.3.2, React 19.3.0, and HeadlessChrome 154: initial data of 10k×20 locales, one namespace, and one new file. Instrumentation runs from immediately before file save to list DOM ack; post-selection full response and deletion are excluded from server stages. Summary is in [result](../benchmarks/results/locale-add-simple-server-files.json), raw data in [12 samples](../benchmarks/results/locale-add-simple-server-files.10k-20-locales.samples.json). The two warmups are excluded.

| Item p95 | Previous run | New run |
| --- | --- | --- |
| Save→list DOM ack | 1,808.23 ms | 514.47 ms |
| Catalog parsing | 1,132.23 ms | 331.29 ms |
| Selection ready→first-translation ack | 877.85 ms | 471.79 ms |
| Control round trip | 14.50 ms | 3.45 ms |
| File write | 130.54 ms | 14.16 ms |

Each run used warmup 2, 10 measurements, and 10 controls. A 10-run p95 is the maximum. Execution time and load differed, and control and file-write times also changed, so the full reduction is not interpreted as the code change's effect. Report it separately from same-process pair comparison and do not sum stage p95 values. The result showing no parser-p95 improvement is retained.

In the new run, input JSON p95 was 387,783 B and full catalog response JSON p95 was 4,421,174 B. AST shape was unchanged, so transported object size did not decrease in this run. It is also not total physical network bytes. Parsing occurred exactly once in all 10 iterations, and statistics, residuals, and code hashes were checked. The 250 ms target and full-catalog selection-cost optimization remain.
