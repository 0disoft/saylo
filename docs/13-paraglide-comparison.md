# 13. Paraglide Comparison Measurements

On 2026-10-07, copy-edit application in Paraglide 2.25.4 was measured for the first time on the same machine. This record reports observations for the installed version, configuration, and fixture; it does not decide overall product superiority. Experiments that satisfy Saylo contracts through thin layers over i18next/Wuchale remain separate.

## Copy-edit conditions

The environment was Node 24.18.0, Windows, Vite 8.3.2, React/ReactDOM 19.3.0, and HeadlessChrome 154, with warmup 2, 10 measurements, and 10 controls. The two benchmarks did not run concurrently. Paraglide used React Fast Refresh 6.1.2, message-format plugin 4.4.5, and the default development output `locale-modules`. Tool dependencies were added only under the benchmark directory.

The fixture generator was the same as Saylo's. Small contained 1k messages across 3 locales (110,292 B), and large contained 10k across 20 locales (7,755,280 B), with one namespace. It changed one English `probe` value and rendered two translations. Syntax consisted of an ordinary string and simple `{name}`; it was not a full ICU comparison.

Measurement ran from completion of Node's `writeFile` through React DOM commit and receipt of the HTTP ack body. It includes ack delivery. Control round trips are not subtracted, and paint is not measured. A 10-run nearest-rank p95 is the maximum and is not treated as a stable distribution estimate.

Paraglide used its JS/JSDoc inference path with the default `emitTsDeclarations: false`. Saylo had declaration generation enabled but does not rewrite declarations after copy edits. This was not a comparison of identical typegen workloads. Precompile used to create Paraglide project metadata and Vite boot were excluded from application time and recorded separately. The harness waited for compiler-hook completion and a 100 ms quiet interval before the next iteration so edits did not overlap. This cannot be used for cold-startup comparison.

Follow [benchmark guide](../benchmarks/paraglide/README.md) for execution and detailed conditions. Results are in [Paraglide small](../benchmarks/results/paraglide-edit-small.json) and [Saylo same count](../benchmarks/results/saylo-comparison-edit.json). Raw samples also retain warmups. Code is identified by SHA-256 of executed code plus lockfile, versions, and worktree state.

## Results

Paraglide small save→DOM ack was p50 5,273.74 ms and p95 7,912.07 ms. Control round-trip p95 was 12.14 ms. All 10 measurements had zero document reloads and retained original input nodes, input values, and React state. The first full-scenario run also observed small p95 8,310.38 ms and state retention in 10/10 runs. That execution failed in the following large scenario and could not save summary metadata; only its [raw samples](../benchmarks/results/paraglide-edit.1k-3-locales.samples.json) remain. The harness was then changed to save metadata for every successful scenario.

The same-count Saylo small run was p50 71.98 ms and p95 127.64 ms; large was p50 250.72 ms and p95 342.83 ms. This run also exceeded the 100 ms target, so it is not replaced by earlier 50-run figures that met the target. The tools ran at different times and loads and use different type-generation approaches, so no multiple improvement or general superiority is claimed.

## Large failure observation

Paraglide large failed during fixture precompile before Vite and the browser started. Installed lower-level dependencies were `@inlang/sdk` 3.1.0 and `@lix-js/sdk` 0.19.0. The worker returned `Lix transaction.commit did not settle within 60000ms`, and the final error was `LIX_WRITE_OUTCOME_UNKNOWN`. Command, code revision, cause, dependency lockfile, and observation time are in the [failure record](../benchmarks/results/paraglide-edit-large.failure.json).

This was one observed initial-preparation failure. It was not a save→screen timeout and is not a general Paraglide scale limit. No p50, p95, or speed relative to Saylo is calculated for this scenario. The harness `--timeout-ms` controls browser and channel waits and does not change Lix's internal 60-second deadline. The exact cause and behavior with other SDK or compiler settings are unverified.

## Locale-addition conditions

For locale addition, each iteration creates a new en-GB bench.json in the initial small fixture and updates settings.locales with it. The Node clock starts after **both saves**, the file and settings, and ends when the list-option DOM-confirmation ack arrives. Saylo writes only one catalog file without changing settings, so the two use different save counts. Both harnesses exclude directory creation and content preparation from save latency.

The same Node clock runs from when the server receives the selection-readiness request after the list ack until the first-translation DOM ack. Paraglide uses the full document navigation of its default `setLocale()`. Because the document changes, the browser-clock setter→commit interval is not calculated. Only initial boot sets en with `reload:false`; measurement uses the default setter. The [official locale docs](https://paraglidejs.com/basics) distinguish default navigation from the `reload:false` exception.

Paraglide's generated locale function may reach the browser before selection. Saylo fetches the unloaded target as a full catalog for the first time after selection. Selection→translation figures therefore observe these two user flows and are not an identical cold-fetch cost comparison. Paraglide catalog wire bytes are not measured. Do not sum p95 values or subtract clocks across processes or documents.

Initial input nodes, values, and React state are created only in the first document. They are not reinjected after reload. If warmup loses state, later measurements record a preservation failure relative to the initial reference. List refresh and selection reloads are distinguished; delayed reloads after returning to en and deletion count only toward total documents. The harness waits for removal of the option and compiler idle before starting the next addition.

## Locale-addition results

Both tools ran small with warmup 2, 10 measurements, and 10 controls. Results are in [Paraglide](../benchmarks/results/paraglide-locale-small.json) and [Saylo](../benchmarks/results/saylo-comparison-locale-small.json), each referencing raw sample files.

| Interval | Saylo p50 / p95 | Paraglide p50 / p95 |
| --- | --- | --- |
| Save completion→list DOM ack | 136.14 / 183.04 ms | 4,801.88 / 7,447.99 ms |
| Selection ready→first-translation DOM ack | 41.69 / 69.32 ms | 107.60 / 199.00 ms |
| Save completion→first-translation DOM ack | 180.91 / 245.45 ms | 4,919.45 / 7,636.68 ms |
| Control round trip | 2.96 / 5.84 ms | 5.22 / 8.32 ms |

Paraglide had one document reload during list refresh and one during selection in all 10 measurements. Initial input-node, value, and React-state retention at those two stages was 0/10 each. Total documents, including warmup, return to en, and deletion, was 49. It retained state for copy edits with the same fixture, so this is not extended to a claim that every Paraglide edit loses state.

Saylo passed a harness that fails if any additional document readiness occurs during warmup or measurement. Each DOM commit also checks that input nodes, values, and React state match the initial reference. All 10 measurements had zero catalog responses before target selection and one fresh full response after selection. Catalog response JSON p95 was 437,410 B, not total physical network bytes. Generated declaration files were not rewritten.

In this small run, Saylo list p95 was within the 250 ms target. This does not resolve the failure to meet the target in the existing [50-run large measurement](12-locale-add-measurements.md). Paraglide large was not repeated in locale-add mode because precompile failed earlier at the same initial catalog scale. Large locale-addition comparison is incomplete. This comparison does not decide application-owned reactivity beyond the default setter, SSR, URL routing, or other compiler configurations.

Results were checked through Node syntax checks, repeated real headless Chrome runs, and recalculation of nearest-rank statistics from raw samples. Temporary directories, browser profiles, and browser processes from both benchmarks were absent after shutdown. Product source and APIs were unchanged, so the full product test suite and release check were not run. Results and benchmark changes were local commits and did not update npm published builds.

## Remaining checks

- Separate the cause of the large initial-compile failure and remeasure conditions where it succeeds.
- Assess load effects with repeated runs and more samples.
- Determine whether thin layers over i18next/Wuchale extension points satisfy Saylo's contracts.

Official documentation: [Vite](https://paraglidejs.com/vite), [locale strategy and selection](https://paraglidejs.com/basics), and [project settings](https://inlang.com/docs/settings). The installed version's default development output and hook behavior were also checked in the actual package source.
