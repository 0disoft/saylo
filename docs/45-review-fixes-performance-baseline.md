# 45. Performance baseline after review fixes

On 2026-10-10 KST, I measured current performance at review-fix commit `9cfb844` with the existing browser harness. Edit propagation and locale addition were separate single runs with 50 measured iterations per scenario, covering small (1k × 3) and large (10k × 20). Targets from [06](06-validation-and-roadmap.md) are p95 ≤ 100 ms for in-development edits and p95 ≤ 250 ms for locale-list rendering.

## Environment and conditions

- Baseline revision `9cfb84463cedac88a10efdd32d9cc113910f9169`, 2026-10-10 KST. The edit run's working tree was clean; the locale-add run recorded three edit artifacts as untracked.
- Node v24.18.0, Windows x64 (10.0.26300), AMD Ryzen 5 7430U (12 logical CPUs), 31.3 GiB memory, Vite 8.3.2. The browser was HeadlessChrome 154.0.0.0 using the real DOM in native headless mode, with React 19.3.0 in development mode. Paint timing was not measured.
- There was one run per scenario in fixed order: small-edit → large-edit → small-add → large-add. OS load and GC were uncontrolled.
- Settings were 50 samples, 5 warmups, 25 calibrations, and a 30-second timeout. CPU, browser-stages, server-file-stages, reply-stages, and client-stages measurements were all disabled; only the default server prototype-stage wrapper in edit mode was enabled.
- Typegen and the normal prebundle were enabled. Both runs had `declarationRewritten: false`, and the generated `.d.ts` mtime and size changed zero times.
- Scenarios used one namespace and either 1k × 3 or 10k × 20 messages. This was not a full cross-matrix of scale combinations.
- I ran `npm run build` once, then `node benchmarks/live-update/run.mjs --mode edit --scenario all --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/review-fixes-2026-10-10-edit.json`, followed by the same options with `--mode locale-add --out benchmarks/results/review-fixes-2026-10-10-locale-add.json`.
- `save` is the point when file writing completes, and `ack` is when Node receives the HTTP response sent by the browser after confirming the DOM commit. File-write time is recorded separately, and control values are not deducted from ack delivery cost included in end-to-end values.

## Edit propagation (save → DOM ack)

All values in this document's tables are ms.

| Scenario | p50 | p95 | min | max | 100 ms p95 target |
| --- | --- | --- | --- | --- | --- |
| small 1k × 3 | 70.07 | 80.08 | 59.12 | 99.04 | Met |
| large 10k × 20 | 174.58 | 398.73 | 107.95 | 718.93 | Exceeded |

All 50 responses in both scales were patches, with zero full responses. Response-size p50/p95 was 929 B for small and 934 B for large. Small met the target; large exceeded it.

## Locale addition

Node's save → list ack, select-ready → translation ack, and save → translation ack use the same Node monotonic clock. Only Browser setLocale → commit uses a separate clock. I do not subtract different clocks or add individual p95 values.

| Scenario | save → list ack p50/p95 | Node select-ready → translation ack p50/p95 | Browser setLocale → commit p50/p95 | 250 ms list p95 target |
| --- | --- | --- | --- | --- |
| small 1k × 3 | 122.61 / 251.27 | 31.82 / 62.95 | 28.20 / 46.40 | Exceeded |
| large 10k × 20 | 207.70 / 627.48 | 185.50 / 275.34 | 182.60 / 272.00 | Exceeded |

Before selection there were zero target catalog responses; after selection there was one full response every time. For reference, save → first translation ack (Node) was 161.12/297.57 for small and 430.91/772.91 for large. Small also missed the list target, with p95 251.27 ms.

## Controls and server stages (reference)

- Control round trips (25 runs) are separate values: small-edit 4.55/10.91, large-edit 3.71/5.12, small-add 3.79/6.44, and large-add 3.93/5.93 (p50/p95 ms). I do not add or subtract them from stage p95 values.
- For large edit, a candidate server stage is readAndCandidate p95 236.35 ms, while browser receive → commit p95 is 44.0 ms. The readAndCandidate boundary mixes serial drain wait, path checking, reading, parsing, candidate filtering, and base stat, so I do not establish a CPU parser bottleneck. I do not add stage p95 values.

## Validation

- Raw data was complete: 200 measured, 20 warmup, and 100 control samples.
- I recomputed p50, p95, min, and max for 22 summary metrics from raw values with nearest rank and they matched; four control summaries also matched recomputation.
- Thirty-six unique code hashes matched current `dist` and the harness and were equal across modes.
- Samples within target were small-edit 50/50, large-edit 0/50, small-list 47/50, and large-list 35/50.
- I confirmed zero temporary benchmark directories and zero dedicated Chrome processes.
- Product and harness source were unchanged. The build and harness runs performed here exited 0; separate full `test` and `check` runs were outside this scope.

## Limitations and next work

- This was a single run in fixed order in native headless mode, and OS load and GC were uncontrolled.
- Startup and boot were each observed once per scenario; typegen generation time was not measured separately.
- First translation was measured after adding a new en-GB catalog each iteration. Revisit-cache, heap, and selector effects were not measured.
- Because the fixture uses `useI18n`, I do not claim render reduction from `useI18nSelector` here.
- I do not make direct causal comparisons with earlier measurements or claim current superiority over Paraglide.
- Next steps are to separate reading and candidate-wait portions of readAndCandidate and to treat selector render counts and cache heap cost as separate follow-up work.

## Sources

- Results and settings: [edit JSON](../benchmarks/results/review-fixes-2026-10-10-edit.json), [locale-add JSON](../benchmarks/results/review-fixes-2026-10-10-locale-add.json)
- Raw samples: [edit 1k](../benchmarks/results/review-fixes-2026-10-10-edit.1k-3-locales.samples.json), [edit 10k](../benchmarks/results/review-fixes-2026-10-10-edit.10k-20-locales.samples.json), [add 1k](../benchmarks/results/review-fixes-2026-10-10-locale-add.1k-3-locales.samples.json), [add 10k](../benchmarks/results/review-fixes-2026-10-10-locale-add.10k-20-locales.samples.json)
