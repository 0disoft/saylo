# 59. JSON leaf edit fast path

## Background

`packages/core` now has an edit path that reuses JSON leaf ranges from an earlier successful parse. The commits are `5558185` (reuse validated JSON spans) and `432ca35` (store provenance as compact IDs and `Uint32Array` spans). `1ab93d5` in `packages/vite` prevents an earlier read from scheduling a duplicate disk drain when its token has already been replaced by a pending newer batch.

## Applicability

The fast path uses the cache only when an edited leaf is a single string token that matches provenance from an earlier successful parse. The following cases bypass the cache and return to a full strict parse:

- adding, deleting, or renaming a key
- changing multiple values at once
- changing object or array structure
- invalid JSON that does not validate as a string token
- foreign catalogs without provenance

The changed string still goes through the existing ICU and argument-contract validation. The cache does not conceal ICU or schema violations. Provenance is recorded in a `WeakMap` only for successful parses, never failed ones. The memory cost of retained spans and IDs was not measured quantitatively and is not counted as a benefit. No cold-path benefit is claimed either.

## Parser paired comparison

[../benchmarks/results/json-leaf-compare-2026-10-11.json](../benchmarks/results/json-leaf-compare-2026-10-11.json) is a single-process parser-only comparison with 10k messages in alternating before/after order. Input stringification and deep equality are excluded from timing. The file's top-level `codeHashes` match the current dist (`packages/core/dist/json.js` `acc8f2e9`, `catalog-json.js` `9012d701`), and `beforeRef` is `78b23b7`.

| Mode | before p95 (ms) | after p95 (ms) | Faster pairs |
| --- | ---: | ---: | ---: |
| same-length | 44.02 | 12.09 | 100/100 |
| variable-length | 152.23 | 83.73 | 99/100 |
| cold | 92.41 | 92.58 | 10/20 |

The cold run includes one after outlier with a maximum of 1011.08 ms; p95 is effectively unchanged.

## End-to-end edit run

[../benchmarks/results/json-leaf-final-edit-2026-10-11.json](../benchmarks/results/json-leaf-final-edit-2026-10-11.json) is a save-to-HTTP-DOM-ack run against source `1ab93d5` with 25 measurements, 5 warmups, 10 calibrations, and typegen enabled.

| Scenario | p50 (ms) | p95 (ms) | Within 100 ms |
| --- | ---: | ---: | ---: |
| small 1k×3 | 16.31 | 80.12 | 25/25 |
| large 10k×20 | 67.36 | 95.25 | 24/25 |

The large p95 is within the 100 ms goal, with a maximum of 124.11 ms. Both scenarios applied 25 patches and 0 full responses, and neither rewrote the `.d.ts` file. The input nodes and values checked by the edit benchmark, along with component state, were also preserved. Because this was a single run, it does not establish stable achievement of the edit goal.

## Locale-add run

[../benchmarks/results/json-leaf-final-locale-add-2026-10-11.json](../benchmarks/results/json-leaf-final-locale-add-2026-10-11.json) is a list save-to-ack run with the same options.

| Scenario | p50 (ms) | p95 (ms) | Within 250 ms |
| --- | ---: | ---: | ---: |
| small 1k×3 | 83.23 | 135.22 | 25/25 |
| large 10k×20 | 196.64 | 268.58 | 23/25 |

The large scenario does not meet the 250 ms goal.

## Recovery and browser probes

- All five fresh Vite SSR recovery cases report `recovered: true` ([../benchmarks/results/json-leaf-recovery-2026-10-11.json](../benchmarks/results/json-leaf-recovery-2026-10-11.json)).
- The thin-layer browser smoke test passes all eight `--gap-ms 0` scenarios ([../benchmarks/results/json-leaf-browser-2026-10-11.json](../benchmarks/results/json-leaf-browser-2026-10-11.json)). It covers a prototype comparison and is not evidence for the entire Saylo adapter.

## Validation scope

The current `npm run check` PASS record includes all builds, workspace tests, consumer typechecks, the React typecheck, scripts, and 94 Vite tests. `parser-probe` also passed once. The main source API and dependency versions are unchanged; the work exists in local commits only, with no push or publication. The raw results were committed together in `9743a38`.

## Remaining work

The original goal remains open. Locale-add performance, the complete thin-layer assessment, and the release decision remain. This document is not a completion determination. `json-leaf-edit` (large p95 87.04 ms) and `json-leaf-compact-edit` (large p95 117.61 ms) are retained as historical records from different points in time; the latest runs above take precedence.

## Source data and reproduction

```sh
npm run build
node benchmarks/live-update/json-leaf-compare.mjs
node benchmarks/live-update/run.mjs --scenario all --mode edit --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/json-leaf-final-edit-2026-10-11.json
node benchmarks/live-update/run.mjs --scenario all --mode locale-add --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/json-leaf-final-locale-add-2026-10-11.json
node benchmarks/thin-layer/rapid-recovery.mjs --assert-recovered --out benchmarks/results/json-leaf-recovery-2026-10-11.json
node benchmarks/thin-layer/browser-smoke.mjs --gap-ms 0 --out benchmarks/results/json-leaf-browser-2026-10-11.json
```
