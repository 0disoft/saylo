# 64. Thin-layer time-zone adapter and fix results

## Scope

This records the adapter fix for the time-zone item left unmet in [63](63-thin-layer-timezone.md). Code, tests, and results are in commit `5fec231`; production measurements are in `905f208`. The work applies only to the `benchmarks/thin-layer` prototype; product source, `packages/vite`, and versions did not change. This document covers the production build; SSR, hydration, lazy loading, and performance remain out of scope.

## Changes

- The main adapter implements the public `i18nFormat` module (`ast-format.mjs`) directly instead of using i18next-icu's ICU plugin.
- It uses `IntlMessageFormat` instances and a plugin-owned bounded cache: 256 messages, and 128 each for number, date, and plural.
- A new formatter is created for each engine and snapshot, and the supplied time zone is normalized to a canonical name. The default is UTC.
- Source ASTs, global `Intl`, and static `IntlMessageFormat.formats` are not modified.
- Date and time defaults, named styles, skeletons, skeletons inside a select, and source fallbacks all use the same time zone.
- `createLayer` in `i18next-layer.mjs` accepts and forwards a fourth options argument. It retains only the normalized value so later caller mutations cannot affect it.
- The maintained surface grew. The code retains IMF instances, caches, and the formatter module; this is not a one-line i18next-icu configuration change. This record covers that maintenance surface and does not measure its performance cost.

## Validation

- All five `timezone.test.mjs` tests pass: canonical aliases and rejection of invalid zones, isolation of concurrent requests plus immutability of shared ASTs and global formats, separation of old and new snapshots after replacement plus rejection of invalid candidates, fallback after removing the selected locale, and ignoring `options` mutation in the source adapter.
- Three Node hosts, 56 cases, and two paths (default UTC and explicit host) produced 336 comparisons. Default UTC mismatches were 0/0/0; explicit-host mismatches were 0/0/0.
- Bypassing native ICU `formats` is a separate reference in the probe. The v2 probe again observed the same 0/14/14 result, beyond just the value recorded in 63. It is not part of this fix.
- All 36 existing contract-probe cases pass. Browser and time-zone claims are separate from that probe.
- All eight browser stages pass: edit, invalid-json, recover-json, invalid-schema, recover-schema, locale-add, locale-select, and locale-remove-selected. The host is Asia/Seoul; each stage kept the default UTC date and time skeletons and the retained old snapshot in UTC while preserving DOM state.
- Source and dist baseline hashes match before and after the probe. Metadata hashes include dependency entry files and total 12.

## Production parser boundary risk

- `packages/vite/src/ast-formatter.ts` runs `intl-messageformat` as a separate target only when core dist `formatters.js` is the importer, and replaces its ICU parser import with `no-parser.js` inside that target.
- The IMF in the new `ast-format.mjs` is a separate target outside that boundary. This boundary alone could not prove parser removal and was a static risk at the time. The production build below verified it.
- Using AST resources alone does not make a bundle parser-free.

## Production build (`905f208`)

- The same small eager AST fixture (three demo messages in English and Russian) was built with Vite's real production pipeline, unminified, targeting esnext with lib es and write false, and the single chunk was imported from a data URL in Node to run snapshots.
- Runtime assertions cover the greeting `Hi Ada`, source-fallback plural `0 rows`, default UTC date and time skeletons `1/1/2026 / 00:30`, and rejection of an unknown key or missing argument.
- Size was 54300 bytes unminified and 15417 gzip for core, and 188261 bytes unminified and 47449 gzip for the layer. This is a fixture observation, not a general package-size coefficient or large production measurement.
- In the build graph, core had 1 parser entry and 1 no-parser entry; layer had 2 parser entries and 1 no-parser entry.
- Parser entries also export AST types, so graph presence alone does not prove that parser implementation is retained. The output was checked for the emission marker `EXPECT_ARGUMENT_CLOSING_BRACE`: false for core and true for layer. Bundle hashes were saved.
- The core schema's TYPE import places the index module in the graph, but parser code is tree-shaken. In the layer, the default IMF source import is independent, so the parser remains, and core formatter's private boundary does not cover this path.
- Therefore the prototype's production parser-free gate remained unmet; only basic runtime behavior was verified.

## Reproduction

```sh
npm --prefix benchmarks/thin-layer run test:timezone
node benchmarks/thin-layer/timezone-probe.mjs
node benchmarks/thin-layer/probe.mjs --out benchmarks/results/thin-layer-contracts-timezone-fixed-2026-10-11.json
node benchmarks/thin-layer/browser-smoke.mjs --out benchmarks/results/thin-layer-browser-timezone-fixed-2026-10-11.json
node benchmarks/thin-layer/production-probe.mjs --out benchmarks/results/thin-layer-production-parser-2026-10-11.json
```

- Raw results are in [timezone](../benchmarks/results/thin-layer-timezone-fixed-2026-10-11.json), [contracts](../benchmarks/results/thin-layer-contracts-timezone-fixed-2026-10-11.json), [browser](../benchmarks/results/thin-layer-browser-timezone-fixed-2026-10-11.json), and [production](../benchmarks/results/thin-layer-production-parser-2026-10-11.json).
- `timezone-probe.mjs` writes to a new file name when `--out` is omitted.

## Remaining goals

Remaining work includes SSR rendering and hydration, a three-time-zone browser matrix, lazy loading, the full contract and performance comparison, and the release decision. A real production build ran, but the layer carries the parser marker and still fails the parser-free gate; large catalogs, performance, and memory were not measured. This is a time-zone improvement within the Node and browser feature scope, not completion of the overall goal. No product source or version changed, and nothing was pushed or published.

## Follow-up (`d04c841`)

The production record above reflects `905f208` and remains valid as a historical record. The parser-free gate left open at that point was closed with a benchmark-only helper in [65](65-thin-layer-ast-production.md). The current source follows that later work.
