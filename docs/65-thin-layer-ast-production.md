# 65. Thin-layer AST-only production formatter

## Scope

This records closing the production parser-free gate left unmet in [64](64-thin-layer-timezone-adapter.md). The code is in commit `d04c841`. The work applies to a `benchmarks/thin-layer` benchmark helper; product packages and public APIs did not change.

## Helper (`ast-runtime.mjs`)

- It is a benchmark-only Vite plugin whose `apply` is limited to builds.
- It rewrites only the `intl-messageformat` import used by the dedicated formatter `ast-format.mjs` to a virtual module. Other string-based IMF consumption paths remain unchanged.
- In the supplied IMF entry source, it replaces the `@formatjs/icu-messageformat-parser` import with the official `no-parser.js`. Vendor helper dependencies resolve relative to the original source file location.
- Unsupported imports, entries, or vendor boundaries are rejected with an explicit throw.

## Results

The same three-message English and Russian eager fixture was built as four real Vite production builds. They are unminified, target esnext with lib es and write false, and each single chunk is run from a data URL in Node.

| variant | unminified (bytes) | gzip (bytes) | parser entry | no-parser entry | marker |
| --- | --- | --- | --- | --- | --- |
| core | 54300 | 15417 | 1 | 1 | false |
| layer | 188261 | 47449 | 2 | 1 | true |
| layer-ast | 136211 | 35363 | 1 | 2 | false |
| layer-ast-mixed | 199618 | 50008 | 2 | 2 | true |

- All four outputs pass the greeting `Hi Ada`, fallback plural `0 rows`, default UTC date and time skeleton `1/1/2026 / 00:30`, and rejection of an unknown key or missing argument.
- `layer-ast-mixed` also executes an unrelated raw-string `IntlMessageFormat` path and verifies `External Ada`; that path retains the parser.
- The marker is the emission marker `EXPECT_ARGUMENT_CLOSING_BRACE`. `layer-ast` has no marker and two no-parser entries. The index entry does not disappear completely from the graph; it can remain for TYPE exports, while the absence of the marker together with the no-parser graph supports the tested formatter's AST boundary.
- Sizes are fixture observations, not a general bundle coefficient or performance and memory measurement.
- The [three-message raw results](../benchmarks/results/thin-layer-production-ast-runtime-2026-10-11.json) are the execution record for `d04c841`.

## Costs and remaining goals

- Rewriting the source dependency adds build glue. It is part of the maintained code and must be checked in CI against future IMF major versions.
- Determination: the prototype's standalone runtime AST-only gate and the tested small fixture's production parser-free gate are closed.
- SSR hydration, lazy loading, the full contract, large-scale performance, and the production browser remain.
- Reproduce with `node benchmarks/thin-layer/production-probe.mjs --out benchmarks/results/thin-layer-production-ast-runtime-2026-10-11.json`.

## Extended format vectors (`fc4b7ba`)

- The probe has an optional `--vectors` flag. Without it, the default three-message fixture preserves the original reproduction behavior. The small-fixture numbers above remain the record from that point in time. Because the harness source fingerprint changed, the earlier execution is not treated as a run of the current source.
- `--vectors` adds 11 distinct messages and 12 execution paths: decimal, currency number skeleton, named percent, datefull, date skeleton, default time, ordinal 22nd, selection Alpha, date branches in nested plurals, select and time branches, a literal `<b>` tag, and reserved `lng`, `ns`, and `count` strings.
- Four real production builds run unchanged, and all 48 format comparisons (12 per output) pass. The original greeting, plural, date, and error assertions and the mixed `External Ada` case also continue to pass.
- Parser markers remain false for core and `layer-ast`, and true for `layer` and `layer-ast-mixed`, matching the small fixture.
- Extended-fixture sizes are 70477 unminified and 16968 gzip for core, 203551/49161 for `layer`, 151501/37056 for `layer-ast`, and 214908/51716 for `layer-ast-mixed`. These must not be mixed with the small-fixture values above.
- [Raw results](../benchmarks/results/thin-layer-production-ast-vectors-2026-10-11.json). Reproduce with `node benchmarks/thin-layer/production-probe.mjs --vectors --out benchmarks/results/thin-layer-production-ast-vectors-2026-10-11.json`.
- Product source did not change, so the full root check was not run.

## Follow-up (`49c21e2`)

The production parser boundary in this document was carried through to a real SSR hydration test. [66](66-thin-layer-ssr-production.md) hydrates a production client with the same benchmark-only formatter, and the parser marker remains false. The measurements and determination above remain valid.

## Follow-up (`e208980`)

The same production client was later checked across a real Chromium host-time-zone matrix. [66](66-thin-layer-ssr-production.md) records the initial nine pages and the later twelve-page result that includes the missing-pair fix.
