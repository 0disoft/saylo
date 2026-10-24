# 23. Locale addition remeasurement after relative-position sharing

On 2026-10-07 KST, I remeasured locale addition with code that included relative-position sharing. List-render p95 was 109.68 ms for small and 878.98 ms for large. Large met the 250 ms target in 15 of 50 runs, but its p95 still missed the target. The first-translation selection p95 was higher than in the preceding run, so a consistent improvement across the full flow was not confirmed.

## Run and conditions

```sh
node benchmarks/live-update/run.mjs --mode locale-add --out benchmarks/results/locale-add-position-pool.json
```

I reused the dist built and verified by the preceding implementation. The measured revision was `9729fc98c6d6f284bba0605265ad9080b317ae7f`, and the worktree was clean at the start. Product and benchmark code were not changed in this work. I preserved the [summary](../benchmarks/results/locale-add-position-pool.json), [small raw samples](../benchmarks/results/locale-add-position-pool.1k-3-locales.samples.json), and [large raw samples](../benchmarks/results/locale-add-position-pool.10k-20-locales.samples.json).

The configuration matches the preceding [50-iteration run 20](20-locale-add-remeasurement.md): 5 warmups, 50 measured runs, 25 control round trips per scale, and a 30-second timeout. Typegen and the existing dependency prebundle were enabled; CPU and detailed server/browser measurements were disabled. The environment was Node 24.18.0, Windows x64, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, Ryzen 5 7430U, with 31.3 GiB memory. The fixture, configuration, environment, and browser version were reconciled with the earlier results.

| fixture | initial files and locales | messages/file | initial JSON total | Added JSON |
| --- | --- | --- | --- | --- |
| small | 3 | 1,000 | 110,292 B | 36,781 B |
| large | 20 | 10,000 | 7,755,280 B | 387,783 B |

There is one `bench` namespace. Each iteration adds a new en-GB directory and one valid translation JSON file, verifies the list DOM, and then selects the language automatically. After confirming the first translation, it returns to en, removes the file, empty directory, and list entry, and begins the next iteration from the same baseline. The app and existing formatter are warm; the added catalog and new probe formatter are loaded for the first time.

## Results and completion points

Save → list ack spans from completion of Node's writeFile to receipt of the ack body at the list DOM commit. Selection → first translation commit spans from immediately before browser setLocale to the useLayoutEffect that verifies the new probe DOM. Selection preparation → translation ack spans from receipt of the Node control request through receipt of the translation ack and includes control-response and ack costs. I do not subtract different clocks, deduct control costs, or sum nested p95 values. Statistics use nearest rank; paint and actual mouse-input latency were not measured.

| metric | small p50(ms) | small p95(ms) | large p50(ms) | large p95(ms) |
| --- | --- | --- | --- | --- |
| Save → list DOM ack | 84.76 | 109.68 | 318.32 | 878.98 |
| Selection → first translation commit (browser) | 28.90 | 48.00 | 274.30 | 486.80 |
| Selection preparation → first translation ack (Node) | 32.46 | 51.36 | 278.17 | 561.42 |
| Save → first translation ack | 121.10 | 163.12 | 617.91 | 1,295.89 |
| Save → manifest broadcast | 78.74 | 104.67 | 299.76 | 857.91 |
| File write | 6.78 | 9.21 | 14.15 | 37.27 |
| Control round trip | 4.00 | 5.66 | 3.72 | 5.01 |

The 250 ms list-render target was met in 50/50 small runs and 15/50 large runs. For large, the list-render minimum/maximum was 176.11/1,083.15 ms. Small met the target in this run, but I do not claim stable achievement from a single run.

| p95 comparison | Previous small (ms) | Current small (ms) | Previous large (ms) | Current large (ms) |
| --- | --- | --- | --- | --- |
| List render | 153.98 | 109.68 | 1,056.40 | 878.98 |
| Selection → first translation commit | 44.40 | 48.00 | 360.20 | 486.80 |

Among the measurement-code hashes, the files that differed from the preceding run were core's catalog.js, simple-message.js, and diagnostics.js. The scope of position sharing and the parser-only comparison are described in [22](22-relative-position-sharing.md). Run load, GC, and scheduling were uncontrolled, so I do not attribute the full list-render reduction or the increased selection latency to the single position-sharing change. Control p95 also changed from 12.27 to 5.66 ms for small and from 6.02 to 5.01 ms for large, while large fileWrite p95 changed from 15.05 to 37.27 ms, showing that observed run conditions differed.

## State preservation, transport, and validation

In every iteration, list addition, language selection, and deletion preserved the input node identity, entered value, and changed React state. I also confirmed the initial translation DOM, selected locale, return to en, and list removal, and completed the run without a document reload. Generated `.d.ts` files retained their mtime and size at both scales.

In all 50 measured runs there were zero catalog responses for a new target before selection and exactly one compact full response without a known baseline after selection. The encoding was `saylo-catalog-v1`; response-object JSON p95 was 119,638 B for small and 1,241,400 B for large. I do not interpret these as physical network bytes or as a wire-size improvement from position sharing.

For each raw file, I reconciled 55 rows, 50 measured rows, unique tokens, six timing summaries, the 25-run control summary, bytes, response counts, and current code hashes. After completion no owned temporary fixture/profile directories or benchmark browser processes remained. Because no product changes were made, I did not repeat the preceding 166 tests, consumer typechecks, build, release check, or pack.

## Next work and limitations

The next task is to divide the full-response decoding, freezing, and snapshot-creation stages of the first language selection and measure them in the benchmark. The existing browser instrumentation assumes patch edits and does not support locale-add mode, so a measurement boundary for full responses must be added. Measurements will determine the next optimization target; the current numbers alone do not establish browser decoding as the bottleneck.

Large still misses the list-render target. This run covered one machine, one namespace, one valid translation file, and DOM commit for one probe message. It does not extend to multiple namespace additions, invalid translations, full-message rendering, cold startup, paint, or a comparison of libraries. Relative-position sharing is not yet in the npm release.
