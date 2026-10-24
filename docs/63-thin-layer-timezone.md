# 63. Thin-layer time-zone contract probe

## Scope

This records the time-zone item left by [57](57-thin-layer-browser-probe.md) for the thin-layer assessment, observed in Node. It covers time-zone handling in the current catalog layer (`benchmarks/thin-layer/catalog-layer.mjs`) and public i18next-icu configuration. Browsers, SSR hydration, and performance are out of scope, and product source did not change.

## Conditions

- Node v24.18.0 runs i18next 26.4.3, i18next-icu 2.5.0, and intl-messageformat 12.1.3, as measured in the installation.
- `UTC`, `Asia/Seoul`, and `America/Los_Angeles` are each set as `TZ` for an independent child process. Each child asserts that `Intl.DateTimeFormat().resolvedOptions().timeZone === process.env.TZ` to verify that the time zone took effect.
- Two fixed instants (`2026-01-01T00:30Z` and `2026-06-30T23:30Z`) are crossed with two argument types (millisecond number and `Date`) and 14 execution paths, yielding 56 observations per host and 168 in total.
- The 13 messages cover `{at, date}`, `{at, time}`, two skeletons, a skeleton nested in a select, and four each of named date and time styles. The select runs both its date and time branches. `datefull` is omitted from the Russian translation so the English source fallback path is also exercised.
- The global `Intl`, static `formats` object, and source ASTs are not modified.

## Results

The reference is the core `createTranslator` running in UTC. Host-time-zone values run alongside it to show whether the current layer matches the host.

| Host | Cases | Layer ≠ UTC | Public named ≠ UTC |
| --- | --- | --- | --- |
| UTC | 56 | 0 | 0 |
| Asia/Seoul | 56 | 42 | 14 |
| America/Los_Angeles | 56 | 42 | 14 |

- The current layer matches the host time zone in every case. The time zone comes entirely from the host.
- The current layer has no time-zone option. `createCatalogLayer` init has no `timeZone`, and `ValuesICU.parse` passes only `options.values`.
- On both non-UTC hosts, the layer differs from the UTC reference in 42 cases. Date-only IDs differ at one instant (two cases), and time IDs differ at both instants (four cases).

### Public formats workaround

A separate instance overwrote every named date and time style in `IntlMessageFormat.formats` with `timeZone: 'UTC'` for comparison.

- Named `short`, `medium`, `long`, and `full` styles and the `{at, time}` default match the UTC reference.
- A 14-case gap remains: 2 `{at, date}` defaults, 2 `{at, date, ::yyyyMMdd}` cases, 4 `{at, time, ::HHmm}` cases, and 6 skeletons nested in a select.
- The `formats` option can pin named styles and the default time using `medium`, but the default date without a style and skeletons still use the host time zone with this configuration.

## Installed-package evidence

- `benchmarks/thin-layer/node_modules/i18next-icu/dist/es/index.js` calls `new IntlMessageFormat(res, transformedLng, this.formats, { ignoreTag: true })`. Its only per-call channel is `formats`.
- `IcuConfig` in the same package's `index.d.ts` exposes only `memoize`, `memoizeFallback`, `formats`, `bindI18n`, `bindI18nStore`, `parseErrorHandler`, `parseLngForICU`, and `escapeVariables`; it has no formatter-injection option.

## Interpretation

- These results show the current prototype's time-zone gap; they are not proof of a vendor defect or that time-zone support is impossible.
- Two workarounds are possible: a custom `i18nFormat` implementation using i18next-icu's public extension point, or per-instance AST adaptation. Neither had been implemented.
- Either approach must leave source ASTs, global `Intl`, and static `formats` intact and also validate caches, snapshots, and request isolation.
- Determination: the thin layer does not meet the time-zone contract.

## Validation and raw results

- Before and after execution, the probe compared hashes for the probe, `catalog-layer`, `package-lock`, core formatter and translator source and dist, and dependency entry files. It verified that they were unchanged and recorded the hashes in the result file.
- The [raw results](../benchmarks/results/thin-layer-timezone-2026-10-11.json) contain all 56 rows for each host.
- Reproduce with `node benchmarks/thin-layer/timezone-probe.mjs`; use `--out` to change the output path.

## Remaining goals

The thin-layer time-zone item remains unmet. Lazy loading, production, the full contract and performance comparison, and the release decision also remain. This record covers one Node observation and does not complete the overall goal.

## Follow-up (`5fec231`)

The 42- and 14-case figures in this document come from the v1 probe (`saylo-thin-layer-timezone-v1`); they are not the current gap. The v2 probe uses UTC as the default expected value and finds no differences for either default UTC or explicit host time zones. Reproducing the original measurements requires the scripts at `a35af08` and `eb1986a`. See [64](64-thin-layer-timezone-adapter.md) for the fix and new observations.
