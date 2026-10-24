# 20. Locale addition remeasurement after the AST freezing optimization

This document records conditions before relative-position sharing. The follow-up measurement with the same configuration is in [23-position-sharing-locale-add.md](23-position-sharing-locale-add.md).

On 2026-10-07 KST, I remeasured locale addition with local code that included simple-message parsing, compact transport, argument-schema sharing, and the AST freezing optimization. List-render p95 was 153.98 ms for small and 1,056.40 ms for large. In this run, small met the 250 ms target while large exceeded it.

## Run conditions

```sh
npm run build
node benchmarks/live-update/run.mjs --mode locale-add --out benchmarks/results/locale-add-ast-freeze.json
```

The measured revision was `da3386691a3f28860f5a12ccfd77e04c50f78ad1`, and the worktree was clean at the start. Runtime source and benchmark code were not changed in this work. The summary is in [locale-add-ast-freeze.json](../benchmarks/results/locale-add-ast-freeze.json); raw samples are in [small samples](../benchmarks/results/locale-add-ast-freeze.1k-3-locales.samples.json) and [large samples](../benchmarks/results/locale-add-ast-freeze.10k-20-locales.samples.json).

The configuration matched the initial [50-iteration record](12-locale-add-measurements.md): 5 warmup runs per scale, 50 measured runs, 25 control round trips, and a 30-second timeout. The CPU profiler and detailed server/browser measurements were disabled, while the Saylo and React dependency prebundle and typegen were enabled. The environment was Node 24.18.0, Windows x64, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, Ryzen 5 7430U, with 31.3 GiB memory.

| fixture | initial files and locales | messages/file | initial JSON total | JSON added per iteration |
| --- | --- | --- | --- | --- |
| small | 3 | 1,000 | 110,292 B | 36,781 B |
| large | 20 | 10,000 | 7,755,280 B | 387,783 B |

There is one `bench` namespace. Each iteration creates a new en-GB directory and one JSON file, verifies the list DOM, and then selects the language automatically. After confirming the first translation, it returns to en, deletes the file and empty directory, and verifies that the entry disappears from the list. ko and en are loaded initially; en-GB is not loaded before selection. The app and existing formatter are warm, but the added catalog and new probe formatter are loaded for the first time.

## Completion points and results

Save → list ack spans from completion of Node's writeFile to receipt of the ack body at the browser list DOM commit. Selection → first translation commit spans from immediately before browser setLocale to the useLayoutEffect that makes the new probe copy appear in the DOM. Selection preparation → translation ack spans from receipt of the Node control request through receipt of the translation ack, including control-response and ack costs. It performs no cross-clock subtraction, control-cost subtraction, or summing of stage p95 values. Statistics use nearest rank; paint and actual mouse-input latency were not measured.

| metric | small p50(ms) | small p95(ms) | large p50(ms) | large p95(ms) |
| --- | --- | --- | --- | --- |
| Save → list DOM ack | 104.38 | 153.98 | 507.84 | 1,056.40 |
| Selection → first translation commit (browser) | 31.20 | 44.40 | 268.40 | 360.20 |
| Selection preparation → first translation ack (Node) | 34.55 | 48.50 | 271.34 | 363.55 |
| Save → first translation ack | 145.31 | 193.21 | 782.75 | 1,339.99 |
| Save → manifest broadcast | 97.38 | 147.90 | 486.69 | 1,038.74 |
| File write | 6.83 | 8.44 | 9.64 | 15.05 |
| Control round trip | 4.08 | 12.27 | 3.87 | 6.02 |

The 250 ms list-render target was met in 50/50 small runs and 0/50 large runs. For large, the minimum was 319.20 ms and the maximum was 6,869.99 ms. The maximum manifest broadcast in the same run was also 6,552.60 ms, so catalog transport after selection alone cannot explain the list latency. Detailed instrumentation was disabled in this run, and I cannot establish whether parsing, validation, GC, or scheduling was responsible.

The initial 50-iteration run had a list p95 of 226.86 ms for small and 3,437.01 ms for large, and a selection → first translation commit p95 of 64.70 ms and 843.70 ms. A later run with the same fixture and configuration observed lower values, but several product changes landed in between and the run load differed. I do not attribute the entire reduction to the single AST freezing change. The preceding [compact record](16-compact-catalog-transport.md) used only large with 10 measured runs, 2 warmups, 10 controls, and server instrumentation enabled, so it is not a direct before/after comparison with this 50-iteration run.

## Transport, state preservation, and validation

In all 50 measured runs there were zero en-GB catalog responses before selection and exactly one full response without a known baseline after selection. The encoding was `saylo-catalog-v1`. Response-object JSON p95 was 119,641 B for small and 1,241,403 B for large. These values are not physical network bytes including WebSocket headers, compression, and manifests.

During every list-add, language-selection, and deletion commit in the actual browser, the input node identity, entered value, and changed React component state were preserved. I also confirmed the first translation DOM, the selected locale, and the return to baseline on each iteration. The runner treats an unexpected document reload as a failure, and this run completed. Generated `.d.ts` files retained their mtime and size at both scales.

For each raw file, I reconciled 55 rows, 50 measured rows, unique tokens, six timing summaries, the 25-run control summary, full and pre-selection response bytes, input/reply bytes, and code SHA-256 values. The full workspace build passed, and after completion no owned temporary fixture/profile directories or benchmark browser processes remained. Because no product changes were made, I did not repeat the earlier 164 tests, consumer typecheck, release check, or pack.

## Next work and limitations

The next task is to subdivide and measure the server-side parsing, translation preparation, and validation portions of the current large locale addition with the existing `--server-file-stages` option. The parser changed after the earlier [measurement 14](14-locale-add-server-measurements.md), so I do not treat its stage proportions as the current bottleneck. New measurements will determine the next implementation target.

This record covers one machine, one run, one namespace, one valid translation file, and DOM updates for one probe message. It does not guarantee performance for multiple namespace additions, invalid translations, full-message rendering, cold startup, or paint. Large still misses the list-render target, and I do not claim stable achievement of it. The follow-up runtime optimization is not yet present in npm `0.1.0-alpha.1`.
