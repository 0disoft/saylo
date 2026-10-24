# 11. Parser Internal Measurements

Follow [10-performance-measurements.md](10-performance-measurements.md) for full-update and server file-stage measurements. This document separately records parser-internal cost and verification of small optimizations.

## Baseline measurements (2026-10-07 KST)

Results were recorded in [parser-stages-before.json](../benchmarks/results/parser-stages-before.json) with `node benchmarks/live-update/parser-stages.mjs`. The reference revision is `102a7c7`; benchmark-only changes on top are identified by `workingTreeStatus` and `codeHashes`. Conditions were Node v24.18.0, locale en and namespace bench, 1,000 or 10,000 messages per file, one same-length probe copy edit, and reuse of the previous immutable catalog. Measurement followed 10 warmups and ran 50 times. Input stringify, disk, watcher, translation validation, and browser were excluded.

A Node module hook wraps the actual core `dist` only in memory and does not change source or `dist` files. Clocks cover JSON processing, line-position index creation, the full message-processing loop, and final freezing. The message loop includes ICU processing and reuse, position lookup, and map construction; the clock is not called per message. Token scan includes decoded-key handling, duplicate checks, and entry creation. Strict JSON and token scan are included in total JSON time, so do not add nested stages or p95 values. Values are synchronous elapsed time, not CPU-profile values, and include clock, GC, and OS scheduling effects.

| p95 | 1,000 messages | 10,000 messages |
| --- | --- | --- |
| Parser total | 4.80 ms | 60.20 ms |
| Total JSON | 2.86 ms | 38.08 ms |
| strict JSON.parse (inside JSON) | 1.09 ms | 13.90 ms |
| token scan (inside JSON) | 1.90 ms | 29.06 ms |
| Line-position index creation | 0.29 ms | 3.45 ms |
| Message loop | 1.12 ms | 10.40 ms |
| Final freezing | 0.70 ms | 13.01 ms |

For 10,000 messages, p50 was 41.42 ms overall and 18.39 ms for token scan. In this single run, token scan was a large stage and was chosen as the first optimization candidate. Current `readJson` calls `JSON.parse` again on every key token after the initial strict parse. A small change would remove only the quotes from unescaped keys when the full input syntax has already been checked by `JSON.parse`, while retaining the existing `JSON.parse` behavior for escaped keys. Preserve decoded duplicate IDs, literal prototype IDs, and the error-position contract. Do not convert these microbenchmark results to on-screen p95.

## Key decoding experiment — not applied

An experiment tried the following branch to avoid a second `JSON.parse` for unescaped keys.

```js
const token = key[0];
const id = token.includes('\\') ? JSON.parse(token) : token.slice(1, -1);
```

Stage measurements are preserved in [parser-stages-key-after.json](../benchmarks/results/parser-stages-key-after.json). Token-scan p95 for 10,000 messages changed from 29.06 to 22.60 ms, but parser-total p95 for 1,000 messages rose from 4.80 to 12.57 ms. Load differed between separate runs, so this comparison alone did not decide the effect.

Baseline and trial were alternated in the same process with `node benchmarks/live-update/parse-compare.mjs d64199c benchmarks/results/parse-compare-key.json`. Conditions were 50 warmups and 100 measured pairs, 10,000 messages, and one same-length copy edit; input stringify, equality checks, disk, watcher, and browser were excluded from timing. Every pair produced the same full parsed catalog. In [parse-compare-key.json](../benchmarks/results/parse-compare-key.json), p50 was 41.28→37.60 ms and p95 was 56.46→67.12 ms. The median per-pair difference was -2.64 ms, and 65 of 100 pairs were faster, but there was no evidence of p95 improvement.

The actual watcher and browser trial is in [live-update-key.json](../benchmarks/results/live-update-key.json). With warmup 5, 50 measurements, 25 controls, server file instrumentation on, and detailed browser instrumentation and CPU profiler off, small p95 was 131.13 ms and large p95 was 367.88 ms. fileWrite p95 was also high at 49.44 and 40.49 ms, and control round-trip p95 was 13.05 and 15.18 ms. These values are not treated as reproducing a code regression, but because no tail-latency improvement was confirmed, the branch was **reverted**. The trial results are an experiment record with a changed `json.js` hash and are distinct from final-runtime results.

## Line-position index optimization — applied locally

In `diagnostics.ts`, `createPositionLocator` changed from checking every UTF-16 character one at a time to finding only LF positions with `source.indexOf('\n')`. The lineStarts array and binary-search lookup remain. The JSON parser, ICU, duplicate-key checks, message reuse, and freezing behavior were unchanged.

[parser-stages-position-after.json](../benchmarks/results/parser-stages-position-after.json) was produced by `node benchmarks/live-update/parser-stages.mjs benchmarks/results/parser-stages-position-after.json` in a separate run with the same fixture and options. The final changes on reference revision `d64199c` are identified by `workingTreeStatus` and `codeHashes`.

| Parser-internal p95 | 1k before | 1k after | 10k before | 10k after |
| --- | --- | --- | --- | --- |
| Line-position index creation | 0.291 ms | 0.014 ms | 3.449 ms | 0.087 ms |
| Total JSON | 2.86 ms | 2.76 ms | 38.08 ms | 29.94 ms |
| Message loop | 1.12 ms | 1.11 ms | 10.40 ms | 6.68 ms |
| Final freezing | 0.70 ms | 0.83 ms | 13.01 ms | 9.26 ms |
| Parser total | 4.80 ms | 4.69 ms | 60.20 ms | 41.79 ms |

Because total parser time and unchanged JSON, message-loop, and freeze stages also changed, the full reduction is not attributed to the position-index change. These are parser-only synchronous call elapsed times and are not converted to on-screen latency or CPU time.

The core build and 25 catalog and patch tests passed. UTF-16 column numbers were checked at every offset for LF, CRLF, empty source, consecutive and trailing LF, and astral Unicode, and escaped newlines in JSON strings were distinguished from actual LF. Tests also covered escaped keys and decoded duplicate IDs, ICU error positions, AST reuse for identical copy, source reorder and length changes, uniform position shift, deleted keys, and full recovery.

The final runtime was remeasured for actual updates with `node benchmarks/live-update/run.mjs --server-file-stages --out benchmarks/results/live-update-position.json`. Conditions in [live-update-position.json](../benchmarks/results/live-update-position.json) were warmup 5, 50 measurements, 25 controls, server file instrumentation on, and detailed browser instrumentation and CPU profiler off. Executed code was identified by the final `diagnostics.js` hash on reference revision `d64199c`. The JSON parser hash matched the baseline, confirming that key-decoding trial did not remain in final code.

| Scenario | save→DOM ack p50 | save→DOM ack p95 | read p95 | parse p95 | receive→commit p95 | control round-trip p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1k×3 locales | 64.32 ms | 72.66 ms | 1.13 ms | 5.21 ms | 4.90 ms | 7.29 ms |
| 10k×20 locales | 153.44 ms | 165.94 ms | 1.31 ms | 41.89 ms | 34.10 ms | 4.98 ms |

Before the position-index change, the same server-file instrumentation options produced p95 71.85 ms for small and 180.93 ms for large. Control round trips also fell from 10.26 to 7.29 ms and from 7.18 to 4.98 ms, so the full end-to-end reduction is not treated as an optimization effect. The large p95 ≤ 100 ms target is still not met.

Final parser-only raw samples had 60 each (50 measured), and actual-update raw samples had 55 each (50 measured). Timing, server, file-stage, and control summaries and actual source hashes were compared. Every actual-update measurement had one patch message, zero position updates, and zero full responses; input nodes and values and component state remained, and type files were not rewritten. Temporary fixtures, browser profiles, baseline compile directories, and corresponding browser processes were cleaned up.

The next bottleneck candidates are JSON token scanning and final freezing and message-map construction. The earlier key-decoding shortcut is not adopted again as a stable improvement; examine reducing temporary entry arrays and regex match objects created during parsing, plus allocations for unchanged positions and messages. Preserve error positions, decoded duplicate IDs, schema changes, and full-resync contracts. Remaining locale-addition latency and comparisons with other tools are separate work. This change is a local implementation and is not yet in npm `0.1.0-alpha.1`.
