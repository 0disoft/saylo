# 61. Superseded parse reuse and multi-read reproduction

This document records the case where the single-read assertion in [60-next-turn-additions.md](60-next-turn-additions.md) actually failed and the superseded-parse reuse added while reproducing that failure. Discarding a successful parse of a new path on a generation mismatch caused duplicate cold parses of the same file; the result is now passed through a per-file map for reuse by the latest read. This is not an optimization that makes the initial cold parse itself faster.

## Reproduction (the assertion failure in 60)

This is based on the [failure trace](../benchmarks/results/new-additions-read-trace-2026-10-11.log) and [metadata](../benchmarks/results/new-additions-read-trace-metadata-2026-10-11.json).

| Item | Value |
| --- | --- |
| Watcher events | 2 |
| drain | 2 |
| pathcheck | 2 |
| read | 2 |
| parse | 2 |
| sourceLength | 387783 in both reads |
| Parse result | Valid in both runs |
| hasPrevious | `false` in both reads |

- The file instrumentation in 60 assumed that after read only once. It actually read twice and parsed twice.
- Relative to the sample start, the first parse interval was 34.4474→151.0838, or 116.6364 ms.
- The second parse interval was 154.1388→284.511, or 130.3722 ms. Two actual boundaries, 117 ms and 130 ms, were observed.

## Cause

When a follow-up event arrives while a new file is being processed, the first read's result is not published because its generation is no longer current. The successful parse result was also discarded, leaving no previous catalog for the next read. In this trace, both reads parsed valid input of the same length without a previous catalog.

- The initial parse cost remains. This change passes a discarded successful parse to the next read as a reuse candidate.
- Equal length and successful parsing alone do not prove text identity. Actual reuse depends on comparing the latest source with provenance from the earlier successful parse.

## Product change (`c19ca34`)

- The `pendingParses` map stores only superseded successful `ParsedCatalog` values, keyed by file.
- The next read removes the value from the map before using it.
- The latest file text is always read again and passed to `parseCatalog(source, options, previous)`.
- The core provenance fast path is used only when the latest source and normalized context exactly match provenance from the earlier successful parse.
- If the text changed, ICU/JSON and translation-schema validation run as before.
- A cached result never goes directly to acceptance or publication; it must pass through the latest read and schema validation.
- `.accepted` publication happens only in the latest generation. Stop clears the map.
- If the newest read is invalid, the superseded older result is not published.
- Tests cover four cases: object identity reuse for identical content, propagation of changed latest content, last-good retention for invalid JSON, and rejection of an unknown argument in schema-invalid content that is otherwise unchanged.

## Validation

- The root `npm run check` passed on product source `c19ca34`: 223 tests in total.
- The breakdown is core 81, React 14, Svelte 14, typegen 9, Vite 100, and scripts 5.
- Consumer typechecks and the React example typecheck also ran.
- After the root `npm run check`, all 48 plugin tests, including an added tests-only schema case, passed. The full root pipeline was not repeated after that addition; product source is unchanged.
- The [native after trace](../benchmarks/results/superseded-parses-read-trace-2026-10-11.log) ([metadata](../benchmarks/results/superseded-parses-read-trace-metadata-2026-10-11.json)) still reads twice and parses twice. The first `hasPrevious: false` parse took about 139.71 ms; the second, with `hasPrevious: true`, took 0.3935 ms.
- Both traces exited 1 because they violated the single-read assertion. No aggregate p95 was produced, and this is not a schema-validation failure.
- The assertion was not relaxed; failed evidence is preserved unchanged.
- The [normal benchmark](../benchmarks/results/superseded-parses-locale-add-2026-10-11.json) used 25 samples, 5 warmups, 10 controls, and typegen enabled.

| Scenario | p50 | p95 | Within 250 ms | Maximum |
| --- | --- | --- | --- | --- |
| small | 93.54ms | 279.47ms | 20/25 | 352.05ms |
| large | 126.09ms | 247.25ms | 24/25 | 271.94ms |

- This time only the large scenario met the 250 ms goal; small did not. Stable achievement across both is unverified.
- Independent before/after trace wall times do not establish causality or an overall p95 improvement.
- Native Vite SSR recovered in all 5 cases ([source data](../benchmarks/results/superseded-parses-recovery-2026-10-11.json)), and the thin-layer prototype browser smoke passed all 8 gap-0 cases ([source data](../benchmarks/results/superseded-parses-browser-2026-10-11.json)).
- The browser smoke covers the prototype only and is not validation of the entire Saylo adapter.
- The change is supported by reducing duplicate cold parses while checking the latest reader text and schema; it is not an initial cold-parse optimization.
- The public API, dependencies, and versions are unchanged. The commits are local, with no push or publication.

## Reproduction

```sh
npm run build
node benchmarks/live-update/run.mjs --scenario all --mode locale-add --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/superseded-parses-locale-add-2026-10-11.json
```

No JSON aggregate is produced when the single-read condition fails. Use the following diagnostic command to retain stdout and stderr:

```sh
node benchmarks/live-update/run.mjs --scenario 10k-20-locales --mode locale-add --samples 25 --warmup 5 --calibrations 10 --server-file-stages --out benchmarks/results/superseded-parses-read-trace-2026-10-11.json > benchmarks/results/superseded-parses-read-trace-2026-10-11.log 2>&1
```

## Remaining goals

The next stated goal is stable performance. Remaining work includes support and accurate instrumentation for multiple stage reads, final decisions on the provisional owned-map and fast-additions choices, evaluation of the full thin-layer contracts across lazy loading, SSR, production, time zones, and performance, and the release decision. The long-term goal is not complete.

## Follow-up (`a0e47d5`)

The failed command above is a record from harness revisions `df094ba` and `e456`. Under v2, the same two serial superseded reads produced a successful aggregate with 1 publication, 2 parent windows, and operations 2/2/2. The fix is benchmark-only; product source `c19ca34`, shipped packages, dist, and clocks are unchanged. See [62-multi-read-measurements.md](62-multi-read-measurements.md) for details.
