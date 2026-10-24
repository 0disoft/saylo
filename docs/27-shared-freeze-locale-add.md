# 27. Locale addition remeasurement after sharing the deep-freeze path

Under the normal prebundle configuration, list-render p95 was 112.42 ms for small and 621.18 ms for large. Large missed the 250 ms target, and the first-translation selection p95 was also higher than in the previous run with the normal configuration, so overall improvement was not confirmed.

## Run and conditions

The measured revision was `7a27b043bf71262d7a1e74e08ed24b8e18ec1fdc`, and the worktree was clean at the start. I reused the dist built and verified by the preceding implementation. The hashes of the loaded code match the [verified shared-freeze run](../benchmarks/results/locale-add-shared-freeze-after.json) and current files. This work changed only results and documentation.

```sh
node benchmarks/live-update/run.mjs --mode locale-add --scenario all --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/locale-add-shared-freeze.json
```

This ran on 2026-10-07 KST under Node 24.18.0, Windows x64, Ryzen 5 7430U, Vite 8.3.2, React 19.3.0, and HeadlessChrome 154. The environment, browser, fixture, and configuration match the [previous run with the normal configuration](../benchmarks/results/locale-add-position-pool.json). Typegen and the default dependency prebundle were enabled; CPU, browser, and detailed server-file measurements were disabled. The default prebundle includes Saylo core, React, and ReactDOM. I do not compare timings directly with the [10-run instrumentation in 26](26-shared-catalog-freeze.md), where prebundling was disabled. Transport and DOM state were still verified, and detailed stage fields were not emitted.

Per scale there were 5 warmups, 50 measured runs, and 25 control round trips. Raw data contained 110 unique tokens across 100 measured runs. There was one `bench` namespace. Small had 3 initial files and locales, 1,000 messages per file, 110,292 B of initial JSON, and 36,781 B per added file. Large had 20 initial files and locales, 10,000 messages per file, 7,755,280 B of initial JSON, and 387,783 B per added file.

Each iteration adds a new en-GB directory and one JSON file. It verifies the list DOM, selects the language automatically, confirms the first translation, and returns to en. The next iteration starts from the same baseline after the file, empty directory, and list entry are removed. The app and existing formatter are warm; the added catalog and probe formatter are loaded for the first time. Directory creation is excluded from save latency. These are development-mode DOM commits for one machine, one namespace, and one probe message; paint, full-message rendering, mouse-input latency, and cold startup are outside scope.

Save → list ack spans from completion of Node's writeFile through receipt of the list DOM ack body. Selection preparation → translation ack spans from receipt of the Node control request through the translation ack and includes control-response and ack costs. Save → translation ack is also an end-to-end interval on the same Node clock. Selection → commit spans from immediately before browser setLocale through the point where useLayoutEffect verifies the translation DOM and select value. I do not subtract different clocks or control costs, add p95 values, or deduct GC. The 50-run nearest-rank p95 is the 48th sorted value. Initial preparation time is distinct from warmed measurements.

## Results

Times are in ms.

| Metric | Small p50 | Small p95 | Large p50 | Large p95 |
|---|---|---|---|---|
| saveToListAck | 85.87 | 112.42 | 304.70 | 621.18 |
| selectToTranslationAck | 36.17 | 78.16 | 317.43 | 635.00 |
| saveToTranslationAck | 125.36 | 202.73 | 629.00 | 2067.43 |
| selectToCommit | 33.00 | 74.20 | 312.80 | 631.70 |
| saveToBroadcast | 80.65 | 106.09 | 286.91 | 605.09 |
| fileWrite | 6.04 | 8.80 | 9.46 | 14.12 |
| Control round trip | 3.69 | 6.14 | 3.71 | 9.20 |

Startup time excluding warmup: serverStartup was 569.60 ms for small and 9,463.79 ms for large; browserBoot was 4,599.15 ms for small and 9,112.99 ms for large.

The 250 ms list target was met in 50/50 small runs and 9/50 large runs. Large list rendering ranged from 196.48 to 1,825.15 ms, and selection ranged from 182.60 to 2,791.00 ms. Large save → first translation ack had p95 2,067.43 ms and maximum 3,162.28 ms.

Wire: reply JSON p95 was 119,641 B for small and 1,241,398 B for large. These are serialized JSON frame bytes, not actual network bytes or compressed size.

## Interpretation

| p95 | Current small | Previous small | Current large | Previous large |
|---|---|---|---|---|
| List | 112.42 | 109.68 | 621.18 | 878.98 |
| Selection | 74.20 | 48.00 | 631.70 | 486.80 |

Small met the list target in this run, while large did not. Large list p95 was observed lower than in [23](23-position-sharing-locale-add.md), but the number of runs within 250 ms fell from 15/50 to 9/50 and the longest duration increased. Selection p95 was also observed higher at both scales, so a consistent improvement across the full flow was not confirmed. First-locale selection is a separate metric and is not governed by the 100 ms string-edit update target.

The default configuration, environment, and fixture are the same, but the earlier harness did not support the current begin/finish calls when instrumentation is disabled or ack verification. This was not a repeated before/after comparison in randomized order, and run load was not separated, so I do not attribute the entire timing difference to shared freezing. [26](26-shared-catalog-freeze.md) confirmed removal of duplicate traversal, but this run has no detailed stage timings. Long samples remain in the raw data, and I do not attribute their latency to GC or the network.

## Validation and next work

In all 55 raw iterations per scale, there were zero target responses before selection and one `saylo-catalog-v1` compact full response after selection. All 100 measured runs maintained the same conditions. Generated `.d.ts` files retained mtime and size; input DOM nodes, values, and React state were preserved; and reset/deletion completed without reload. I recalculated six timing metrics and the control summary from raw data and reconciled counts, token uniqueness, warmup flags, wire bytes, and current hashes.

Because product, dist, and harness inputs were unchanged, I reused the earlier workspace tests, consumer typecheck, build, release check, and independent pack verification. I did not repeat those checks in this work. I confirmed that no temporary fixture, profile, or benchmark browser process remained. I also verified local document links, code blocks, the under-40 KB size limit, and `git diff --check`.

Results are preserved in the [summary](../benchmarks/results/locale-add-shared-freeze.json), [small raw samples](../benchmarks/results/locale-add-shared-freeze.1k-3-locales.samples.json), and [large raw samples](../benchmarks/results/locale-add-shared-freeze.10k-20-locales.samples.json).

This work did not change versions, push, publish, or deploy.

Next is to measure the first-selection stages for large while retaining the default prebundle. First add boundaries for server full-response generation and encoding, then record browser post-receipt → DOM commit as a separate interval. Preserve per-process clocks, and use the results to choose the next optimization target.
