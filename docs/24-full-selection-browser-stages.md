# 24. Browser measurement of the full response for the first language selection

I added browser-stage instrumentation for the first language selection in locale-add mode. Among the synchronous stages collected in 10 large runs, freezing was the largest every time. Medians were 7.60 ms for full decoding, 39.60 ms for freezing, and 18.00 ms for snapshot creation. The remaining portion of total selection time had a larger median of 141.60 ms, making it the next measurement target. Product source and dist were unchanged.

## Run and conditions

```sh
node benchmarks/live-update/run.mjs --mode locale-add --browser-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-browser-stages.json
node --test benchmarks/live-update/browser-profile.test.mjs
```

This ran on 2026-10-07 KST under Node 24.18.0, Windows x64, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, and a Ryzen 5 7430U. There were 2 warmups, 10 measured runs, and 10 controls; CPU and detailed server measurements were disabled. Each iteration used 10,000 initial messages across 20 locales in 20 files with 7,755,280 B of JSON, one namespace, and one new 387,783 B en-GB file. Typegen was enabled.

The baseline revision was `d53b7a58b5507414ab928f1bc33b042fa9f442d3`. Benchmark changes on top are identified by workingTreeStatus and code hashes. I used the preceding built product dist, and the product module hashes match the [run with the general configuration in 23](23-position-sharing-locale-add.md). Raw data is in the [summary](../benchmarks/results/locale-add-browser-stages.json) and [samples from 12 runs](../benchmarks/results/locale-add-browser-stages.10k-20-locales.samples.json).

This option disables prebundling for Saylo core, the React adapter, and the Vite client so their transforms remain visible. React and ReactDOM remain prebundled. I do not directly compare this with the earlier 50-iteration run without instrumentation; later optimization comparisons will use the same option. Clock/counter overhead is included.

## Collection boundaries

A Vite transform wraps, in memory only, the product modules fetched by the browser. It verifies that the module transform is active and that required calls occur for each mode. Edit mode requires the existing patch stages, while locale-add requires the decode stage. Full selection does not require a patch call.

`beginBrowserSample('locale-add')` starts after the list DOM ack and the selection-preparation control response, immediately before setLocale. It ends in the useLayoutEffect for the first translated DOM commit. Initial boot, list addition, return to en, and deletion are excluded from the corresponding browser sample.

| Metric | Actual boundary |
| --- | --- |
| decodeMs | Vite decodeCatalogResult call. Includes compact-format checks and restoration of AST and position objects. WS JSON.parse is outside the boundary |
| freezeMs | Vite freezeCatalogs call. Deep freezing of the received catalogs. Core's separate freeze is outside this boundary |
| snapshotMs | Core createLoadedSnapshot call. Includes translator and signature |
| translatorMs | createBoundTranslator call. Includes base/translation contract validation and translator construction |
| signatureMs | createLoadedSignature calculation inside the snapshot |
| snapshotOtherMs | Per-sample remainder calculated as snapshot − translator − signature |
| selectionOtherMs | Per-sample remainder calculated as browser selection → commit − decode − freeze − snapshot |

Remainders are calculated before summarization. I do not add snapshot p95 to the p95 values of its nested translator/signature stages. selectionOther includes server response preparation, transport wait, WS JSON parsing, unmeasured client validation/freezing, and React commit; it is not established as network time. Node and browser clocks are not subtracted from each other, and control round-trip time is not deducted.

## Results

| Item | p50 (ms) | p95 (ms) |
| --- | --- | --- |
| Selection → first translation commit (browser) | 217.60 | 277.90 |
| Full decode and compact checks | 7.60 | 9.00 |
| Vite catalog freeze | 39.60 | 47.60 |
| Snapshot creation (includes the next two) | 18.00 | 31.70 |
| Translator construction and validation | 13.30 | 26.80 |
| Signature calculation | 4.70 | 6.80 |
| Snapshot remainder | 0.00 | 0.00 |
| Selection remainder | 141.60 | 219.70 |
| Save → list DOM ack | 181.26 | 402.60 |
| Selection preparation → first translation ack (Node) | 220.88 | 280.98 |
| Control round trip | 3.01 | 5.13 |

Statistics use nearest rank; p95 over 10 runs is the maximum. A snapshot remainder of zero means the remainder was below the resolution of the collection clocks, not that no other CPU work occurred.

For each sample, the selection-remainder share of selection → commit was 64.15% at minimum, 66.79% at median, and 79.06% at maximum. Freeze was the largest of the collected decode, freeze, and snapshot stages in all 10 runs, but these values alone do not establish the bottleneck for the full selection. List rendering finished within 250 ms in 8/10 runs, while p95 was 402.60 ms and exceeded the target. I do not claim a performance improvement based on comparison with the earlier 878.98 ms run, which used different options, sample counts, and load.

## Validation and next work

In every large run, decode, freeze, snapshot, translator, and signature each ran exactly once. Before selection there were zero target responses; after selection there was one compact full response, with response JSON p95 of 1,241,401 B. The input node, value, and React state were preserved, as were the mtime and size of generated `.d.ts` files, and the run returned to en and deleted the locale without a document reload.

The two small full-instrumentation runs are preserved in [locale-add-browser-stages-smoke.json](../benchmarks/results/locale-add-browser-stages-smoke.json), the two existing patch-edit measurements in [live-update-browser-stages-regression-smoke.json](../benchmarks/results/live-update-browser-stages-regression-smoke.json), and one default-mode run with instrumentation disabled in [locale-add-browser-disabled-smoke.json](../benchmarks/results/locale-add-browser-disabled-smoke.json). Default mode emits no browserStages field. Three instrumentation-only tests verified full/patch mode separation, reset exclusion, missing calls, and rejection of invalid timing or remainders.

I reconciled raw counts, summaries, call counts, remainders, transport conditions, and current code hashes across four runs and confirmed that no temporary fixture/profile or benchmark browser process remained. `npm run test --workspaces` and `npm run typecheck:consumers --workspaces` passed. Because product code was unchanged, I did not repeat build, release check, or pack. I also verified local document links, code blocks, the under-40 KB size limit, and `git diff --check`.

The next task is to divide the selection remainder further. First, add core acceptOutcome contract checks and freezing, which run before snapshot creation, to the existing browser instrumentation. If needed, record server full-response generation and the post-receipt WS JSON parsing stage separately as well. Preserve each process's clock, and do not use this remainder alone to identify a specific cause. This covers one machine, one namespace, one valid translation, and DOM commit for one probe message; paint, full-message rendering, and cold startup are outside scope.
