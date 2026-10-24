# Paraglide development update comparison

Uses the React, ReactDOM, and Vite installation at the repository root as-is. Paraglide and the React Fast Refresh plugin are installed separately in this directory and are not added to the product package's dependencies.

```sh
npm --prefix benchmarks/paraglide ci --workspaces=false --no-audit --no-fund
node benchmarks/paraglide/run.mjs --samples 10 --warmup 2 --calibrations 10 --timeout-ms 300000 --out benchmarks/results/paraglide-edit.json
node benchmarks/live-update/run.mjs --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/saylo-comparison-edit.json
```

Do not run the two commands at the same time. Saylo requires the existing workspace build. The scenarios and the default options of 50 samples, 5 warmups, and 25 controls are the same as the Saylo harness. It also supports `--scenario`, `--browser`, `--timeout-ms`, and `--out`.

## Conditions

- Uses the same fixture generator. Each fixture is 1,000 messages per locale × 3 locales or 10,000 messages × 20 locales, with one JSON file per locale. The only edit is one English `probe` value. Only `probe` and the unmodified `message1` are displayed.
- Uses Paraglide 2's Vite plugin, React Fast Refresh, the development default `locale-modules` output, and the default cookie/globalVariable/baseLocale strategies. It measures the default JS/JSDoc type inference path with `emitTsDeclarations: false`. This does not mean the same typegen workload as Saylo's declaration file generation.
- Copies the installed message-format plugin into the fixture. CDN requests are not mixed into repeated measurements or startup. Translation values are strings both tools handle in common and simple `{name}`. Full ICU support is not compared.
- Initial project metadata file creation and the pre-compile are recorded separately in `fixturePreparationMs`. Vite boot and browser boot are also separated. Because of the pre-compile, this cannot be used for cold startup comparisons.
- Waits for the compiler's public Vite hook to complete so edit rounds do not overlap. The 100 ms settle period after the hook promise resolves is placed only before the next edit starts and is excluded from the save→ack measurement. The product compiler source and generated output are not modified for instrumentation.
- Measures from Node `writeFile` completion to receiving the HTTP ack body after the DOM commit on the same monotonic clock. It includes ack delivery cost and does not subtract the control round-trip value. The browser's commit→ack dispatch uses a separate clock. Paint is not measured.
- Counts reloads by document UUID. Creates the baseline by changing the input value and React state only in the first document, and does not re-inject them after a reload. Records input node, value, and component state preservation for each round.
- Raw samples include warmup and are excluded from the summary. p95 is nearest-rank. With 10 samples, p95 is the maximum, so it cannot support a claim of a wide distribution or stable target attainment.
- Records the SHA-256 of selected files, both lockfiles, actual tool versions, and Git working state. On exit, closes the browser process tree and Vite, and deletes only the temporary fixtures and browser profiles it owns.

## Locale-add mode

```sh
node benchmarks/paraglide/run.mjs --mode locale-add --scenario 1k-3-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/paraglide-locale-small.json
node benchmarks/live-update/run.mjs --mode locale-add --scenario 1k-3-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/saylo-comparison-locale-small.json
```

Writes bench.json into a new en-GB directory, then also adds en-GB to settings.locales. The save→list measurement runs from **the point both saves finish** to the HTTP ack confirming the select option in the DOM. The interval between the file save and the settings save also stays in the raw samples. Directory creation and content preparation are excluded. Because Saylo does not need a settings change, this is not a save experiment with the same number of files.

After the list is confirmed, it measures from when the server receives the `/selecting` request to the ack of the first translation commit for the default `setLocale('en-GB')`. It uses default document navigation as-is. Because the browser clock from the other document is not subtracted, the browser setter→commit is not reported. Only the initial boot sets en with `reload:false`; the actual measurement and the return to en use the default setter.

After returning to en, it removes en-GB from settings and deletes the file and directory. It confirms the option removal and compiler idle, then starts the next round. Because the generated locale function may be sent before selection, this is not the same task as Saylo's cold full catalog load. Catalog wire bytes and not-loaded conditions are not forced to match.

Records the reload count in the list display/selection phase and whether the initially created input node, value, and React state were preserved. The initial baseline state is created only in the first document of the run, including warmup. Delayed reloads immediately after initialization and deletion are included in the total document count but not in the reload count of either measurement interval.

Other compiler options, production bundles and SSR, and whether a thin layer over i18next/Wuchale satisfies the contract are out of scope for this benchmark. For the record of large initial compile failures, see [the comparison document](../../docs/13-paraglide-comparison.md).

Official sources: [Vite configuration](https://paraglidejs.com/vite), [locale strategies](https://paraglidejs.com/basics), [inlang settings](https://inlang.com/docs/settings). The default output and compiler hooks of the actual installed version were also checked in the installed package source.
