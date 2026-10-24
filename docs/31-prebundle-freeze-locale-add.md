# 31. Locale-add remeasurement after prebundle freeze sharing

## Purpose

After [29](29-prebundle-client-stages.md) identified separated freeze trust and [30](30-prebundle-freeze-sharing.md) shared it through the root import, I remeasured the locale-add scenario under the normal prebundle path. Product and harness code were unchanged. This work includes measurement results and updates to related documentation.

## Run

```sh
node benchmarks/live-update/run.mjs --mode locale-add --scenario all --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/locale-add-prebundle-shared-freeze.json
```

- revision: 442363a44f62f42a7a08bf260054d260369b731c
- measuredAt: 2026-10-07T13:38:56.862Z
- Detailed measurement for CPU/browser/server-file/reply/client: all OFF
- normal prebundle/typegen: ON
- Node 24.18.0, Vite 8.3.2, React 19.3.0, Windows x64, Ryzen 5 7430U, HeadlessChrome 154
- Per scale, 55 raw runs (5 warmups + 50 measured), 25 controls, and 110 unique raw tokens

## Input scale

| Scale | Messages | Locales | JSON | Added |
| --- | --- | --- | --- | --- |
| small | 1k | 3 | 110292B | 36781B |
| large | 10k | 20 | 7755280B | 387783B |

There is one bench namespace.

## Results

Units are ms. Save → list/translation ack spans from completion of the Node file write through receipt of the DOM-verification ack and includes ack delivery. Browser selection → commit spans from immediately before setLocale through the useLayoutEffect that verifies the translated DOM.

| Metric | small p50 | small p95 | large p50 | large p95 |
| --- | --- | --- | --- | --- |
| List saveToListAck | 86.64 | 152.13 | 189.62 | 268.54 |
| Node selection preparation → translation ack | 30.06 | 57.73 | 186.70 | 297.57 |
| Node save → translation ack | 122.14 | 233.38 | 379.11 | 663.07 |
| Browser selection → commit | 26.60 | 54.60 | 181.00 | 284.40 |
| Node save → broadcast | 81.38 | 138.26 | 177.71 | 247.95 |
| fileWrite | 7.64 | 28.70 | 10.39 | 24.71 |
| control | 4.07 | 5.34 | 4.12 | 8.48 |

The 250 ms list target was met in 49/50 small runs and 47/50 large runs. Small list p95 met the target, while large list p95 exceeded it by 18.54 ms. Neither the 250 ms list target nor the 100 ms copy-edit target applies to first translation selection.

## Limits of comparison with earlier runs

In earlier normal run 27, list p95 was 112.42 ms for small and 621.18 ms for large, and selection p95 was 74.20 ms and 631.70 ms. The runs occurred at different times and differed in harness and load, so I do not establish the entire observed reduction as an effect of shared freezing. I also do not make a direct causal comparison with run 30, which had detailed instrumentation enabled.

## Node same-clock decomposition

Per sample, `saveToListAckMs - saveToBroadcastMs` is the broadcast → list-ack interval on the same Node clock. p50/p95 was 5.42/17.94 ms for small and 13.57/16.25 ms for large, including transport, browser update, and HTTP ack costs. In each scale, save → broadcast exceeded the following interval in all 50/50 runs. These are not p95-to-p95 subtractions; I do not mix Node and browser clocks, deduct control/GC, or add nested p95 values. The 50-run p95 is the 48th sorted value.

## Scenario and exclusions

Each iteration adds a new en-GB file, verifies the list DOM, selects it automatically, verifies the translated DOM, returns to en, and waits for the file and empty directory to be removed before starting the next iteration. Directory creation time is excluded. The app is warm; the new catalog and probe formatter are loaded for the first time. Paint, cold startup, and full-message rendering are excluded. Input DOM node/value, React state, and `.d.ts` mtime/size were preserved, and there was no reload.

Across all 110 raw runs, target responses before selection were 0, and after selection there was exactly one `saylo-catalog-v1` compact full response; the same held for all 100 measured runs. Frame JSON p95 was 119,640 B for small and 1,241,403 B for large and is not actual network bytes.

## Validation

I reconciled raw counts, token uniqueness, warmup status, instrumentation options, timings, controls, bytes, statistics, current code hashes, and the Node timing boundaries. Product and harness hashes match the measured run in 30. The only product hash difference from the earlier 27 is `packages/vite/dist/freeze.js`. No temporary fixture or benchmark browser remained. I did not rerun product tests, typechecks, build, pack, or release checks because inputs were unchanged. No version change, push, publish, or deploy was performed.

## Next candidates

Because large list rendering misses the target and the pre-broadcast interval is large, remeasure the current server's path checking, reading, parsing, and translation preparation to choose the next optimization. These values, measured with detailed instrumentation disabled, do not identify parsing or GC as the cause.

## Links

- [locale-add-prebundle-shared-freeze.json](../benchmarks/results/locale-add-prebundle-shared-freeze.json)
- [locale-add-prebundle-shared-freeze.1k-3-locales.samples.json](../benchmarks/results/locale-add-prebundle-shared-freeze.1k-3-locales.samples.json)
- [locale-add-prebundle-shared-freeze.10k-20-locales.samples.json](../benchmarks/results/locale-add-prebundle-shared-freeze.10k-20-locales.samples.json)
- [locale-add-prebundle-shared-freeze-comparison.json](../benchmarks/results/locale-add-prebundle-shared-freeze-comparison.json)

Related documents: [27](27-shared-freeze-locale-add.md), [30](30-prebundle-freeze-sharing.md).
