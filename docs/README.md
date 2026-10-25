# Documentation guide

Alpha.7 was published on 2026-10-25. The five public packages use `0.1.0-alpha.7`; Vue stays private at `0.1.0-alpha.4` with its core dependency on `0.1.0-alpha.7`. The [alpha.7 release record](../releases/0.1.0-alpha.7.md) is the authoritative publication and verification summary, and the [CI-approved manifest](../releases/0.1.0-alpha.7.json) records artifact integrity. The earlier [alpha.6 release record](../releases/0.1.0-alpha.6.md), [alpha.6 manifest](../releases/0.1.0-alpha.6.json), [alpha.5 release record](../releases/0.1.0-alpha.5.md), and [alpha.5 manifest](../releases/0.1.0-alpha.5.json) remain as historical evidence.

This directory holds Saylo's design contracts and local validation records. Design drafts are mixed with current behavior that has already been implemented and validated, so if the documents and the actual code disagree, the current code in `packages/*/README.md` and `packages/*/src` takes precedence. In this directory, `proposal`, `goal`, `unresolved`, and `unvalidated` describe design intent, while labels such as `local implementation complete` indicate the scope of validation that was run. [08-update-protocol.md](08-update-protocol.md) is the single source of truth for the update wire, and measured and directly verified records are in [06-validation-and-roadmap.md](06-validation-and-roadmap.md).

Items that have passed local validation are recorded both in this directory and in `packages/*/README.md`. Documents do not claim completion for features that have not been implemented yet.

See [support guide](../SUPPORT.md) for questions and feature proposals, and [security guide](../SECURITY.md) for private security reports.

Dependency patch updates, Renovate approvals, and the release audit procedure are in [dependency updates](dependency-updates.md).

Automated accessibility checks for the development examples' modals and locales are in [demo accessibility checks](demo-accessibility.md).

## Reading order

For application setup, see [Vite init](init.md) or the source checkout's [SvelteKit init preset](init-sveltekit.md).

The source checkout also supports an optional [runtime translation error policy](runtime-error-policy.md).

The procedure for starting from an empty folder with a published package is in [getting-started.md](getting-started.md).

The current scope of the Svelte adapter and demo is summarized in [38-svelte-adapter.md](38-svelte-adapter.md). Existing performance measurement records are preserved as they are.
The SvelteKit example's real request, page navigation, shutdown, and re-entry connections are summarized in [39-sveltekit-example.md](39-sveltekit-example.md).

1. [01-product-and-scope.md](01-product-and-scope.md) — why it exists, what it does not do, and the DOM preservation scope
2. [02-architecture.md](02-architecture.md) — development propagation path, layer structure, state model, and ownership
3. [03-catalog-and-api.md](03-catalog-and-api.md) — catalog format, argument contracts, and public API
4. [04-live-update-and-types.md](04-live-update-and-types.md) — update decisions, recovery, and type generation rules
5. [05-build-and-ssr.md](05-build-and-ssr.md) — production builds, SSR, and security
6. [06-validation-and-roadmap.md](06-validation-and-roadmap.md) — performance targets and measurement definitions, acceptance cases, and roadmap
7. [07-decisions.md](07-decisions.md) — decision log and open items
8. [08-update-protocol.md](08-update-protocol.md) — single source of truth for the update wire protocol
9. [10-performance-measurements.md](10-performance-measurements.md) — local benchmark results and profile records
10. [11-parser-measurements.md](11-parser-measurements.md) — parser internal costs and optimization validation
11. [12-locale-add-measurements.md](12-locale-add-measurements.md) — measurements of new locale listing and first-translation propagation
12. [13-paraglide-comparison.md](13-paraglide-comparison.md) — same-scale Paraglide measurements and observations of initial preparation failures
13. [14-locale-add-server-measurements.md](14-locale-add-server-measurements.md) — server read, parse, and validation costs for adding locales at scale
14. [15-simple-message-parser.md](15-simple-message-parser.md) — simple message parsing optimization and cold cross-comparison
15. [16-compact-catalog-transport.md](16-compact-catalog-transport.md) — compact development transport and validation for lazy full catalogs
16. [17-cold-parser-measurements.md](17-cold-parser-measurements.md) — internal phases and GC observations when parsing a new catalog
17. [18-shared-argument-schemas.md](18-shared-argument-schemas.md) — sharing identical argument schemas and cold cross-comparison
18. [19-ast-freeze-measurements.md](19-ast-freeze-measurements.md) — parser-owned AST freeze optimization and cold/incremental comparison
19. [20-locale-add-remeasurement.md](20-locale-add-remeasurement.md) — end-to-end remeasurement of locale addition and selection after optimization
20. [21-locale-add-server-remeasurement.md](21-locale-add-server-remeasurement.md) — server phases for the current large-scale locale addition and next parser candidates
21. [22-relative-position-sharing.md](22-relative-position-sharing.md) — simple AST relative coordinate and range sharing, and parser comparison
22. [23-position-sharing-locale-add.md](23-position-sharing-locale-add.md) — remeasurement of listing and first-translation propagation after relative position sharing
23. [24-full-selection-browser-stages.md](24-full-selection-browser-stages.md) — full decoding, freezing, and snapshot instrumentation for the first language selection
24. [25-core-outcome-acceptance-stages.md](25-core-outcome-acceptance-stages.md) — separating core response validation and freezing, and candidates for removing duplicate traversals
25. [26-shared-catalog-freeze.md](26-shared-catalog-freeze.md) — sharing the Vite/core deep-freeze path and before/after comparison under the same conditions
26. [27-shared-freeze-locale-add.md](27-shared-freeze-locale-add.md) — 50-run remeasurement of listing and first-translation propagation under general prebundle settings
27. [28-full-reply-stages.md](28-full-reply-stages.md) — instrumentation of phases after full response preparation and receipt in the default prebundle
28. [29-prebundle-client-stages.md](29-prebundle-client-stages.md) — instrumentation of post-client-receipt, publication, and commit phases in the default prebundle
29. [30-prebundle-freeze-sharing.md](30-prebundle-freeze-sharing.md) — sharing freeze trust for a normal prebundle through a core root import
30. [31-prebundle-freeze-locale-add.md](31-prebundle-freeze-locale-add.md) — 50-run remeasurement of locale listing and first-translation propagation with detailed instrumentation off
31. [32-prebundle-server-measurements.md](32-prebundle-server-measurements.md) — remeasurement of server file phases and parser costs for the current large listing
32. [33-owned-message-freeze-trial.md](33-owned-message-freeze-trial.md) — comparison results and rollback of an experiment that froze messages and positions directly
33. [34-message-freeze-stages.md](34-message-freeze-stages.md) — separation of AST, absolute position, and record freeze phases, plus next candidates
34. [35-shared-ast-seal.md](35-shared-ast-seal.md) — modularizing the AST freeze `seal` helper and cold/incremental cross-comparison
35. [36-shared-ast-seal-locale-add.md](36-shared-ast-seal-locale-add.md) — remeasurement of large locale listing and first-translation propagation after sharing the AST freeze seal, with detailed instrumentation off
36. [37-seal-locale-add-comparison.md](37-seal-locale-add-comparison.md) — isolated before/after locale-add comparison of seal sharing and the rollback decision
37. [40-simple-argument-trial.md](40-simple-argument-trial.md) — cold/incremental comparison and rollback of an experiment integrating simple parsing and argument collection
38. [41-json-entry-visitor-trial.md](41-json-entry-visitor-trial.md) — cold/incremental comparison and rollback of an experiment removing the temporary JSON entry array
39. [42-complete-translations.md](42-complete-translations.md) — optional translation key and namespace completeness checks for Vite production builds
40. [43-react-selectors.md](43-react-selectors.md) — contract and local validation for React selector fine-grained subscriptions, plus current publication status
41. [44-svelte-selectors.md](44-svelte-selectors.md) — contract and local validation for Svelte selector subscriptions, plus current publication status
42. [45-review-fixes-performance-baseline.md](45-review-fixes-performance-baseline.md) — current performance baseline for edit propagation and locale addition from review-fix commit `9cfb844`
43. [46-review-fixes-server-file-stages.md](46-review-fixes-server-file-stages.md) — instrumentation separating large read and candidate phases under the review-fix baseline
44. [47-json-field-scanner-trial.md](47-json-field-scanner-trial.md) — record of cross-comparing and rolling back JSON item regex consolidation
45. [48-parser-cpu-profile.md](48-parser-cpu-profile.md) — CPU samples and line attribution for the current parser, plus the next map-freeze candidate
46. [49-owned-message-map-freeze.md](49-owned-message-map-freeze.md) — skipping re-traversal of the parser-owned message map and cross-comparing edits and new parsing
47. [50-owned-message-map-live-measurements.md](50-owned-message-map-live-measurements.md) — real edit and locale-add measurements after map freeze optimization, and the missed target
48. [51-owned-message-map-comparison.md](51-owned-message-map-comparison.md) — end-to-end before/after cross-comparison of map freeze optimization, and the missed target
49. [52-server-runtime-tail.md](52-server-runtime-tail.md) — diagnosis of remaining read/candidate phases, GC, and timer delays, plus new parsing candidates
50. [53-completion-audit.md](53-completion-audit.md) — completion audit against the original explicit requirements and roadmap, and remaining work
51. [54-plain-argument-contracts.md](54-plain-argument-contracts.md) — cold/incremental cross-comparison of plain argument contract reuse and local adoption
52. [55-next-turn-edits.md](55-next-turn-edits.md) — Vite/browser cross-comparison of merging edits in the next turn, and the missed edit target
53. [56-thin-layer-contract-probe.md](56-thin-layer-contract-probe.md) — 36 contract probes observed on i18next/Wuchale public extension points, and deferral of the full layer assessment
54. [57-thin-layer-browser-probe.md](57-thin-layer-browser-probe.md) — eight thin-layer browser feature smoke scenarios, state preservation, and deferral of performance, SSR, and lazy decisions
55. [58-trailing-disk-rechecks.md](58-trailing-disk-rechecks.md) — recovery of watcher throttle through 60 ms trailing disk rechecks after the first publication, and a record of the missed edit target
56. [59-json-leaf-edits.md](59-json-leaf-edits.md) — parser and browser measurements for single-string edits of JSON leaves, and a record of the missed locale-add target
57. [60-next-turn-additions.md](60-next-turn-additions.md) — immediate reading of new locale files in the next turn, server file phases, parser trial rollback, and the latest single-run record
58. [61-superseded-parse-reuse.md](61-superseded-parse-reuse.md) — reuse of superseded successful parses, reproduction of the immediately preceding 60 single-read assertion failure, and failure to reach performance stability

59. [62-multi-read-measurements.md](62-multi-read-measurements.md) — ownership and interval union instrumentation for multi-read batches, and 25-run remeasurement under detailed conditions

60. [63-thin-layer-timezone.md](63-thin-layer-timezone.md) — host timezone leakage in the thin layer timezone probe and the named-style bypass gap

61. [64-thin-layer-timezone-adapter.md](64-thin-layer-timezone-adapter.md) — timezone pinning in an adapter that implements i18nFormat directly, results for Node 336 and eight browser steps, and production parser boundary risks

62. [65-thin-layer-ast-production.md](65-thin-layer-ast-production.md) — validation that the benchmark-only AST runtime helper removes parser emission from the layer-ast production build

63. [66-thin-layer-ssr-production.md](66-thin-layer-ssr-production.md) — SSR hydration of a 12-page host-timezone matrix from a real production client, and validation of a missing-pair bug fix

64. [67-thin-layer-lazy-contracts.md](67-thin-layer-lazy-contracts.md) — cross-validation of 14 scenarios for the standalone i18next lazy coordinator and partial production loading

65. [68-thin-layer-lazy-browser.md](68-thin-layer-lazy-browser.md) — 12 compact and patch wire steps for the core and layer fixtures in a real Chromium/Vite dev environment, and resetting Vite's default reload state after the real socket closes

66. [69-thin-layer-typegen.md](69-thin-layer-typegen.md) — real Vite dev typegen worker and nine consumer steps with strict and checkJs, confirming error checks with an any-return control declaration

67. [70-thin-layer-lazy-production-browser.md](70-thin-layer-lazy-production-browser.md) — 12 steps of static HTTP and headless Chromium lazy partial loading for two real Vite production builds, and observation of a missing parser marker

68. [71-thin-layer-lazy-session-browser.md](71-thin-layer-lazy-session-browser.md) — 12 steps × 2 covering deferred and reordered product replies, locale supersession, and ignoring late replies after session replacement in two real Vite dev server fixtures

69. [72-thin-layer-sync-construction.md](72-thin-layer-sync-construction.md) — synchronous constructor contracts, 64 unit tests, and rechecking typegen and production browser with --sync

70. [73-thin-layer-runtime-cost.md](73-thin-layer-runtime-cost.md) — isolated runtime costs of the synchronous layer and core, and snapshot-retained heap deltas at 1k and 10k

71. [74-immutable-validation-reuse.md](74-immutable-validation-reuse.md) — reuse of deep-frozen identity pair validation, isolated costs and CPU samples, and a record of the missed small edit target
72. [75-early-disk-rechecks.md](75-early-disk-rechecks.md) — rejection of a 10 ms early recheck on its own and adoption of a 30 ms complement, enqueue origin breakdown, and small/large ABBA

73. [76-runtime-decision.md](76-runtime-decision.md) — runtime form decision: keep an independent runtime, continue reusing the FormatJS parser and IMF, and do not adopt the i18next prototype


74. [77-local-release-readiness.md](77-local-release-readiness.md) — pre-release local check, tarball, and SvelteKit browser validation, plus follow-up to alpha.4 publication
75. [alpha.4 release](../releases/0.1.0-alpha.4.md) — CI, OIDC publication, approval integrity, and consumer acceptance for registry JS/TS and SvelteKit
76. [78-rich-text-parts.md](78-rich-text-parts.md) — `tParts` contract, marker syntax, and errors for the first rich text core API slice
77. [79-react-rich-text.md](79-react-rich-text.md) — contract, key rules, demo, and validation scope for the React rich text render helper `renderRichText`
78. [80-svelte-rich-text.md](80-svelte-rich-text.md) — contract, key rules, demo, and validation scope for the Svelte rich text component `RichText.svelte`
79. [81-implementation-status.md](81-implementation-status.md) — 2026-10-24 `main` `7ccfdba`, product source `7ccfdba`, freeze candidate `d3e5252`; distinction between candidate, version promotion, npm publication, and registry consumer acceptance
80. [82-admin-support-pilot.md](82-admin-support-pilot.md) — fix for the Saylo production typegen lock in the admin customer support screen and results of the partial translation pilot
81. [83-push-subscription-maintenance.md](83-push-subscription-maintenance.md) — push subscription renewal after locale cache eviction, targeted regression validation, and current benchmark results
82. [84-large-catalog-performance.md](84-large-catalog-performance.md) — `9a20620` snapshot copy in a single traversal, `7a84418` single-string edit reuse, parser 100 pairs, and edit/locale-add browser ABBA results
83. [85-remaining-edit-bottlenecks.md](85-remaining-edit-bottlenecks.md) — `35b1350` sparse patch and validation traversal, `7ccfdba` removal of owned patch recopy, and the final edit large 50-run 100 ms p95 decision

Development client handshake state contracts are in [dev-sync-state.md](dev-sync-state.md).
The React guide for starting from an empty folder with the npm release is in [getting-started-react.md](getting-started-react.md).
The Svelte 5 guide is in [getting-started-svelte.md](getting-started-svelte.md).
The Vue 3 guide for exporting a local tarball into a standalone project is in [getting-started-vue.md](getting-started-vue.md).
The React 19 and Svelte 5 guides for exporting a local tarball into a standalone project are in [examples/react-starter](../examples/react-starter/README.md) and [examples/svelte-starter](../examples/svelte-starter/README.md). Export with `npm run prepare:starter:react -- --out-dir <empty folder outside the repository>` and `npm run prepare:starter:svelte -- --out-dir <empty folder outside the repository>`, and run local validation with `npm run verify:starter:react:local` and `npm run verify:starter:svelte:local`.
The SvelteKit 3 guide, including per-request SSR, hydration, and layout lifetimes, is in [getting-started-sveltekit.md](getting-started-sveltekit.md).
The collection, review, reset, and submission procedure for support diagnostic JSON is in [support-report.md](support-report.md). Both APIs are currently unpublished local changes.

The existing detailed history of validation and the roadmap is preserved in [06-validation-history.md](06-validation-history.md).

## Status labels

| Label | Meaning |
| --- | --- |
| Confirmed | Item confirmed as a user goal |
| Design choice | Technical decision proposed as an implementation direction. Not yet validated; may change. |
| Target | Performance number that has not been measured. This is not a claim of achievement. |
| Unresolved | Item not yet decided or confirmed |
| Unvalidated | External fact (deployment status, ecosystem support, etc.) has not been confirmed |

## Writing principles

The current release is documented in the [alpha.7 release record](../releases/0.1.0-alpha.7.md). The [alpha.6 release record](../releases/0.1.0-alpha.6.md) and earlier [alpha.5 candidate plan](../releases/0.1.0-alpha.5-plan.md) remain historical evidence. Read candidate validation, version promotion, npm publication, and registry consumer acceptance as separate states.

- Write document prose in clear English.
- Do not state that a feature is available before it has been built.
- Do not include unsupported numbers, versions, or ecosystem claims. Separate confirmed facts from proposals.
- Mark items that have not been validated as unvalidated.
- Keep each document under 40 KB. A document that starts exceeding that size is a candidate for splitting.
