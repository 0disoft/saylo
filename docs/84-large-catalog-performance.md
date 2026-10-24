# 84. Large-catalog snapshot copying and single-value edits

This records reducing traversal costs for copying immutable catalogs and editing a single string value on local `main` on 2026-10-24. Product source includes `9a206208cab6d806ba4e83db76088587c574ac30` (`9a20620`), which changed snapshot copying, and `7a844187661c062cf3d3d2726db53de8df7c9ac6` (`7a84418`), which added single-value edits. The current package version is `0.1.0-alpha.4`; no version promotion was performed.

The figures here come from local benchmarks. The validation record and SHA-256 hashes of 21 raw files are collected in the [review JSON](../review/large-catalog-performance-2026-10-24.json), committed in `78b181c`. The 50-run results in [83](83-push-subscription-maintenance.md) and historical values in [75](75-early-disk-rechecks.md) remain unchanged.

## Snapshot copying

Detailed client instrumentation for large locale-add recorded `freezeMs` as a candidate bottleneck. The initial observation is in [client stages](../benchmarks/results/large-catalog-before-client-stages.json) and [samples](../benchmarks/results/large-catalog-before-client-stages.10k-20-locales.samples.json). It is a five-sample, single-condition measurement and does not prove that freezing is the only cause of total latency.

[`immutableSnapshot`](../packages/core/src/diagnostics.ts) copies mutable catalogs received through transport while sharing subtrees that this module already froze. Before the change, it recursively copied child objects and then called `freeze` on the new copy. `freeze` traversed all children again, so one mutable catalog was traversed once for copying and again for freezing.

`9a20620` copies and freezes children first.

- For each object, first copy its children with `snapshot` or identify them as already-frozen subtrees.
- After all children are ready, freeze only the current object with `Object.freeze` and add it to the module's frozen set.
- Children of the new copy are already copied and frozen or are shareable immutable subtrees, so the entire tree is not traversed again for the parent.

Object copying traverses `Object.entries` once and preserves getter evaluation order. Null prototypes are reproduced, and `__proto__` is defined as an own data property so it does not invoke the prototype setter. Arrays process children first with `map`, then freeze the current array.

## Single-string editing

Before `7a84418`, `editValue` in [`readCatalogJson`](../packages/core/src/catalog-json.ts) already found the changed range via common-prefix and suffix diff and validated the complete single JSON token by parsing it with `JSON.parse` and checking for a string. That path nevertheless rebuilt `JsonEntry[]` for every ID, [`parseCatalog`](../packages/core/src/catalog.ts) reindexed `lineStarts` for the whole source, and the message loop traversed every entry and compared unchanged messages entry by entry.

`7a84418` reduced these three costs. It returns only the changed entry, computes positions inside the edited token from the previous message position, and copies remaining message records at once using provenance's physical-order array. In this benchmark's single-value edit path, neither before nor after performs a full JSON token scan.

[`catalog-json.ts`](../packages/core/src/catalog-json.ts) records provenance in a `WeakMap` only for successful `parseCatalog` calls. Provenance contains the successful source, a physical-order ID array, and three `Uint32Array` values: key offset, value offset, and value length. Catalogs received through transport or created by callers have no provenance, even when deeply frozen, so they use the full parser path.

[`catalog.ts`](../packages/core/src/catalog.ts) tries the fast path only when the rich-text policy signature, locale, namespace, and sourceName match the previous catalog.

1. `readCatalogEdit` finds one changed token via common-prefix and suffix diff plus binary search over value offsets.
2. It uses the fast path only when the changed range does not touch the opening or closing quote and parsing the complete token with `JSON.parse` yields a string.
3. Only the changed entry enters the message loop.
4. Remaining message records are copied using provenance's physical-order IDs; if length changed, only suffix positions and offsets are adjusted.

Offsets are stored in physical source order. Even when a numeric-looking key moves earlier under JavaScript object enumeration, suffix adjustment follows source order. The new message map has a null prototype, so `__proto__` is also stored as an ordinary ID.

The message map is filled by iterating the provenance ID array directly from start to end. Records before the changed message are copied unchanged; records after it are copied unchanged for same-length edits. When length changes, later records' position offsets shift by the delta, and values on the same line shift their columns. Copying and position adjustment occur in one pass without a separate bulk-copy phase. An initial bulk-copy candidate measured slower and was not adopted.

Position calculation is limited to the edited token. It adds the offset difference to the previous message position and does not rebuild a line-start array for the entire source. A JSON string token cannot contain an actual LF, so the line stays unchanged and only column and offset are adjusted. This locator is used only for positions inside the token.

Provenance's `Uint32Array` is shared for same-length edits. If length changes, the array is copied and only the changed entry's value length and suffix key/value offsets are adjusted. The previous catalog and its message records remain frozen, and the new catalog has a new map.

The fast path is not used for:

- previous catalogs created by a caller, received through transport, or lacking successful-parse provenance
- a different rich-text policy signature
- structural changes outside the value token, changes to multiple tokens, or edits that change JSON structure through quotes or escapes
- differences in locale, namespace, or sourceName
- a complete token that is not a valid JSON string

Invalid JSON falls back to the full parser path and produces the same diagnostics as before. Invalid ICU produces the same `CatalogError` diagnostic as before. [`catalog.test.mjs`](../packages/core/test/catalog.test.mjs) verifies that diagnostics based on the previous catalog match baseline diagnostics.

## Validation

- Core tests passed 122/122 on `7a84418` source.
- Targeted tests passed 67/67 on the same source, covering core catalog and rich text, Vite patch and live registry, and benchmark parser probe and comparison policy.
- `catalog.test.mjs` covers CRLF and indentation, numeric keys, `__proto__`, length increases and decreases, previous-snapshot immutability, branched edits, invalid-ICU diagnostic agreement, and rich-policy changes.
- The full 536-test workspace check was not run, and no new candidate freeze, pack, tarball, registry consumption, or deployment was performed. The review JSON's `freshFullWorkspaceSuite` is `false`.

## Single-value parser comparison

The `7a84418` build measured 100 alternating before/after pairs of incremental parses changing one same-length value in a 10,000-message catalog. There were 50 warmups, all in the same process. JSON stringification, equality checks, disk, watcher, validation, and browsers are excluded.

| Variant | p50 | p95 |
| --- | ---: | ---: |
| before `9a20620` | 16.809ms | 38.7013ms |
| after `7a84418` | 8.2033ms | 25.4513ms |

The median paired difference was −8.4756 ms and its p95 was −2.3437 ms; 97 of 100 pairs improved. The intermediate candidate's first comparison regressed and is not used as a final result. This table is the [single-value parser comparison](../benchmarks/results/single-value-parser-comparison-2026-10-24.json) rerun after the final implementation.

This is a same-process microbenchmark isolating parser calls. It excludes browser receipt, disk, validation, and perceived user latency and does not prove causality.

## Locale-add snapshot-copy ABBA

This is a small-sample browser locale-add large (10k×20) comparison of the snapshot-copy effect in `9a20620`. Before is `046fa4d`, after is `9a20620`, in before/after/after/before order, with 5 samples per block, 10 pooled samples per variant, 1 warmup, and 5 calibrations.

| Metric | before p50 | after p50 | before p95 | after p95 |
| --- | ---: | ---: | ---: | ---: |
| save→list ack | 394.12 ms | 350.07 ms | 996.66 ms | 818.33 ms |
| select→translation ack | 624.55 ms | 502.72 ms | 1,136.54 ms | 869.99 ms |
| save→translation ack | 994.74 ms | 812.81 ms | 2,155.57 ms | 1,709.99 ms |
| select→DOM commit | 620.50 ms | 499.10 ms | 1,132.90 ms | 865.20 ms |
| save→broadcast | 379.00 ms | 340.43 ms | 949.45 ms | 799.89 ms |
| file write | 43.76 ms | 33.42 ms | 145.87 ms | 633.93 ms |
| control round trip | 10.67 ms | 6.03 ms | 69.46 ms | 20.28 ms |

Values are rounded to two decimal places from milliseconds in the raw JSON. Save-to-list ack was within 250 ms in 2 of 10 before samples and 3 of 10 after samples. Both p50 and p95 exceeded the 250 ms target and failed to meet it. The after file-write p95 reflects a large delay in one sample; this small sample does not support conclusions about file-I/O effects.

Measurements were independent sequential fresh Vite and browser runs on the same machine in reversed blocks. There was no sample-level pairing, random ordering, forced GC, or subtraction of control, GC, or cross-process clocks. This is a 10+10 small sample on one machine, so it does not prove causality and is not compared directly with the 50-run results in [83](83-push-subscription-maintenance.md).

Raw results are in the [summary JSON](../benchmarks/results/snapshot-copy-locale-comparison-2026-10-24.json) and four run files.

## Large-edit browser ABBA

This browser ABBA compares `9a20620` and `7a84418` for large edit (10k×20) with 10 samples per block, 20 pooled samples per variant, 2 warmups, and 10 calibrations, in before/after/after/before order. One value was edited. Save→ack includes the HTTP acknowledgement; receive→commit is the client interval from receipt through commit.

| Metric | before p50 | after p50 | before p95 | after p95 |
| --- | ---: | ---: | ---: | ---: |
| save→ack | 148.2024 ms | 114.0775 ms | 245.1552 ms | 198.4887 ms |
| save→manifest broadcast | 93.1745 ms | 55.4344 ms | 193.3396 ms | 118.0490 ms |
| receive→commit | 42.6000 ms | 46.0000 ms | 47.7000 ms | 59.0000 ms |

Save-to-ack was within 100 ms in 2 of 20 samples both before and after. Both p50 and p95 exceeded the 100 ms target and failed to meet it. Receive→commit grew from p50 42.6→46 ms and p95 47.7→59 ms. This sample does not establish why that interval grew.

File write was before p50 19.6879 ms and p95 42.2344 ms, after p50 13.4155 ms and p95 32.8843 ms. Control round trip was before p50 4.4321 ms and p95 6.8805 ms, after p50 3.9337 ms and p95 6.7810 ms.

Independent sequential fresh Vite and browser runs were executed on the same machine in reversed blocks, with no random ordering, sample-level pairing, forced GC, or control subtraction. This is a 20+20 sample on one machine, so it does not prove causality or generalize to other machines or conditions. No new 50-run browser measurement was added.

Raw results are in the [summary JSON](../benchmarks/results/single-value-edit-comparison-2026-10-24.json) and four run files.

## Release boundaries

- `9a20620` and `7a84418` are local `main` commits and were not pushed. `78b181c` is a local commit containing the validation record and raw hashes. No npm publication, version promotion, or new candidate freeze was performed.
- `.release/candidate-0.1.0-alpha.5-fTJYGI` is the frozen candidate from `d3e5252` and does not include either optimization.
- Further application of the admin support pilot ([82](82-admin-support-pilot.md)) is outside this document's scope.

## Raw results and hashes

- [Validation record and 21 evidence hashes](../review/large-catalog-performance-2026-10-24.json) — `78b181c`
- [Single-value parser comparison](../benchmarks/results/single-value-parser-comparison-2026-10-24.json)
- [Snapshot-copy locale-add comparison](../benchmarks/results/snapshot-copy-locale-comparison-2026-10-24.json)
- [Single-value large-edit comparison](../benchmarks/results/single-value-edit-comparison-2026-10-24.json)
