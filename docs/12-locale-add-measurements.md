# 12. Locale Addition Measurements

This document records the initial 50-run measurement. Follow-up measurements under the same settings after optimization are in [20-locale-add-remeasurement.md](20-locale-add-remeasurement.md).

In a single local run on 2026-10-07 KST, p95 for displaying a newly added locale in the list was 226.86 ms for small and 3437.01 ms for large. Small met the 250 ms target in this run, while large greatly exceeded it. Because this was a single run, it does not establish stable achievement or general app performance. Follow [10-performance-measurements.md](10-performance-measurements.md) and [11-parser-measurements.md](11-parser-measurements.md) for existing copy-edit and parser records.

## Execution and conditions

The 10-run small comparison with Paraglide is recorded separately in [13-paraglide-comparison.md](13-paraglide-comparison.md). It differs from the 50-run measurements here in sample count, load, and timing, so do not combine the figures.

```sh
npm run build
node benchmarks/live-update/run.mjs --mode locale-add --out benchmarks/results/locale-add.json
```

This time the second command reused the same runtime built for the preceding optimization. Originals are in [locale-add.json](../benchmarks/results/locale-add.json) and the per-scenario raw samples it references. The reference revision is `8ab4e5e`; locale-specific app, channel, fixture, and runner changes on top are identified by `workingTreeStatus` and `codeHashes`. Product library source and `dist` were not changed in this work.

The setup was 5 warmups followed by 50 measurements and 25 control round trips. CPU profiling and detailed server and browser stage instrumentation were off, and existing Saylo and React dependency prebundle was used. The environment was Windows x64, Node v24.18.0, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, Ryzen 5 7430U, and 31.3 GiB memory. It used React development mode with the actual Vite watcher and WS and a headless browser DOM commit. Paint was not measured.

| Fixture | Initial locales/files | Messages/file | Initial JSON total | New JSON | Namespace |
| --- | --- | --- | --- | --- | --- |
| small | 3 | 1,000 | 110,292 B | 36,781 B | 1 bench |
| large | 20 | 10,000 | 7,755,280 B | 387,783 B | 1 bench |

Initially it loads ko base and en target and displays one `bench:probe` message from en. Each iteration adds one new `en-GB/bench.json` file. The new file has the same keys and argument contract as the en catalog and changes only probe copy to an iteration-specific token. The app and existing formatters are warm, but the new target catalog and its probe formatter load for the first time.

Each iteration creates a new directory, then saves JSON. Directory creation and JSON-content preparation are excluded from save latency, but the Vite watcher's discovery of the new directory and file is included after save completion. After confirming the list, it automatically calls `setLocale('en-GB')`. Once the first translation is confirmed, it returns to en and deletes the file, waits for a DOM commit in which en-GB disappears from the list, and removes the empty directory. The next iteration starts from the same baseline without en-GB. Server metadata retains the same pair's version/tombstone history, but the client sends a full request without a known baseline every time.

## Completion points and clocks

- `saveToListAckMs`: from completion of Node's `writeFile` Promise until the browser confirms the DOM commit where the en-GB option appears in the `<select>` and the ack body reaches Node. The 250 ms target is judged against this value.
- `selectToCommitMs`: from immediately before the browser calls `setLocale` until the `useLayoutEffect` where en-GB is selected and the iteration's new probe copy appears in the DOM. This is a same-browser-clock value covering the actual selection action and first translation.
- `selectToTranslationAckMs`: from Node receiving the selection-ready control request until the first-translation DOM ack. It includes the HTTP control response up to setter execution and ack delivery and is reported separately.
- `saveToTranslationAckMs`: from save completion to first-translation ack on the same Node clock. It includes HTTP cost for the list ack and automatic selection reconciliation; there is no human selection wait.
- `saveToBroadcastMs`: from save completion to immediately before the `ws.send` call for the manifest including the new locale.

Do not subtract Node and browser clocks from each other, and do not subtract or add control round trips or per-stage p95 values to/from total latency. Statistics use nearest rank. Language selection automatically calls the same `setLocale` path as the UI `onChange`; this does not measure input latency from a physical mouse click.

## Results

| Metric | small p50 | small p95 | large p50 | large p95 |
| --- | --- | --- | --- | --- |
| Save→list DOM ack | 132.58 ms | 226.86 ms | 1093.41 ms | 3437.01 ms |
| Selection→first translation commit (browser) | 42.10 ms | 64.70 ms | 465.50 ms | 843.70 ms |
| Selection ready→first translation ack (Node) | 45.14 ms | 70.56 ms | 469.98 ms | 847.56 ms |
| Save→first translation ack | 183.08 ms | 285.05 ms | 1556.27 ms | 4016.01 ms |
| Save→manifest broadcast | 127.38 ms | 221.15 ms | 1072.66 ms | 3420.35 ms |
| File write | 5.22 ms | 7.96 ms | 16.99 ms | 100.28 ms |
| Control round trip | 3.76 ms | 13.08 ms | 3.59 ms | 5.47 ms |

For large, list-display max was 14275.76 ms and fileWrite max was 252.35 ms. No separate load profile was measured, so the cause is not established. Server stages before list display were also large, so catalog transport volume alone does not explain total latency. Unlike an existing-copy edit, a cold file parses ICU and validates all message translations.

In all 50 measurements, there were zero new-target catalog responses before the list ack and exactly one full present response without a known baseline after selection. The catalog response object JSON p95 was 437,413 B for small and 4,421,175 B for large. New input JSON p95 was 36,781 and 387,783 B. Response size covers the serialized object including AST, positions, argument schema, and envelope; it is not physical network bytes and excludes manifest, WS headers, and compression. The cost of receiving a full new catalog for the first time is the next target for comparison and optimization.

## Verified behavior and limitations

Each raw file contains 55 runs (50 measured). Six timing and control summaries, input/reply byte aggregates, unique tokens, exactly one full response and zero responses before selection, and measurement-code hashes were checked. Each iteration confirmed the list option, selected locale, and probe DOM; input values changed after initial mount, input-node identity, and component state remained through list addition, language switching, and deletion. An unexpected page reload fails measurement. Generated `.d.ts` mtime and size also matched the initial values. The run confirmed deletion and return to en through the final iteration, and temporary fixtures, browser profiles, and corresponding browser processes were gone afterward.

Small two-iteration locale-add smoke tests and one existing edit-mode smoke test also passed. Because no product code changed, the full existing tests, release check, and pack were not repeated. This record covers a normal translation with one namespace, one new file, and the full key count. It does not extend to adding multiple namespaces at once, incomplete or invalid translations, a cold server, paint, full UI message rendering, or comparison with other libraries. The measurement app displays only the probe message.

Locale addition and input-state preservation work, but the large 250 ms performance target is not met. The later small Paraglide comparison is in [13](13-paraglide-comparison.md), and server-stage instrumentation for large locale addition is in [14](14-locale-add-server-measurements.md). The next optimization target is cold parsing of the new catalog. This measurement used the local checkout runtime; recent optimizations were not included in npm `0.1.0-alpha.1`.
