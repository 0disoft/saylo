# 14. Locale-Addition Server Cost Measurements

This document is a measurement record from before parser optimization. Remeasurement of current code with the same fixture and options is in [21-locale-add-server-remeasurement.md](21-locale-add-server-remeasurement.md).

On 2026-10-07, existing server instrumentation was connected to locale-add mode. In 10 large runs, list-display p95 was 1,808.23 ms, exceeding the 250 ms target. Parsing the new catalog took the longest among collected stages in every run and is the next optimization target. This change existed only in the benchmark; product source and `dist` were not modified.

## Execution and conditions

```sh
node benchmarks/live-update/run.mjs --mode locale-add --server-file-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-server-files.json
```

The run used warmup 2, 10 measurements, and 10 controls on Node 24.18.0, Windows x64, Vite 8.3.2, React 19.3.0, and HeadlessChrome 154. Initial data was 10k messages across 20 locales (20 files, 7,755,280 B) in one namespace, and each iteration added a new en-GB directory and one bench.json. The added file contained 10,000 messages (387,783 B). Schemas and existing files were unchanged.

Raw figures are in the [summary result](../benchmarks/results/locale-add-server-files.json) and [12 samples](../benchmarks/results/locale-add-server-files.10k-20-locales.samples.json). The two warmups were excluded from the summary. Selected code-file and lockfile SHA-256 values, Git revision, and worktree state were recorded in the result. Statistics use nearest rank; a p95 from 10 runs is the maximum.

## Collection boundaries

- The existing `profile.mjs` prototype wrapper and the `server-file-profile.mjs` Node module hook are used. No clocks or profiling APIs were added to product files; only call boundaries in the actual files being loaded were wrapped in memory.
- `begin()` is called after directory creation and content preparation, immediately before saving the catalog. After the list DOM ack body is received, its clock is captured first and then `finish()` is called. Language selection, the fresh full response, return to en, and deletion that follow are not included in that server sample.
- `readAndCandidateMs` runs from drain entry to `prepareTranslations` entry. It includes waiting for serialized drain, path check, read, parse, candidate preparation, and base stat. The parse stage is the complete synchronous `parseCatalog` call and argument construction, including JSON, ICU, argument inference, positions, and freezing. Parser-internal causes were not separated yet.
- `translationPreparationMs` covers schema lookup, translation validation, and quarantine preparation. Because this is a normal translation, actual quarantine-recovery cost is not measured. `validationMs` covers subsequent final active-catalog validation. Do not combine the two as one translation-validation cost.
- Path check and read are async wall time. Parse is also synchronous-call wall time and may include GC and scheduling effects. These are not CPU-profile results.
- `candidateOtherMs` is the residual after subtracting path-check, read, and parse time from each sample's readAndCandidate. Per-sample residuals are calculated before aggregation. The three stages are included in readAndCandidate and are not double-counted.
- Each iteration must have exactly one path check, read, and parse call. File events may be observed twice because add/change coalesce in the quiet window. Collection stops before selection, so `catalogDeltaMs: 0` is not a measurement of full-load cost.

End-to-end save→list/translation ack and selection-ready→translation ack use the same Node monotonic clock as before. They include ack cost and do not subtract control round trips. Browser setter→commit uses a separate clock. Do not add stage p95 values or subtract Node and browser clocks. Paint is not measured.

## Results

| Item | p50 | p95 |
| --- | --- | --- |
| Save→list DOM ack | 762.13 ms | 1,808.23 ms |
| Save→manifest broadcast | 744.03 ms | 1,787.18 ms |
| Selection ready→first-translation ack | 462.42 ms | 877.85 ms |
| Selection→first-translation commit (browser) | 458.70 ms | 873.00 ms |
| Control round trip | 7.28 ms | 14.50 ms |
| queue→drain | 51.43 ms | 64.01 ms |
| readAndCandidate (including file stages below) | 579.69 ms | 1,206.91 ms |
| Path check | 1.44 ms | 45.39 ms |
| UTF-8 read | 3.03 ms | 191.45 ms |
| Catalog parsing | 575.99 ms | 1,132.23 ms |
| candidate residual | 1.00 ms | 54.41 ms |
| Translation preparation and validation | 80.61 ms | 148.24 ms |
| Final active validation | 0.06 ms | 0.11 ms |
| registry replace | 0.13 ms | 2.16 ms |

Parsing time was larger than every other individual collected stage in all 10 measurements. Calculating parse/readAndCandidate per sample, the minimum share was 80.21%. This is a share of the read and candidate interval, not of total save→screen time or CPU usage. Costs such as watcher-event arrival and manifest creation and transmission were not separated.

In all 10 measurements there was one drain and one path check, read, and parse, with at most two file events. There were zero new-catalog responses before list confirmation and one full response without baseline after selection in every iteration. Response JSON p95 was 4,421,174 B and is not total physical network bytes including WS headers, compression, or manifest. Input nodes, values, and React state remained, with no additional readiness or reload. Generated `.d.ts` mtime and size also remained unchanged.

## Verification and interpretation

Two small instrumentation runs, two existing edit plus server-file-stages runs, and two uninstrumented locale-add runs also executed in a real browser. The default locale-add mode was checked to ensure it emits no server instrumentation fields. Raw-sample statistics, instrumentation call counts, residuals, wire conditions, and code hashes were compared. Temporary fixtures, browser profiles, and browser processes were absent after shutdown. Because there was no product change, the full test suite and release check were not repeated.

The existing [50-run uninstrumented measurement](12-locale-add-measurements.md) had large list p95 3,437.01 ms, while this run had 1,808.23 ms; execution time, load, sample count, and instrumentation presence differ. This is not interpreted as a performance improvement. It is a single run that identified major collection costs in the current structure, and it had not yet achieved the 250 ms target.

The follow-up simplified message-parser optimization and cold cross-comparison are in [15-simple-message-parser.md](15-simple-message-parser.md). Locale-aware ICU handling, error positions, duplicate-ID rejection, and immutable catalog contracts must remain unchanged. This step 14 record did not include a parser change or optimization of full responses after selection.
