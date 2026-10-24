# 50. Live update measurements after the message-map freezing optimization

I remeasured large edit propagation and locale addition at `8046a31` with the actual Vite watcher and a headless browser. Edit save → DOM ack p95 was **453.15 ms** and locale save → list ack p95 was **629.54 ms**, exceeding the 100 ms and 250 ms targets. There is no basis for concluding that the parser-comparison gain in [49](49-owned-message-map-freeze.md) carried through to these end-to-end runs.

## Conditions

This ran on 2026-10-10 KST under Node v24.18.0, Windows x64 (10.0.26300), Ryzen 5 7430U, Vite 8.3.2, React 19.3.0 in development mode, and HeadlessChrome 154.0.0.0. The scenario had 10k messages × 20 locales in one namespace and a 7,755,280 B initial catalog. Per mode there were 5 warmups, 50 measured runs, 25 controls, and a 30-second timeout. Load and GC were uncontrolled.

I confirmed the same five dist hashes as the preceding core validation and reused the build. Product and harness source were unchanged. Only `--server-file-stages` was enabled, as in [46](46-review-fixes-server-file-stages.md); detailed CPU, browser, reply, and client measurements were disabled. Typegen and the normal prebundle remained enabled. Edit → locale-add ran sequentially in separate processes, with one run per mode.

```sh
node benchmarks/live-update/run.mjs --mode edit --scenario 10k-20-locales --server-file-stages --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/owned-map-2026-10-10-edit-server-files.json
node benchmarks/live-update/run.mjs --mode locale-add --scenario 10k-20-locales --server-file-stages --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/owned-map-2026-10-10-locale-add-server-files.json
```

## Measurement results

The following are p50/p95 in ms. Node and browser use separate clocks; I do not add stage quantiles or deduct control time.

| Interval | p50 | p95 | Samples within target |
| --- | ---: | ---: | --- |
| Edit save → DOM ack (Node) | 165.82 | 453.15 | ≤100 ms: 0/50 |
| Locale save → list ack (Node) | 163.97 | 629.54 | ≤250 ms: 45/50 |
| Locale save → first translation ack (Node) | 349.00 | 964.56 | — |
| Selection preparation → first translation ack (Node) | 176.85 | 406.32 | — |
| Immediately before setLocale → translation commit (Browser) | 173.90 | 360.50 | — |

| Internal stage p50/p95 | edit | locale addition |
| --- | ---: | ---: |
| queueToDrain | 48.27 / 58.85 | 49.32 / 55.58 |
| readAndCandidate | 43.91 / 154.01 | 86.85 / 387.83 |
| catalogParse (inside candidate) | 39.83 / 121.63 | 79.91 / 337.04 |
| fileRead (inside candidate) | 1.42 / 31.00 | 0.94 / 4.66 |
| candidateOther (per-sample remainder) | 0.68 / 16.72 | 0.49 / 19.45 |
| translationPreparation | 12.19 / 29.50 | 7.75 / 17.46 |
| registryReplace | 7.02 / 19.37 | 0.08 / 0.15 |
| catalogDelta | 17.87 / 77.80 | 0 / 0 |
| control RTT | 3.57 / 4.47 | 4.31 / 8.42 |

catalogParse was the largest of the four read/candidate child stages in 50/50 samples for each mode. That does not mean it is the largest portion of overall response time or the majority of CPU. The locale-addition collection phase spans file addition → list ack; catalogDelta zero means the initial-selection full response is outside this phase.

With the same configuration in earlier run 46, p95 was 182.64 ms for edit and 389.94 ms for list rendering. The current values are larger, but the two code versions were not run in an interleaved comparison at the same time. Unchanged stages also changed: edit fileRead p95 went from 1.36 to 31.00 ms, catalogDelta from 21.22 to 77.80 ms, and control increased in both modes. I do not assign the cause to a code regression, GC, or OS load, or correct it with a control deduction. Combining the parser micro-comparison with these results does not establish a general UI-update improvement.

## Validation and next work

- I checked 100 measured samples, 10 warmups, and 50 controls. I recalculated p50/p95/min/max for 33 timing summaries from raw data and they matched; wire-byte summaries also matched.
- Thirty-six unique code hashes matched current dist and harness and were equal across modes. Compared with 46, only core `catalog.js` and `diagnostics.js` differed.
- All 110 raw samples had one path, read, and parse call each, and the candidate-window decomposition into four stages matched. Drain count was one each.
- The browser harness verified input node, entered value, React state, and actual translated DOM. `.d.ts` mtime and size remained unchanged. Measured edits had 50 patches, 0 full responses, 1 upsert, and 0 position updates; locale additions had 0 responses before selection and 50 compact full responses after selection. Return to en, file deletion, and list removal also completed.
- No temporary benchmark directories or dedicated Chrome/Edge processes remained. Because product inputs were unchanged, I did not repeat build, product tests, pack, or release checks.

The end-to-end comparison between before (`49fe1eb`) and after (`8046a31`) is recorded in [51](51-owned-message-map-comparison.md). I added an `owned-map` comparison scope to `locale-compare.mjs` for the two changed sources and ran edit and locale addition with the same harness and dependencies; pooled p95 increased in both modes and the targets were not met. These measurements alone do not justify reverting the optimization or establish a new browser bottleneck.

Sources: [edit result](../benchmarks/results/owned-map-2026-10-10-edit-server-files.json), [edit raw data](../benchmarks/results/owned-map-2026-10-10-edit-server-files.10k-20-locales.samples.json), [locale result](../benchmarks/results/owned-map-2026-10-10-locale-add-server-files.json), [locale raw data](../benchmarks/results/owned-map-2026-10-10-locale-add-server-files.10k-20-locales.samples.json).

No version change, push, publish, or deploy was performed.
