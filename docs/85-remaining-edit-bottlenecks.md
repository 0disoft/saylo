# 85. Remaining edit bottlenecks and the 100 ms target

This records reducing the remaining bottlenecks in single-key edits of large catalogs on local `main` on 2026-10-24. Product source includes `35b13504ccfb14098c54f51f55863361514bbd29` (`35b1350`) and `7ccfdba6ca9a0628246620eba13d7c98f82f0bd9` (`7ccfdba`). `14cea4c852e074bf1e6ccaa9da8b346c7f21c841` (`14cea4c`) fixes performance instrumentation boundaries. The package version is `0.1.0-alpha.4`; no version promotion was performed.

The target is to keep save-to-DOM-ack p95 within 100 ms when editing one key in a 10,000-message by 20-locale catalog. The final 50-run measurement met the p95 target under these conditions. It comes from one machine and one session and does not guarantee the same value on other environments, rendering workloads, or I/O conditions.

## Bottlenecks and changes

`35b1350` reduced repeated processing of retained messages in the edit path.

- Translation validation in [schema.ts](../packages/core/src/schema.ts) uses `for...in` with own-key checks instead of `Object.entries`, which constructed entry tuples for all 10,000 messages. It does not allocate a tuple array to traverse already validated messages.
- Patch construction in [catalog-patch.ts](../packages/vite/src/catalog-patch.ts) determines removals and upserts through an own-key array. It skips string-serialization comparisons when a message is the same object as before or its `richTextTags` reference is unchanged.
- Patch application does not copy the full message map with `Object.assign`. It copies own keys directly and maintains message counts incrementally for removals and upserts, avoiding a final key-array rebuild.

`14cea4c` changed the boundary in [runtime-profile.mjs](../benchmarks/live-update/runtime-profile.mjs) from searching for the old `Promise.all` code shape to checking for `mapFileTasks` in the current `bounded('Base catalog existence check', ...)`. All three runtime-instrumentation tests passed, including the check that verifies the current source transformation boundary.

`7ccfdba` reduced the large map recopy that occurred when freezing patch results again. A caller-supplied baseline is snapshotted with `freezeCatalogs(..., { copy: true })` to isolate it from external mutable input. Patch upsert children are also copied and frozen with `copy: true`. Position replacement uses new objects. Only the new owned map and root are frozen with `copy: false`, so child messages from a trusted immutable baseline are shared and the 10,000-entry map is not copied again after result construction.

The equality check in [catalog-registry.ts](../packages/vite/src/catalog-registry.ts) exits as soon as it finds a message difference. It avoids creating two `Object.keys` arrays to compare map sizes and skips identical message references before detailed comparison. Tests were also added to verify caller-input immutability and immutable-child sharing.

## Unit comparison

The [patch CPU comparison](../benchmarks/results/sparse-patch-cpu-2026-10-24.json) measured 100 alternating create/apply pairs over 10,000 messages with 20 warmups. Input patches were JSON round-tripped, and each pair's results were checked with deep equality. Input preparation and equality checks are outside timing. This is a same-process microbenchmark and excludes browser, disk, and watcher effects.

| Scenario | before p50 | after p50 | before p95 | after p95 | Improved pairs |
| --- | ---: | ---: | ---: | ---: | ---: |
| same length | 11.8751 ms | 7.4824 ms | 20.4303 ms | 11.3397 ms | 97/100 |
| uniform shift | 12.9193 ms | 9.0635 ms | 24.2372 ms | 16.2400 ms | 96/100 |
| mixed | 11.1258 ms | 7.8099 ms | 18.7796 ms | 12.8266 ms | 93/100 |

For apply alone, the three scenarios' p50 changed from 10.3902→3.7112 ms, 20.5433→9.8669 ms, and 12.1710→6.1609 ms. This table isolates patch-function cost and does not prove causality for perceived user latency.

## First browser ABBA

The [first sparse-patch ABBA](../benchmarks/results/sparse-patch-edit-comparison-2026-10-24.json) compared before `d0483a6` and after `35b1350` in before/after/after/before order, with 10 samples per block, 20 pooled samples per variant, 2 warmups, and 10 calibrations.

| Metric | before | after `35b1350` |
| --- | ---: | ---: |
| save→ack p50 | 93.2164 ms | 67.0457 ms |
| save→ack p95 | 118.7416 ms | 121.7816 ms |
| Samples within 100 ms | 14/20 | 18/20 |

The p50 and count within target improved, but p95 was 121.7816 ms and failed to meet the target. This comparison does not include final `7ccfdba`. It is not combined with the passing 50-run value to claim a causal effect from `35b1350` or `7ccfdba`.

## Final 50 runs

The [final measurement](../benchmarks/results/remaining-edit-final-2026-10-24.json) used `7ccfdba` with 5 warmups, 25 calibrations, and 50 samples, with detailed CPU, browser, server-file, reply, and client instrumentation disabled. It observed one-key edits in a 10,000-message by 20-locale catalog in Chromium headless React development mode, with two messages visible in the DOM. Save→ack includes the HTTP acknowledgement and excludes paint time.

| Metric | p50 | p95 | Minimum | Maximum |
| --- | ---: | ---: | ---: | ---: |
| save→ack | 62.4911 ms | 89.1650 ms | 42.8063 ms | 149.0247 ms |
| save→manifest broadcast | 27.2104 ms | 42.2542 ms | 16.7362 ms | 113.3524 ms |
| receive→commit | 31.3000 ms | 36.3000 ms | 20.8000 ms | 47.8000 ms |
| file write | 9.7603 ms | 12.3327 ms | 6.6416 ms | 12.6089 ms |

The p95 of 89.1650 ms met the 100 ms target. Of 50 samples, 49 were within 100 ms, and the maximum was 149.0247 ms. There were 50 patch replies and 50 push replies, with 0 request or full replies, and declaration files were not rewritten.

This is a 50-run result from one session on one local machine. Control round trips were not added to or subtracted from stage p95. The pass under these conditions does not generalize to other machines, loads, or rendering workloads.

## Validation and evidence

- Core tests passed 122/122 on `7ccfdba`, and client, lazy, patch, push, wire, live-registry, sync-state, and profile/comparison policy tests passed 102/102.
- Core and Vite builds passed.
- The dedicated review [remaining-edit-bottlenecks-2026-10-24.json](../review/remaining-edit-bottlenecks-2026-10-24.json) records execution conditions, determination, and SHA-256 hashes of 14 source files, committed in `b571d71`.
- The initial 10-run diagnostic [remaining-edit-stages-2026-10-24.json](../benchmarks/results/remaining-edit-stages-2026-10-24.json) and [samples](../benchmarks/results/remaining-edit-stages-2026-10-24.10k-20-locales.samples.json) are before samples with large I/O delays. They are not used to prove causality or compare before and after the final 50 runs.

The full workspace suite, new candidate freeze, pack, tarball consumption, git push, npm publication, deployment, and admin application are outside this scope. Historical measurements in [83](83-push-subscription-maintenance.md) and [84](84-large-catalog-performance.md) remain unchanged.
