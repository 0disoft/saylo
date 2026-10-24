# 81. Implementation status and remaining scope

This document summarizes implementation status and release boundaries on `main` at `7ccfdba6ca9a0628246620eba13d7c98f82f0bd9` (`7ccfdba`) on 2026-10-24. Current product source is `7ccfdba`. `35b13504ccfb14098c54f51f55863361514bbd29` (`35b1350`) reduced sparse-patch and validation traversal; `7ccfdba` removed a map recopy of owned patch results. `14cea4c852e074bf1e6ccaa9da8b346c7f21c841` (`14cea4c`) aligned profile boundaries with the current bounded-catalog presence check. Earlier, `9a206208cab6d806ba4e83db76088587c574ac30` (`9a20620`) and `7a844187661c062cf3d3d2726db53de8df7c9ac6` (`7a84418`) reduced snapshot-copy and single-string edit costs. The latest frozen candidate's product source remains `d3e5252b98b975b89b5a86d1f39b363471298e65` (`d3e5252`) and does not include these optimizations.

Implementation of roadmap stages 1 through 13 is complete, and per-stage completion criteria remain in [06](06-validation-and-roadmap.md). This document does not claim that all 13 stages were recently rerun.

## Current source by feature

### core

| Area | Current source |
| --- | --- |
| catalog parsing | [catalog-json.ts](../packages/core/src/catalog-json.ts), [simple-message.ts](../packages/core/src/simple-message.ts), [schema.ts](../packages/core/src/schema.ts), [rich-text.ts](../packages/core/src/rich-text.ts) |
| runtime | [runtime.ts](../packages/core/src/runtime.ts), [translator.ts](../packages/core/src/translator.ts), [formatters.ts](../packages/core/src/formatters.ts) |
| store | [store.ts](../packages/core/src/store.ts) |
| lazy loading | [i18n.ts](../packages/core/src/i18n.ts), [loading-runtime.ts](../packages/core/src/loading-runtime.ts), [loading-registry.ts](../packages/core/src/loading-registry.ts) |

### Vite

| Feature | Current source |
| --- | --- |
| dev sync | [dev-sync.ts](../packages/vite/src/dev-sync.ts) |
| dev catalog source | [catalog-source.ts](../packages/vite/src/catalog-source.ts), [catalog-commit.ts](../packages/vite/src/catalog-commit.ts) |
| translation quarantine | [translation-quarantine.ts](../packages/vite/src/translation-quarantine.ts) |
| catalog push | [catalog-push.ts](../packages/vite/src/catalog-push.ts), [catalog-patch.ts](../packages/vite/src/catalog-patch.ts) |
| build automatic keys | [auto-key-analysis.ts](../packages/vite/src/auto-key-analysis.ts), [auto-keys.ts](../packages/vite/src/auto-keys.ts), [build-keys.ts](../packages/vite/src/build-keys.ts) |
| static SSR source | [static-catalog-source.ts](../packages/vite/src/static-catalog-source.ts), [server-source.ts](../packages/vite/src/server-source.ts) |

### typegen

| Feature | Current source |
| --- | --- |
| catalog CLI | [catalog-cli.ts](../packages/typegen/src/catalog-cli.ts) |
| translation workflow | [catalog-sync.ts](../packages/typegen/src/catalog-sync.ts), [catalog-import.ts](../packages/typegen/src/catalog-import.ts) |
| approvals | [catalog-approvals.ts](../packages/typegen/src/catalog-approvals.ts), [catalog-approve.ts](../packages/typegen/src/catalog-approve.ts), [review-check.ts](../packages/typegen/src/review-check.ts) |
| refresh | [catalog-refresh.ts](../packages/typegen/src/catalog-refresh.ts) |
| work context | [catalog-work-context.ts](../packages/typegen/src/catalog-work-context.ts), [catalog-workfile.ts](../packages/typegen/src/catalog-workfile.ts) |
| format preservation | [catalog-json-edit.ts](../packages/typegen/src/catalog-json-edit.ts) |
| import diff | [catalog-diff.ts](../packages/typegen/src/catalog-diff.ts) |

## Latest candidate and validation record

- The candidate's source commit is `d3e5252` and the proposed version is `0.1.0-alpha.5`. Candidate snapshots are in `.release/candidate-0.1.0-alpha.5-fTJYGI`, and the validation record is in `validation-1osDCF` in the same directory.
- The [maintenance review record](../review/maintenance-2026-10-23.json) verified `npm ci`, build, checks, release metadata, pack, and publish dry-run at `2026-10-23T10:49:27.507Z`. The full `npm run check` result of eight groups and 536 tests was reused from a successful run at `c6a1ad7`. After comparing that the only changed file was a pack-only watcher fixture, affected pack stages were rerun. This count is the validation record for the then-frozen candidate; it is not a result for current `7a84418` source or a 2026-10-24 rerun.
- All 14 public declarations are byte-identical to the comparison baseline. Pack stages verified independent installation and JS/TS consumption of local tarballs; SvelteKit validation separately verified tarball installation, client and SSR builds, and Chromium hydration and language switching.
- Candidate validation goes as far as local tarball consumption. No consumer acceptance installed the candidate version from the registry.

## Changes after candidate freeze

`a9e8b80` updates subscription scope after cache eviction in [catalog-source.ts](../packages/vite/src/catalog-source.ts), preventing locale and namespace pairs removed by push subscriptions from remaining in server scope. `19640b9` corrected push-receipt and batch-v3 instrumentation in the then-current source containing that change.

`9a20620` changed `immutableSnapshot` in [diagnostics.ts](../packages/core/src/diagnostics.ts) to copy and freeze child objects first, then `Object.freeze` the parent. It removed a path that traversed the already-copied new tree again to freeze it. `7a84418` uses ID and offset provenance left by a successful parse in [catalog-json.ts](../packages/core/src/catalog-json.ts) and [catalog.ts](../packages/core/src/catalog.ts), so a single-string value edit under the same rich policy parses only the changed token and reuses the remaining message record.

In translation validation in [schema.ts](../packages/core/src/schema.ts), `35b1350` replaced `Object.entries`, which constructed 10,000 message tuples at once, with iteration over own keys. [catalog-patch.ts](../packages/vite/src/catalog-patch.ts) skips serialization for unchanged messages and unchanged `richTextTags` references, and replaces `Object.assign` plus final key-array recomputation with direct copying and incremental counts. `7ccfdba` copies and freezes only caller-owned baselines and initial patch children, shares trusted immutable baseline children, and freezes new owned results without recopying them. The equality check in [catalog-registry.ts](../packages/vite/src/catalog-registry.ts) also exits as soon as it finds a message difference and skips references to identical messages.

The candidate's 536-test result for `d3e5252` therefore remains valid for that frozen input but is not a validation result for current product source. Current source `7ccfdba` passed core 122/122 and the relevant Vite and benchmark tests 102/102, plus core and Vite builds. The 102 tests cover client, lazy, patch, push, wire, live-registry, sync-state, and profile/comparison policy. This does not mean the full workspace suite passed or that a new candidate tarball passed framework browser consumer acceptance. Detailed reproduction, validation, and performance results are in [83](83-push-subscription-maintenance.md), [84](84-large-catalog-performance.md), and [85](85-remaining-edit-bottlenecks.md).

## Remaining work and release boundaries

- A core selector API is an optional follow-up. React and Svelte selectors are implemented in current source; whether to add a shared core selector API remains a separate decision.
- Multi-stage fallback and component interpolation through arguments are non-goals.
- The Vue adapter is implemented but is a `private: true` workspace at `packages/vue` and is not a publication target.
- A real app pilot, new candidate freeze and validation, version promotion, and publication are not included in this document's validation results.

| Item | Current state |
| --- | --- |
| Tracked `main` source | Five public packages and Vue are at `0.1.0-alpha.4`; Vue is `private: true`. |
| alpha.5 candidate snapshot | Five public packages are prepared at `0.1.0-alpha.5`. Vue remains at alpha.4 and `private: true` and was excluded from tarballs. |
| Version promotion | Not performed. Package manifests on `main` remain at alpha.4. |
| npm publication | Not performed. The publish stage was verified as a dry-run plan only. |
| Registry consumer acceptance | Not performed. The verified consumption path used local tarballs. |

## Interpreting performance and validation

The performance figures in [75](75-early-disk-rechecks.md) are historical measurements from 2026-10-11, not a reproduction of those conditions at current HEAD. Current edit-performance conditions and target determination are recorded in [85](85-remaining-edit-bottlenecks.md).

Current performance measurements are recorded separately from 75's historical values in [83](83-push-subscription-maintenance.md), [84](84-large-catalog-performance.md), and [85](85-remaining-edit-bottlenecks.md). The `19640b9` harness result in 83 is a local benchmark of the then-current source and does not imply acceptance of a new candidate or a performance improvement. In 84, the 10+10 snapshot-copy samples failed to meet the 250 ms locale-add target, and 20+20 large-edit samples failed to meet the 100 ms target while receive-to-commit time increased. The 100-pair single-value parser result in 84 is a same-process microbenchmark. The first sparse-patch ABBA in 85 also failed to meet the 100 ms p95 target, but the final 50-run measurement for `7ccfdba` had p50 62.4911 ms and p95 89.165 ms, meeting this condition's p95 target. This final value comes from one machine and one session and does not guarantee other environments or loads. These results do not establish causality or accept a new candidate. The historical values in [75](75-early-disk-rechecks.md) remain unchanged.

[82-admin-support-pilot.md](82-admin-support-pilot.md) is a historical record of the partial-translation pilot for the admin customer-support page and the production typegen lock fix. It does not propose follow-up scope or change this document's latest candidate baseline or validation results.
