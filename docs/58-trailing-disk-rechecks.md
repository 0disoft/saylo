# 58. Trailing disk rechecks

## Background

Before `463083e`, a second change made shortly after the first was not delivered to the watcher, so a valid save immediately after an invalid-JSON diagnostic did not recover. A gap-free local experiment reproduced the failure ([rapid-recovery-2026-10-11.json](../benchmarks/results/rapid-recovery-2026-10-11.json)), and that result is retained as a historical observation. The installed Vite bundle shows a 50 ms throttle on change events, but no control tested other causes such as native OS coalescing, so causality is not established.

## Changes

The disk recheck (`packages/vite/src/disk-rechecks.ts`) checks metadata once more after the first publish.

- One stat before reading records a stamp in `dev:ino:size:mtimeNs:ctimeNs` form (`diskStamp`).
- The first guarded drain is still scheduled on the next event-loop turn with a 0 ms timer. Path checks, stat, read, and parsing take time before publication.
- Metadata is checked once 60 ms after completion (`RECHECK_MS`).
- If the values are unchanged, the operation ends without reparsing or republishing.
- If the stamp changed, the operation immediately queues a read that includes the reader. Adds, unlinks, and ENOENT during a read keep the existing 40 ms settle window (`QUIET_MS`).
- Each read gets one follow-up check, the latest enqueue cancels the previous token, and stop clears the timer. There is no continuous polling or full scan.

## Observed results

All five fresh Vite SSR cases with the final source (`8f25416`) report `recovered: true`.

| Case | gap (ms) | source | revision |
| --- | ---: | --- | ---: |
| json-0-a | 0 | Recovered | 1 |
| json-60 | 60 | Recovered | 1 |
| json-0-b | 0 | Recovered | 1 |
| schema-0 | 0 | Recovered | 1 |
| valid-0 | 0 | Recovered | 2 |

Before `463083e`, both gap-0 runs failed to recover (`false`) and only the gap-60 run succeeded (`true`). The final source recovers all JSON 0/60/0, schema 0, and valid-to-valid 0 cases. The browser prototype source also passes all eight `--gap-ms 0` scenarios (input value, DOM identity and focus, dialog, counter 8, old snapshot, and base plural `0 rows`).

## Costs and limitations

- Every ordinary save now incurs one stat before reading and another stat 60 ms later. A save whose event was missed is read again only after this check, which can delay propagation. ENOENT retries during atomic saves also incur the 40 ms settle time.
- The final same-condition large 10k×20 edit run (`samples 25` + `warmup 5` + `calibrations 10`, normal typegen) had p50 96.82 ms and p95 133.63 ms; 17 of 25 samples were within 100 ms. The 100 ms goal remains unmet. Timing measures save through receipt of the HTTP DOM acknowledgement, excluding paint.
- The same-condition large 10k×20 locale-add run (`samples 25` + `warmup 5` + `calibrations 10`, normal typegen) had list save-to-list ack p50 171.24 ms and p95 322.35 ms; 21 of 25 samples were within 250 ms. The 250 ms goal remains unmet. The two passing runs of 193.56 and 184.78 ms in 54 were recorded against a different source revision.
- In that edit run, queueToDrain had p50 2.64 ms and p95 4.32 ms (one maximum of 134.43 ms); the first metadata-recheck variant had p95 48.39 ms. Control round trip had p50 4.54 ms and p95 6.99 ms, with maxFileEvents 2 and maxDrains 3. Causality between variants is not established.
- The first-version values of 82.18/148.50 ms are retained as history from a different point in time. Independent single runs do not establish causality or improvement.
- The observation files and code hashes verify the actual 5 SSR, 8 browser, and 93 test results. The metadata helper does not guarantee event reliability on every platform.

## Validation scope

- All 93 final Vite tests and the build passed. The Vite consumer typecheck had passed against code before the private callback was added and was not repeated because the public API did not change.
- The full root `check` and `release:pack` were not run because this validation was limited to the Vite path.
- No public API, dependency, or version changed. The work exists in local commits only; nothing was pushed or published.

## Source data and reproduction

The final raw results are [rapid-recovery-fast-read-2026-10-11.json](../benchmarks/results/rapid-recovery-fast-read-2026-10-11.json), [thin-layer-browser-fast-read-2026-10-11.json](../benchmarks/results/thin-layer-browser-fast-read-2026-10-11.json), [disk-rechecks-fast-read-edit-2026-10-11.json](../benchmarks/results/disk-rechecks-fast-read-edit-2026-10-11.json) ([samples](../benchmarks/results/disk-rechecks-fast-read-edit-2026-10-11.10k-20-locales.samples.json)), and [disk-rechecks-fast-read-locale-add-2026-10-11.json](../benchmarks/results/disk-rechecks-fast-read-locale-add-2026-10-11.json) ([samples](../benchmarks/results/disk-rechecks-fast-read-locale-add-2026-10-11.10k-20-locales.samples.json)). The first version used rapid-recovery-fixed, thin-layer-browser-rapid, and disk-rechecks-edit-current. The default browser and rapid-recovery output file is `current.json`, so tests with an explicit `--out` do not overwrite earlier files.

```sh
node benchmarks/thin-layer/rapid-recovery.mjs --assert-recovered --out benchmarks/results/rapid-recovery-fast-read-2026-10-11.json
node benchmarks/thin-layer/browser-smoke.mjs --gap-ms 0 --out benchmarks/results/thin-layer-browser-fast-read-2026-10-11.json
node benchmarks/live-update/run.mjs --scenario 10k-20-locales --mode edit --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/disk-rechecks-fast-read-edit-2026-10-11.json
node benchmarks/live-update/run.mjs --scenario 10k-20-locales --mode locale-add --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/disk-rechecks-fast-read-locale-add-2026-10-11.json
```
