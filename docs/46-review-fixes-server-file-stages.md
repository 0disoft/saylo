# 46. Server-file stage measurement after review fixes

On 2026-10-10 KST, I separately measured the read and candidate stages for large (10k × 20). I used the existing `--server-file-stages` option unchanged and did not modify product or harness source. The baseline revision was `abc1e0e5a1900493348edca73b32b70f69347459`, and `src` matched `9cfb844`.

## Environment and conditions

- 2026-10-10 KST, Node v24.18.0, Windows x64 (10.0.26300), AMD Ryzen 5 7430U (12 logical CPUs), 31.3 GiB memory, Vite 8.3.2, React 19.3.0 in development mode, and HeadlessChrome 154.0.0.0.
- The scenario was large 10k × 20 with one namespace and a 7,755,280 B catalog. Settings were 50 samples, 5 warmups, 25 calibrations, and a 30-second timeout.
- Only `--server-file-stages` was enabled; CPU, browser-stages, reply-stages, and client-stages were disabled. Typegen and the normal prebundle were enabled, and `.d.ts` mtime and size did not change.
- I reused the existing build after reconciling its 36 hashes. The order was fixed as edit → locale-add, with one run per mode, and load and GC were uncontrolled.
- I reused the build from the preceding baseline measurement and ran `node benchmarks/live-update/run.mjs --mode edit --scenario 10k-20-locales --server-file-stages --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/review-fixes-2026-10-10-edit-server-files.json`, followed by the same options with `--mode locale-add` and `--out benchmarks/results/review-fixes-2026-10-10-locale-add-server-files.json`. I did not run `npm run build` in this work.

## Server-file stages (large 10k × 20)

Values in the tables are ms. pathCheck, fileRead, catalogParse, and candidateOther are nested inside readAndCandidate, so I do not add their p95 values or treat wall time as CPU time.

| Stage | edit p50 | edit p95 | locale-add p50 | locale-add p95 |
| --- | --- | --- | --- | --- |
| readAndCandidate | 38.95 | 57.48 | 88.97 | 282.45 |
| pathCheck | 0.60 | 0.83 | 0.58 | 1.30 |
| fileRead | 1.00 | 1.36 | 0.99 | 6.68 |
| catalogParse | 35.28 | 47.62 | 87.20 | 280.54 |
| candidateOther | 0.53 | 8.61 | 0.51 | 14.47 |

catalogParse was 35.28/47.62 ms for edit p50/p95 and 87.20/280.54 ms for locale-add. The other stages were small, and candidateOther is the per-sample remainder within readAndCandidate.

## Separate stages (reference)

| Stage | edit p50/p95 | locale-add p50/p95 |
| --- | --- | --- |
| queueToDrain | 47.58 / 52.61 | 46.02 / 55.48 |
| translationPreparation | 9.45 / 12.94 | 7.10 / 11.78 |
| registryReplace | 6.00 / 8.32 | 0.07 / 0.13 |
| catalogDelta | 13.76 / 21.22 | 0 / 0 |
| receive → commit (Browser) | 28.30 / 34.50 | — |
| Immediately before setLocale → commit (Browser) | — | 156.20 / 290.90 |
| Control RTT (Node, 25 runs) | 2.84 / 3.59 | 3.22 / 3.60 |

A catalogDelta of zero for locale-add does not mean the value is cheap; it means the full response for initial selection is outside profiledPhase. profiledPhase spans file addition → list ack. Individual Node server stages are function start/end points from `performance.now`, not one window from file-write resolution through DOM ACK receipt; that end-to-end value is separate. The browser clock is separate from the Node clock, control is not deducted, and stage p95 values are not added. For locale, the interval immediately before setLocale → commit includes transport and loading.

## Observation summary

- Individual parsing (catalogParse) was the largest stage for both edit and locale-add in all 50/50 samples.
- Total latency was 182.64 ms at edit save → DOM ack p95 (exceeding the 100 ms target) and 389.94 ms at locale-list p95 (exceeding the 250 ms target).
- These values are lower than 398.73 and 627.48 ms in 45, but instrumentation differences on the same source and the use of single runs mean this is not evidence of performance improvement.
- I do not establish parse CPU time or GC as the cause. Candidate remainder is also a measurement remainder dependent on conditions and does not distinguish detailed causes such as base stat or queue behavior.

## Validation

- Raw data consisted of 100 measured samples, 10 warmups, and 50 controls.
- I recomputed p50, p95, min, and max for 33 metric summaries (11 overall, 12 server, 8 file, and 2 control) from raw values with nearest rank, and all matched.
- Thirty-six unique code hashes matched current `dist` and harness and were equal across modes.
- All 100 samples had one path, read, and parse call each, and the candidate window matched the decomposition into path + read + parse + remainder.
- Parse was the largest individual stage in edit 50/50 and locale 50/50 samples. Per-sample parse/candidate-window ratios (not overall response time or CPU share) were edit min 69.40%, p50 93.84%, max 95.19%; locale min 82.20%, p50 97.42%, max 99.79%.
- `.d.ts` was not rewritten. Edit had 50 patches, 0 full responses, and 1 changed message; locale had 0 responses before selection and 50 full responses after. Maximum drain was 1 for both, and maximum file events were 1 for edit and 2 for locale.
- I confirmed zero temporary benchmark directories and zero dedicated Chrome processes, and product and harness source were unchanged.

## Limitations and next work

- This was a single run in fixed order with uncontrolled load and GC. Values are wall time, not CPU time, and stage p95 values are not added.
- The next step is to use a micro parser harness to find the smallest candidate for reducing repeated traversal and object construction. Do not reintroduce already reverted candidates such as the key-decoding experiment in 11 or those in 37, 40, and 41 without evidence. This work does not commit to a specific candidate or performance gain.
- JSON and parser contracts remain unchanged. I will not select an exact candidate before reading the source. Selector and heap optimizations were not measured in this work.

## Sources

- Results and settings: [edit JSON](../benchmarks/results/review-fixes-2026-10-10-edit-server-files.json), [locale-add JSON](../benchmarks/results/review-fixes-2026-10-10-locale-add-server-files.json)
- Raw samples: [edit 10k](../benchmarks/results/review-fixes-2026-10-10-edit-server-files.10k-20-locales.samples.json), [add 10k](../benchmarks/results/review-fixes-2026-10-10-locale-add-server-files.10k-20-locales.samples.json)
