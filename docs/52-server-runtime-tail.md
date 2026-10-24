# 52. Measurement of read/candidate remainder and GC/timer delays

[51](51-owned-message-map-comparison.md) confirmed an end-to-end tail increase but could not determine whether the cause was the read/candidate remainder or GC/event-loop delay. This document records an extension to the optional benchmark harness that isolates that interval. Commit `6403fab` adds a `--runtime-stages` option next to `--server-file-stages` so the same samples collect both the server runtime window and GC/timer-delay windows. Product dist and the public API were unchanged, and the normal prebundle and typegen settings remained in place.

## Conditions and method

This ran on 2026-10-10 KST under Node v24.18.0, Windows x64 (10.0.26300), Ryzen 5 7430U, Vite 8.3.2, React 19.3.0 in development mode, and HeadlessChrome 154.0.0.0. The scenario was `10k-20-locales` with 25 measured runs, 5 warmups, and 10 calibrations per run. Modes were `edit` and `locale-add`, each run once in edit → locale-add order. GC was not forced and load was uncontrolled.

```sh
node benchmarks/live-update/run.mjs --mode edit --scenario 10k-20-locales --server-file-stages --runtime-stages --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/runtime-tail-edit-2026-10-10.json
node benchmarks/live-update/run.mjs --mode locale-add --scenario 10k-20-locales --server-file-stages --runtime-stages --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/runtime-tail-locale-2026-10-10.json
```

The aggregates from the two commands are edit [runtime-tail-edit-2026-10-10.json](../benchmarks/results/runtime-tail-edit-2026-10-10.json) and locale [runtime-tail-locale-2026-10-10.json](../benchmarks/results/runtime-tail-locale-2026-10-10.json). Raw samples are [edit samples](../benchmarks/results/runtime-tail-edit-2026-10-10.10k-20-locales.samples.json) and [locale samples](../benchmarks/results/runtime-tail-locale-2026-10-10.10k-20-locales.samples.json).

## Runtime stages

`runtimeWindows` records `readAndCandidate`, `pathCheck`, `fileRead`, `catalogParse`, `baseStat`, and `candidateOther`. A sample window (`sample`) spans from stage begin before the write through stage finish after ack receipt. Locale mode covers only through the list ack, so it excludes selection, reset, and deletion. `baseStat` is the `Promise.all(stat)` section inside `candidateOther` that checks whether baseline catalogs exist.

## GC and timer delay

A `PerformanceObserver` records GC event `kind` and `flags` plus start and end times, while a timer rescheduled every 10 ms records expected → observed delay intervals. The tool intersects timestamps for events and server windows, counts union overlap once, and clips at window boundaries. Because GC delivery is asynchronous, after the last ack it waits 10 ms outside the stored window and yields twice through `setImmediate`, then collects remaining entries with `takeRecords`.

`gcOverlapMs` and `timerDelayOverlapMs` can overlap each other, and parent and child intervals also overlap. The values therefore must not be added, subtracted from wall time, or treated as CPU time, pure OS scheduler time, or causal proof. Timer delay mixes synchronous JavaScript, GC, I/O callbacks, OS scheduling, and instrumentation overhead itself. The observed API definition follows Node's [`PerformanceObserver`](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html#class-performanceobserver) documentation.

## Scope of interpretation

This record is diagnostic and adds observation points. It is not a direct performance comparison with the end-to-end values in [51](51-owned-message-map-comparison.md) and is not promotional evidence.

## Results, validation, and next candidates

Units are ms; p50/p95 below are calculated from 25 measured runs per mode. The sample window includes file writing, so its boundaries differ from save completion → ack.

| End-to-end diagnostic value | p50 / p95 | max | Samples within target |
| --- | ---: | ---: | --- |
| Edit save → DOM ack | 148.39 / 168.50 | 174.41 | ≤100 ms: 0/25 |
| Locale save → list ack | 267.34 / 479.67 | 526.16 | ≤250 ms: 7/25 |

| mode and runtime window | wall p50 / p95 | GC overlap p95 | timer-delay overlap p95 |
| --- | ---: | ---: | ---: |
| edit catalogParse | 30.55 / 38.94 | 0 | 30.53 |
| edit fileRead | 0.97 / 1.43 | 0 | 0 |
| edit baseStat | 0.22 / 11.56 | 11.20 | 1.55 |
| edit candidateOther | 0.48 / 12.28 | 11.20 | 2.14 |
| locale catalogParse | 152.08 / 377.88 | 15.36 | 370.96 |
| locale fileRead | 1.70 / 12.54 | 0 | 2.76 |
| locale baseStat | 0.60 / 20.10 | 19.33 | 10.03 |
| locale candidateOther | 0.87 / 20.42 | 19.33 | 10.14 |

This edit run had a maximum of 174.41 ms and did not reproduce the 300–400 ms long samples from [51](51-owned-message-map-comparison.md). Locale fileRead also had a maximum of 18.26 ms, so the more-than-100 ms read delays seen in the previous run did not recur. I do not retroactively identify the cause of the earlier tail.

The longest locale sample, `10k-20-locales:36`, had a 526.16 ms list ack, 378.45 ms parsing window, and 376.15 ms timer delay overlapping parsing; its collected GC overlap was zero. The next longest sample, `:34`, had a 479.67 ms list ack, 233.26 ms parsing, and zero parsing GC overlap. There is therefore no basis for explaining these long samples with GC alone. This is an observation that synchronous parsing overlapped timer delay; I did not distinguish pure CPU cost from OS scheduling share within parsing.

Some baseline-file waits did overlap GC. In locale sample `:22`, GC overlapped 22.28 of a 23.08 ms baseStat window; in edit sample `:18`, it overlapped 13.10 of 13.80 ms. These values alone do not show that the filesystem itself is slow. Among measured samples, parsing had GC overlap in edit 0/25 and locale 4/25, while baseStat had GC overlap in 3/25 and 4/25.

- Four related tests and browser smoke tests for two enabled edit scenarios, enabled small locale, and disabled small edit passed. Smoke timings were not used as performance results.
- I checked 60 raw runs (50 measured + 10 warmup) and 20 controls. I recalculated 89 existing and new timing summaries from raw data and reconciled 420 runtime observations with separate intersection and interval-union calculations; all matched.
- Every sample had one path, read, parse, and baseStat window and one drain. I verified baseStat's containment within candidateOther and the decomposition of readAndCandidate into three file stages and the remainder.
- All 37 unique harness and dist hashes matched current files, and hashes common to both modes were equal. Product dist hashes matched the after snapshot in 51 unchanged.
- The harness verified input node, entered value, React state, and translated DOM and preserved `.d.ts` mtime/size. Measured edits had one message patch and zero position updates; locale had zero responses before selection and one compact full response after selection, and completed return, deletion, and list removal. No temporary directories or dedicated browser processes remained.
- Because product inputs were unchanged, I did not repeat full product tests, pack, or release checks. No version change, push, publish, or deploy was performed.

Next is to use the existing `parser-cpu.mjs` `cold` mode to narrowly profile new parsing's internal calls and choose one optimization candidate. These observations alone do not justify skipping the baseline-file existence check or automatically reverting an optimization.
