# 06. Validation and Roadmap

This document defines performance targets and measurement definitions, acceptance cases, build order, and the development roadmap.

## Performance targets

The figures below are targets. Some were measured with local benchmarks; the results and limitations are recorded in [detailed performance records](10-performance-measurements.md). In the isolated-snapshot ABBA run from [75](75-early-disk-rechecks.md) on 2026-10-11 (warmed, normal prebundle, typegen on), edit-application p95 was 49.57 ms for small (1k×3) and 80.25 ms for large (10k×20), both within the 100 ms target. Locale-list single-run p95 was 77.46 ms for small and 177.83 ms for large, both within the 250 ms target. Edit figures combine samples from both after runs; locale-list figures are a single run per condition. Large results vary substantially between runs, so this does not claim stable achievement or achievement on other operating systems or workloads. The first and repeat records for the earlier request-scoped patch are retained in [validation history](06-validation-history.md).

| Item | Target | Conditions |
| --- | --- | --- |
| Applying a catalog string edit during development | p95 ≤ 100 ms | Warmed, local reference environment |
| Showing the locale list after adding a locale | p95 ≤ 250 ms | Representative fixture. DOM application time for the new locale's first translation is reported separately |

### Measurement definitions

- The measurement starts when the file save finishes and the harness observes that save. It does not start when the save begins.
- End-to-end measurements use one Node monotonic clock. From file observation through the browser's DOM commit acknowledgment (ack), everything runs on the same clock. Because this value includes ack delivery, report that cost as well.
- Record receive-to-commit time inside the browser separately. Separating server and browser stages reveals the bottleneck.
- Do not add per-stage p95 values and present the sum as an end-to-end p95. Include stage values only for reference.
- `performance.now` in the development server and browser uses different clocks, so do not subtract the values directly. Measure on one clock with a control harness running in the same process, or state the synchronization error together with the number.
- Warm means that the app and formatters for unchanged messages are ready. The formatter for the edited message itself is not part of the warm condition. That message has new content, so its cost belongs to the edit.
- Locale addition has two distinct completion points. The first is when the locale appears in the selectable list; the second is when switching to that locale and the first translation reaches the DOM. Results are comparable only when defined with file count, total bytes, and namespace count.
- Report both p50 and p95 for edit application and locale addition.
- Do not generalize from benchmarks run only at small scale. Measure across scales, for example 1k/10k messages and 3/20 locales.
- Measure typegen cost and cold startup separately from edit-application figures.
- Do not inflate cost with a broad CI matrix. Run only the necessary combinations.

Earlier measurements and validation records are preserved in [validation history](06-validation-history.md).

## Current source validation (2026-10-11)

The local validation results for current source `0f7840f` (product `eb66af8`) are recorded in `38ee9be`. Evidence is in [review/local-readiness-2026-10-11.json](../review/local-readiness-2026-10-11.json) (86 input hashes) and [77](77-local-release-readiness.md).

- `npm run check` exited 0: five-package build and unit tests, five JS/TS consumption cases, the React example, and OIDC and registry unit checks.
- `npm exec -- node scripts/pack-smoke.mjs` exited 0: independent installation of five tarballs, CLI, typegen and README examples, Node translation and argument rejection, React SSR, React and Svelte selector SSR, Vite production lazy loading, rejection and recovery for incomplete translations, and SSR after removing development dependencies (observed with Vite 8.3.4).
- `npm exec -- node scripts/pack-sveltekit.mjs` exited 0: independent installation of five tarballs, svelte-check with 0 errors and 0 warnings, Vite 8.3.4 production Node and client builds, simultaneous ko/en SSR with matching boot and canonical fallback, listener cleanup and runtime cancellation, production HTTP, and Chromium 154 hydration, ko→en→ko switching, shared-layout state retention, exit, and re-entry.

This pack is a local proof combining unpublished follow-up code with `0.1.0-alpha.3` metadata; it is not the published `alpha.3` artifact. Selector public APIs are implemented in current source and verified with the local pack, but they are absent from the published build. Remote CI, OIDC, and registry comparison were outside this validation scope.

Subsequent release acceptance: remote CI with 229 tests, consumer type checks, and OIDC publishing succeeded for `0.1.0-alpha.4` at `d26506f`. It also passed approved CI, registry tarball SHA-512, external JS/TS and selector SSR, and SvelteKit Chromium consumption verification ([release record](../releases/0.1.0-alpha.4.md)). The alpha.3 pack paragraph above is a record from the prior local validation period.

## Acceptance cases


| # | Case | What is checked |
| --- | --- | --- |
| 1 | State preservation | Input values, modals, and scroll position remain after a copy edit |
| 2 | Add, edit, delete | Adding a key, editing a value, and deleting a key each converge |
| 3 | Parse recovery | Broken JSON or ICU retains the last valid value and emits a diagnostic |
| 4 | Reconnection and gaps | A new session or revision gap recovers through a full snapshot, and duplicate or stale patches are discarded. DOM preservation is not required after a Vite restart |
| 5 | Asynchronous type schema | Quarantine and fallback work when the baseline schema changes (quarantine is implemented in the plugin and passed unit, integration, and real-browser validation on 2026-10-07). Errors in existing calls after a key deletion or required-argument addition are diagnosed, and DOM preservation is not required |
| 6 | Format consistency | Variables and number/date/time, plural/select, and other formats produce identical dev/prod output with the same Intl locale data and runtime (fixed timeZone and fixed time input) |
| 7 | SSR concurrency | Locales and catalogs do not mix between requests |
| 8 | JS/TS consumption | Installation and consumption work in both JS and TS projects (smoke) |
| 9 | Union t types | Union keys must first be narrowed, and invalid or missing arguments are rejected |
| 10 | checkJs consumption | JSDoc-typed JS catches the same argument errors |
| 11 | New namespace loader | The general `loadCatalog` loads a namespace added after boot |
| 12 | Complete locale list | `availableLocales` is replaced with the complete list every time |
| 13 | Interleaved desired generation | `setLocale` and `loadNamespace` converge on the latest desired state even when they complete in interleaved order |
| 14 | Snapshot-bound hydration | During hydration, t reads S1, and S2 is applied only once after the barrier |
| 15 | JS runtime argument validation | Base required-argument validation also produces `InvalidArgumentError` in JS |

## Build order

The order is typegen (generate) → tsc (consumer type check) → build (Vite). Vite build itself does not typecheck consumer TypeScript, so tsc runs before build. Implementing separate package/version configuration files is outside this scope.

## Validation approach

- Update documentation and implementation together. Check public type declarations and consumer fixtures, run an actual production build and static-loader verification, and check Markdown links, JSON examples, code blocks, and file sizes. Record current implementation results in the stage-by-stage validation records in this document. For the documentation design review, see [review resolution record](../review/feedback-resolution.ko.md).
- A check that was not run is not a pass. Record documentation-link results item by item.
- Keep unverified items marked as unverified. Separate local measured performance records from targets.

## Roadmap

Proceed sequentially in small commits. Each stage aims to leave behind a usable demo. Initially load a small fixture eagerly to demonstrate state preservation, then refine transport under the same API. Steps 1–13 are implemented; the table below retains their completion criteria.

Follow [81-implementation-status.md](81-implementation-status.md) for the latest implementation and publication state and the remaining items.

| Order | Single responsibility of the commit | Completion criteria |
| --- | --- | --- |
| 1 | Contract changes and type fixtures | Reject union-key counterexamples and settle snapshot, locale-list, and fallback meanings |
| 2 | JSON/ICU parsing and baseline schema extraction | Determine duplicate IDs, syntax errors, and argument compatibility with small fixtures |
| 3 | AST formatting and pure snapshot lookup | t and fallback work with a fixed locale and timeZone |
| 4 | Immutable store and vanilla form demo | Text changes through eager snapshot replacement alone while input DOM remains |
| 5 | Vite change connection | Managed catalog edits appear in the demo without replacing app modules. This is the first core demo |
| 6 | add/unlink and listener cleanup | Handle locale and namespace additions, atomic saves, and reconnection after disposal |
| 7 | React typed context and snapshot-bound hook | The same state-preservation demo works in React while retaining types |
| 8 | Baseline typegen | Implement initial readiness, background generation, generation cancellation, and writing `.d.ts` only when content changes |
| 9 | Session/snapshot handshake and resync | Handle scoped snapshot requests, duplicates, gaps, and late responses |
| 10a | Lazy-loading core and switch reconciliation | Handle desired locale and namespace readiness, missing, failure, and stale results. Locally implemented |
| 10b | Vite general loader and partial transport | Connect new-namespace lookup after boot, per-pair versions and tombstones, loaded-scope updates, and the React demo. Locally implemented |
| 11 | Fresh production build | Connect current-disk validation → typegen → consumer checks → AST and static-loader output. Locally implemented |
| 12 | SSR serializer and hydration fixture | Verify per-request snapshots, boot escaping, and updates immediately before hydration. Locally implemented |
| 13 | Per-changed-message patch transport | Send only changed messages while preserving state and convergence. Reduces wire size and browser-verification and freezing cost. Locally implemented |

Steps 1–8 may load a small fixture eagerly. Steps 9–10 introduce the per-catalog version contract when partial transport and unloaded states arrive. The completion criteria above are the demo and validation goals for each stage; steps 1–13 are locally implemented.
