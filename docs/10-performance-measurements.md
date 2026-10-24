# 10. Performance Measurement Records

Follow [06-validation-and-roadmap.md](06-validation-and-roadmap.md) for performance targets and measurement definitions. This document preserves the conditions, results, and limitations of earlier local benchmarks.

## Measured records (local)

Measurements used `npm run bench:live`. Result summaries are stored in [live-update.json](../benchmarks/results/live-update.json) (before optimization), [live-update-optimized.json](../benchmarks/results/live-update-optimized.json) (after live-update optimization), and [live-update-patch.json](../benchmarks/results/live-update-patch.json) plus [live-update-patch-repeat.json](../benchmarks/results/live-update-patch-repeat.json) (first run and rerun after request-scoped patches). Raw samples for each scenario are kept separately in the `live-update.<case>.samples.json` file referenced by each result. Method, conditions, and rerun options are in [benchmarks/live-update/README.md](../benchmarks/live-update/README.md).

The setup was 50 samples after 5 warmup runs and 25 control round trips. It used one namespace and rendered two messages (one changed key and one unchanged key), with loaded base `ko` and target `en`, and edited one body key in `en`. It used headless Chromium and React development mode without paint instrumentation. The environment was Windows x64, Node v24.18.0, Vite 8.3.2, AMD Ryzen 5 7430U, 12 logical CPUs, and 31.3 GiB memory.

## Before optimization (2026-10-06 KST, gitRevision 143215f)

| Scenario | Catalog | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | control round-trip p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1k×3 locales | 3 files, 110,292 B | 161.54 ms | 191.25 ms | 132.68 ms | 21.10 ms | 10.51 ms |
| 10k×20 locales | 20 files, 7,755,280 B | 1180.27 ms | 1693.98 ms | 722.26 ms | 299.90 ms | 39.69 ms |

Before optimization, save→DOM ack p95 exceeded the p95 ≤ 100 ms target in both scenarios. File-write p95 was 9.26 ms for small and 9.56 ms for large.

## After optimization (2026-10-06 KST, gitRevision 98a3ced)

| Scenario | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | control round-trip p95 |
| --- | --- | --- | --- | --- | --- |
| 1k×3 locales | 98.81 ms | 131.27 ms | 65.59 ms | 25.50 ms | 6.21 ms |
| 10k×20 locales | 472.51 ms | 819.55 ms | 176.41 ms | 260.60 ms | 11.53 ms |

Even after optimization, save→DOM ack p95 exceeded the target in both scenarios. File-write p95 was 10.79 ms for small and 9.35 ms for large; receive→commit p95 changed from 21.10 to 25.50 ms for small and from 299.90 to 260.60 ms for large.

| Scenario | Before p95 | After p95 | Reduction |
| --- | --- | --- | --- |
| 1k×3 locales | 191.25 ms | 131.27 ms | About 31% |
| 10k×20 locales | 1693.98 ms | 819.55 ms | About 52% |

These before/after values are separate single runs with the same fixture and options (warmup 5, 50 samples, 25 controls). Machine load varied between runs, so the full reduction cannot be attributed to code changes. Note that control round-trip p95 also fell from 10.51 to 6.21 ms for small and 39.69 to 11.53 ms for large. Neither value is a general guarantee.

Do not add per-stage p95 values to form end-to-end latency. Control round trips are shown only for reference and are neither added to nor subtracted from total latency. Do not subtract server and browser clocks from each other.

## After request-scoped patches (2026-10-06 KST, gitRevision 793d94f, first run)

This was the first run with the same fixture and options (warmup 5, 50 samples, 25 controls).

| Scenario | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | fileWrite p95 | control round-trip p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1k×3 locales | 77.58 ms | 224.31 ms | 199.82 ms | 8.50 ms | 61.51 ms | 10.37 ms |
| 10k×20 locales | 177.00 ms | 229.43 ms | 147.25 ms | 47.40 ms | 10.56 ms | 5.68 ms |

## Request-scoped patch rerun (2026-10-06 KST, gitRevision 793d94f, repeat)

This run used the same code and fixture. Results from both runs are preserved separately.

| Scenario | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | fileWrite p95 | control round-trip p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1k×3 locales | 65.24 ms | 76.65 ms | 64.99 ms | 5.30 ms | 8.92 ms | 9.34 ms |
| 10k×20 locales | 191.45 ms | 241.18 ms | 170.84 ms | 48.20 ms | 9.71 ms | 3.72 ms |

- Small (1k×3) had p95 224.31 ms in the first run, worse than 131.27 ms after optimization. The rerun was 76.65 ms, within the p95 ≤ 100 ms target. Because the runs differ, a stable target achievement for small is not claimed.
- Large (10k×20) had p95 229.43 and 241.18 ms in the two runs, exceeding the target. p50 was 177.00 and 191.45 ms, and receive→commit p95 fell substantially from the previous 260.60 ms to 47.40 and 48.20 ms.
- The first run's fileWrite p95 of 61.51 ms and broadcast p95 of 199.82 ms were higher than 8.92 and 64.99 ms in the rerun. No independent load-profile measurement exists, so the cause is not established; only the observed file-write and server-stage delays are recorded.
- In both runs, all 50 edits per scenario received patch responses and zero received full responses. There were at most one upsert and zero position updates. Because token length stayed constant in the measured interval, `positionShift` occurred only during warmup.
- Catalog response size was calculated as the UTF-8 size of `JSON.stringify` on the response object passed to `client.send`, after capturing the ack clock. p95 was 931 B for small and 936 B for large. This is catalog-response JSON and excludes WS headers, compression, and manifest packets; it is not the total physical network byte count. It also differs from the reconstructed sizes in [live-update-wire-sizes.json](../benchmarks/results/live-update-wire-sizes.json).
- Every ack retained input-node identity and values and component state, and the generated `.d.ts` was not rewritten. Each of the four cases across two runs had 55 raw samples (50 measured), and summaries for five timing metrics matched nearest-rank values. No temporary benchmark fixture or profile directories and no matching browser processes remained after the runs.

## Cause profile and optimization

A 10-sample large scenario was run with `node --cpu-prof`, and samples after the first channel handler following startup were inspected. Repeated freezing, `parseCatalog`, and WebSocket stringify cost were identified. The following changes reduced that cost.

- Replace core's deep-freeze self-check with WeakSet lookup so already frozen objects are not checked again.
- Create only one `Intl.Locale` object per catalog.
- Reuse schemas for deeply frozen catalogs through a WeakMap.
- Replace schema fingerprints with an 87-character fixed-length v2 digest instead of v1's full normalized string.
- Pass the previous `ParsedCatalog` to `parseCatalog` so ASTs and arguments for messages with unchanged copy can be reused.

The request-scoped patch round added the following.

- Reuse a `validateTranslation` result when the deeply frozen translation argument schema and base-message argument schema are the same objects as in the previous validation and IDs match; revalidate mutable inputs or changed contracts and keys.
- Server pair-version decisions compare key, source, and position directly without sorting or stringifying.
- When positions shift uniformly, compress the position list into one `positionShift`.

## Wire-size reconstruction

Manifest frame sizes were compared with the separate reconstruction tool [manifest-size.mjs](../benchmarks/live-update/manifest-size.mjs). It reconstructs update-envelope JSON for existing v1 and current v2 and compares UTF-8 bytes only; it is not an actual network measurement. Results are in [live-update-wire-sizes.json](../benchmarks/results/live-update-wire-sizes.json). Small (1k×3) changed from 162,256 B to 871 B and large (10k×20) from 10,980,273 B to 4,373 B. Fingerprint strings changed from 45,886 characters to 87 and from 468,886 characters to 87. Run with `node benchmarks/live-update/manifest-size.mjs`.

## Parser optimization and profile (2026-10-06)

Uncommitted parser optimizations in the worktree were measured. All four runs used `gitRevision` baseline commit `4d1f6fc`. Before ran that committed runtime; context-trial, after, and parser ran uncommitted changes on top of it. [live-update-profile-after.json](../benchmarks/results/live-update-profile-after.json) and [live-update-parser.json](../benchmarks/results/live-update-parser.json) identify core and vite `dist` files and the harness through `codeHashes`; the two files have identical hashes, showing the same runtime was measured. Before and context-trial predate codeHashes and are distinguished by revision and changes.

| Run | Conditions | Result file |
| --- | --- | --- |
| before | Original HEAD runtime | [live-update-profile-before.json](../benchmarks/results/live-update-profile-before.json) |
| context-trial | Only diagnostics context spread changed | [live-update-profile-context-trial.json](../benchmarks/results/live-update-profile-context-trial.json) |
| after | Final parser, `--cpu-profile` on | [live-update-profile-after.json](../benchmarks/results/live-update-profile-after.json) |
| parser | Final parser, profiler off, both scenarios | [live-update-parser.json](../benchmarks/results/live-update-parser.json) |

Before, context-trial, and after measured only large (10k×20). The parser run measured small (1k×3) and large (10k×20) with warmup 5, 50 samples, and 25 controls. Stage values are reference values measured by a benchmark-only wrapper and are not summed or converted to end-to-end values.

`readAndCandidateMs` includes path validation, file read, parsing, candidate preparation, base stat, and waiting for serialized drain. It does not separate read from parse, so a large value alone does not establish the composition of read and parse costs.

| Stage p95 (large) | before | context-trial | after |
| --- | --- | --- | --- |
| readAndCandidateMs | 65.23 ms | 129.06 ms | 154.00 ms |
| validationMs | 25.23 ms | 51.42 ms | 381.20 ms |
| registryReplaceMs | 8.15 ms | 18.30 ms | 12.40 ms |
| catalogDeltaMs | 18.78 ms | 28.52 ms | 23.54 ms |

Large delays were observed in the after run with the profiler on: save→DOM ack p95 1074.94 ms (max 4094.26 ms), save→manifest broadcast p95 577.88 ms, readAndCandidate max 3321.71 ms, and catalogDelta max 1478.81 ms. In the parser run with the profiler off and the same code, large save→DOM ack was p50 181.06 ms and p95 200.63 ms, readAndCandidate max 60.54 ms, and catalogDelta max 20.91 ms; small save→DOM ack was p50 62.63 ms and p95 69.82 ms, with readAndCandidate max 9.59 ms. How these large delays relate to profiler overhead and OS scheduling delay is not established.

Stage p95 and browser stages for the parser run with profiler off are below. Both scenarios received 50 patch responses and zero full responses; input-node identity and values and component state were retained, and the generated `.d.ts` was not rewritten.

| p95 (parser run) | small (1k×3) | large (10k×20) |
| --- | --- | --- |
| readAndCandidateMs | 6.95 ms | 56.77 ms |
| validationMs | 1.83 ms | 26.88 ms |
| registryReplaceMs | 0.57 ms | 8.08 ms |
| catalogDeltaMs | 1.51 ms | 19.46 ms |
| receive→commit (browser) | 5.50 ms | 47.90 ms |

`--cpu-profile` profiles only the edit loop within the measurement interval through the Node inspector. It excludes startup, calibration, and warmup but includes fixture preparation, HTTP, and waiting; it is not browser CPU. Profiler control overhead (`node:inspector:post`) and OS scheduling delay are mixed into summaries, so do not compare profiler figures directly across runs or add inclusive sample values to derive totals.

- Before: of 5802.10 ms busy time, `parseCatalog` self was 1242.92 ms (21.42%), `createCatalogPatch` self 609.05 ms, `validateTranslation` self 641.37 ms, `freeze` self 430.06 ms, and `readJson` self 323.14 ms.
- After: of 14654.57 ms busy time, `parseCatalog` self was 5557.23 ms (37.92%), `createCatalogPatch` self 2236.90 ms, `validateTranslation` self 2170.70 ms, `freeze` self 1141.69 ms, `isDeepFrozen` self 589.31 ms, and `readJson` self 469.60 ms.

In the current profile, `parseCatalog` self is the largest single CPU frame, followed by `createCatalogPatch` and `validateTranslation`. Absolute values vary by run, so use the ranking only.

Parser cost itself was compared in the same process by alternating calls between baseline `4d1f6fc` and the final parser. It edited one value of the same length and excluded `JSON.stringify`, equality checks, disk, watcher, validation, and browser; it used 50 warmups and 100 measured pairs. Results are in [parse-compare.json](../benchmarks/results/parse-compare.json).

| Item | baseline | final parser |
| --- | --- | --- |
| p50 | 29.34 ms | 25.45 ms |
| p95 | 55.43 ms | 55.42 ms |

The median per-pair difference was -3.92 ms, and 85 of 100 pairs improved. p50 fell about 13.3%, while p95 was nearly identical. This measurement covers the reduction in median parsing cost when editing one file with 10,000 messages; it does not extend to total end-to-end latency or p95 improvement.

Applied parser changes:

- `core/src/catalog.ts`: omit diagnostics context spread for reusable immutable messages and create it only for entries that need diagnostics. Invalid IDs emit a diagnostic and processing continues to the next entry.
- `core/src/json.ts`: reuse values already decoded by the initial strict `JSON.parse` in entries, match separators with a sticky regex to remove suffix slicing, and skip constructing a position locator when there is no diagnostic. Duplicate decoded keys, non-string values, and malformed strict checks remain unchanged.

`npm run check` exited 0. All 140 tests passed in one run (core 58, React 9, typegen 5, Vite 68), along with JS/TS consumer checks and React TS checks.

## Remaining bottlenecks and next work

- In the current profile, `parseCatalog` self has the largest CPU cost, and `readAndCandidateMs` (path validation, reading, parsing, candidate preparation, base stat, and drain waiting) is also large. No measurement separates read from parse, so their individual shares are not established, and strict JSON parsing alone is not established as the cause.
- Patch-response generation (`createCatalogPatch`) and `validateTranslation` also account for substantial CPU.
- Full responses still send the entire namespace AST and validate and freeze it in the browser.
- The 40 ms quiet window that groups file events remains a lower bound.

The same-process parser comparison confirmed roughly 13.3% lower median parsing cost for editing one file with 10,000 messages. However, the after run with profiling had an end-to-end p95 of 1074.94 ms, while small p95 69.82 ms and large p95 200.63 ms in the single profiler-off parser run do not establish stable achievement of the p95 ≤ 100 ms target. The cause of the large delay is not established. Production pack-consumption verification was completed with `npm run verify:pack`; first-release preparation remains separate.

In the recorded runs, the generated `.d.ts` mtime and size remained unchanged after 50 copy-only edits, and every ack retained input-node identity and values and component state. No temporary fixture directories or browser profiles remained after the runs, and no extra browser processes were left. Locale addition and deletion and paint had not been measured yet, and these live-update runs did not measure bundle size. The unminified JS chunk total for the parser-removal fixture (168,462→117,385 B) is in [06-validation-and-roadmap.md](06-validation-and-roadmap.md); minified and gzip measurements for actual demos are recorded in the next section.

## Production JS bundles for actual demos (2026-10-07 KST)

After `npm run build`, `node benchmarks/bundle-size/run.mjs` built the vanilla and React demos with `astRuntime:false` and `astRuntime:true`. Originals are in [demo-bundle-size.json](../benchmarks/results/demo-bundle-size.json); rerun and size definitions are in [benchmarks/bundle-size/README.md](../benchmarks/bundle-size/README.md). The environment was Windows x64, Node v24.18.0, Vite 8.3.2, and React 19.3.0. The reference revision is `46ee8d7`; config-factory and measurement-script changes on top are identified by `workingTreeStatus` and `codeHashes`.

The existing config was reused with default minification, and results were received in memory with `write:false`. Vanilla uses eager `virtual:saylo`; React uses `virtual:saylo/lazy` with `initialNamespaces:['demo']`. Both start in Korean (`ko`) and use the same Korean and English translation files (namespace demo). Initial JS is the sum of the HTML entry chunk and recursive static JS imports; lazy JS is the sum of other emitted JS chunks. Original size is UTF-8 bytes of minified JS; gzip is the sum of each chunk compressed at level 9. Units are B.

| App | astRuntime | Initial JS | Initial JS gzip | Lazy JS | Lazy JS gzip |
| --- | --- | --- | --- | --- | --- |
| vanilla eager | false | 63,263 | 19,656 | 0 | 0 |
| vanilla eager | true | 37,664 | 12,796 | 0 | 0 |
| React lazy | false | 298,571 | 92,241 | 3,774 | 958 |
| React lazy | true | 272,950 | 85,139 | 3,774 | 957 |

Comparing initial JS for the same app, vanilla fell by 25,599 B original and 6,860 B gzip (34.9%), and React by 25,621 B original and 7,102 B gzip (7.7%). React's en/demo dynamic-import chunk remained in both builds at the same 3,774 B original size. Initial JS was one chunk in every build; vanilla had zero lazy chunks and React had one. The parser error marker `EXPECT_ARGUMENT_CLOSING_BRACE` appeared in each app's false initial JS and disappeared from all JS with true. Measurement inputs and hashes of React generated types were unchanged across builds.

React figures include React, ReactDOM, and demo UI, so do not treat those totals as Saylo runtime size or compare them directly with vanilla totals. HTML, CSS, source maps, HTTP headers, Brotli, SSR, and load time are excluded. Random session UUIDs make gzip and output hashes vary slightly across reruns, and a 1 B difference in a lazy chunk is not treated as an optimization effect. This is one measurement of the actual repository demos and does not extend to general apps, other data scales, or other bundlers. Parser removal was a local implementation and absent from published `0.1.0-alpha.1`. Live-update latency targets and the Paraglide comparison remain separate measurements.

## Live-update remeasurement after quarantine (2026-10-07 KST)

The current runtime was built, then measured with `npm run bench:live -- --out benchmarks/results/live-update-quarantine.json`. The reference revision is `58999f2`; benchmark `profile.mjs` and `run.mjs` changes on top are identified by `workingTreeStatus` and `codeHashes`. Library code was not changed for this measurement. Originals are in [live-update-quarantine.json](../benchmarks/results/live-update-quarantine.json), and raw samples are in the per-scenario `.samples.json` files referenced there.

Conditions matched the previous parser run: warmup 5, 50 measurements, 25 controls, CPU profiler off. One namespace, loaded ko+en, one changed message and one unchanged message rendered, and only one en probe key edited. The environment was Windows x64, Node v24.18.0, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, AMD Ryzen 5 7430U, 12 logical CPUs, and 31.3 GiB memory. This was a normal copy edit, so quarantine/recovery error paths, locale addition and deletion, and paint were not measured.

| Scenario | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | fileWrite p95 | control round-trip p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1k×3 locales | 63.02 ms | 72.26 ms | 60.57 ms | 5.60 ms | 8.96 ms | 5.09 ms |
| 10k×20 locales | 176.48 ms | 209.23 ms | 142.61 ms | 47.20 ms | 10.44 ms | 6.68 ms |

The preceding parser run without the profiler had p95 69.82 ms for small and 200.63 ms for large; this run was 2.45 and 8.60 ms higher. p50 changed from 62.63 to 63.02 ms for small and from 181.06 to 176.48 ms for large. Control round-trip p95 changed from 5.23 to 5.09 ms for small and 5.34 to 6.68 ms for large; both are single runs at different times. These differences are not established as regressions or improvements from quarantine. Small met the 100 ms target in this run; large still exceeded it.

This instrumentation ends the read and candidate stages at entry to `prepareTranslations` and measures translation preparation separately. Previously it ended at entry to `validate`. Because most translation validation moved into preparation after quarantine, do not compare past `validationMs` directly with this final-validation time. The save→DOM ack clock and stage definitions are unchanged.

| Server stage p95 | small (1k×3) | large (10k×20) |
| --- | --- | --- |
| queueToDrainMs (including quiet window) | 53.37 ms | 54.12 ms |
| readAndCandidateMs (through prepareTranslations entry) | 9.29 ms | 64.39 ms |
| translationPreparationMs (schema lookup, translation validation, quarantine preparation) | 2.29 ms | 25.75 ms |
| validationMs (final active catalog validation) | 0.01 ms | 0.03 ms |
| registryReplaceMs | 0.64 ms | 8.11 ms |
| catalogDeltaMs | 1.88 ms | 20.35 ms |

There was one file event and drain per sample. Both scenarios received 50 patches and zero full responses, with at most one changed message and zero position updates; catalog response JSON p95 was 930 B for small and 936 B for large. Warmups were excluded. These byte counts cover the catalog response object passed to `client.send` and exclude manifest packets, WS headers, and compression. Every ack retained input-node identity and values and component state, and `.d.ts` mtime and size did not change. Each raw file had 55 samples (50 measured), and five timing metrics, six server stages, the control summary, and recorded code hashes were checked. Temporary fixture and browser profile directories and corresponding browser processes were gone after shutdown.

The next optimization candidate is repeated processing of all messages when applying patches and creating snapshots in the browser. `catalog-patch.ts` copies the full message map and counts entries even when one message changes. `createLoadedSnapshot` in `loading-registry.ts` sorts every key in the loaded catalog and serializes sources to create a signature. Actual large receive→commit p95 was 47.20 ms, but this run did not split patch application, freezing, validation, signature creation, and React commit, so the share of each is not established. The next small task is to separate those costs and consider reusing sorting and serialization for unchanged immutable catalogs. Preserve snapshot identity for no-op updates and behavior for schema changes and full resync.

Server readAndCandidate p95 of 64.39 ms remains, but read and parse are still combined. The server quiet window is configured to 40 ms, and this run's queue p95 was about 54 ms. Do not add these stages into an end-to-end p95 or subtract control round trips. Locale-addition latency and identical-condition Paraglide comparison are follow-ups; these figures do not claim the large target or superiority over other libraries.

## Browser-stage baseline (2026-10-07 KST)

Ran `node benchmarks/live-update/run.mjs --browser-stages --out benchmarks/results/live-update-browser-before.json` with warmup 5, 50 measurements, 25 controls, and CPU profiler off. Results are in [live-update-browser-before.json](../benchmarks/results/live-update-browser-before.json) and per-scenario raw samples. The reference revision is `3d4fa5b`; instrumentation changes on top are identified by `workingTreeStatus` and `codeHashes`. Runtime matched the post-quarantine remeasurement, and the environment and fixture were identical.

A benchmark-only Vite transform wraps synchronous time in browser functions. Library source and `dist` were unchanged. To apply the transform, Saylo package dependency prebundle was disabled while React and ReactDOM remained. Therefore, do not compare directly with runs that used prebundle. Clock-call overhead is included; this is not a CPU profile. Follow [benchmarks/live-update/README.md](../benchmarks/live-update/README.md) for the method.

| Browser stage p95 | small (1k×3) | large (10k×20) |
| --- | --- | --- |
| patch application | 1.40 ms | 11.60 ms |
| Vite catalog freeze | 0.60 ms | 7.70 ms |
| snapshot creation | 3.10 ms | 28.60 ms |
| translator creation (inside snapshot) | 1.80 ms | 13.90 ms |
| signature creation (inside snapshot) | 1.30 ms | 16.90 ms |
| receive→commit | 6.70 ms | 56.00 ms |
| save→DOM ack | 78.89 ms | 257.51 ms |

Signature and translator time are included in snapshot time. Do not add stage p95 values. Every stage ran once per edit in both scenarios; all 50 measurements had one patch message and zero position updates. Input nodes and values and component state remained, and type files were not rewritten. Signature creation is the first optimization target. Proceed with a small change that reuses sorting and serialization for unchanged deeply frozen catalogs while preserving signature string meaning and no-op snapshot identity.

## After immutable catalog signature reuse (2026-10-07 KST)

Signature generation was moved to `core/src/snapshot-signature.ts`. Only catalogs confirmed by core's deep-freeze check keep a canonical JSON fragment in a WeakMap, so unchanged catalogs avoid repeated key sorting, source-array creation, and serialization. Combining scope metadata and fragments produces the same string as the previous full `JSON.stringify`. New translation catalogs are recomputed; mutable and shallow-frozen inputs are not cached. The cache retains serialization strings for the lifetime of catalog objects, so it has a memory cost. Public APIs, pair versions, and content-based no-op snapshot decisions were unchanged.

After optimization, another run retained `--browser-stages` and recorded [live-update-browser-after.json](../benchmarks/results/live-update-browser-after.json). A normal-settings run with instrumentation off and Saylo prebundle was recorded separately in [live-update-signature.json](../benchmarks/results/live-update-signature.json). Both runs used reference revision `9d2ac96`; changes on top are identified by `workingTreeStatus` and `codeHashes`, and `snapshot-signature.js` was added to the hash. Environment, fixture, warmup 5, 50 measurements, 25 controls, and CPU profiler off were identical.

| Browser stage p95 | small before | small after | large before | large after |
| --- | --- | --- | --- | --- |
| patch application | 1.40 ms | 0.80 ms | 11.60 ms | 8.10 ms |
| Vite catalog freeze | 0.60 ms | 0.50 ms | 7.70 ms | 5.40 ms |
| snapshot creation | 3.10 ms | 2.00 ms | 28.60 ms | 16.00 ms |
| translator creation (inside snapshot) | 1.80 ms | 1.40 ms | 13.90 ms | 11.10 ms |
| signature creation (inside snapshot) | 1.30 ms | 0.60 ms | 16.90 ms | 6.20 ms |
| receive→commit | 6.70 ms | 5.00 ms | 56.00 ms | 36.70 ms |
| save→DOM ack | 78.89 ms | 73.51 ms | 257.51 ms | 186.03 ms |

Signature-creation p95 was observed about 63.3% lower for large. However, unchanged patch, freeze, and translator stages also fell, and control round-trip p95 fell from 7.61 to 4.23 ms for small and from 11.48 to 4.52 ms for large. These are single runs at separate times, so neither the full end-to-end reduction nor every stage change is attributed to the signature change. Signature reuse itself was separately verified with a test showing that key enumeration for an unchanged trusted catalog does not occur on the second call. Do not add nested snapshot stages and p95 values.

Normal development-settings results follow. They are comparable to the preceding post-quarantine normal-settings run (small p95 72.26 ms, large p95 209.23 ms) but are again single runs at separate times.

| Scenario | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | control round-trip p95 |
| --- | --- | --- | --- | --- | --- |
| 1k×3 locales | 61.50 ms | 68.00 ms | 60.55 ms | 4.80 ms | 4.27 ms |
| 10k×20 locales | 145.40 ms | 185.87 ms | 124.49 ms | 37.90 ms | 5.48 ms |

Across all four cases in both post-optimization runs, all 50 measurements were patch responses and none were full responses, with at most one changed message and zero position updates. Input nodes and values and component state remained, and `.d.ts` was not rewritten. Raw samples (55 each), timing, server, browser, and control summaries, and recorded code hashes were checked. Temporary fixtures and browser profiles and their browser processes were all cleaned up.

The core build and 44 related tests passed (24 for core snapshot signatures, lazy loading, and SSR boot; 20 for Vite lazy and patch). They verified canonical-string compatibility, empty scopes and literal IDs such as escape and prototype, immutable-cache reuse and non-caching of mutable input, snapshot identity for a new pair version with identical copy, correct publication and retention of the previous translator for schema and copy changes, and full refetch and resync for malformed patches. Full release check, pack, republish, and push were not run in this scope.

The large p95 ≤ 100 ms target is still not met. In the normal run, server readAndCandidate p95 was 55.92 ms and includes reading and parsing; it is the next target for split instrumentation. It also includes async read and drain waiting, so do not convert it to CPU cost. In the browser, full map copying for patches, translator validation traversal, and signature calculation for changed catalogs remain. Locale-addition latency, paint, and Paraglide comparison have not been measured yet.

## Split server file read and parse instrumentation (2026-10-07 KST)

Both scenarios were measured with `node benchmarks/live-update/run.mjs --server-file-stages --out benchmarks/results/live-update-server-files.json`. Results are in [live-update-server-files.json](../benchmarks/results/live-update-server-files.json) and per-scenario raw samples. The reference revision is `f863e58`; benchmark-only instrumentation changes on top were recorded in `workingTreeStatus` and `codeHashes`. Product runtime hashes matched the preceding signature run, and library source and `dist` were not modified.

The setup was the same warmup 5, 50 measurements, 25 controls, one normal en copy edit, loaded ko+en, and one namespace. CPU profiling and detailed browser instrumentation were off, and existing Saylo dependency prebundle was retained. The environment was Windows x64, Node v24.18.0, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, Ryzen 5 7430U, and 31.3 GiB memory. A Node module hook registered at start transformed only `readCatalogFile` from the actual `typegen/dist/catalog-files.js` in memory, then removed the hook at completion. No instrumentation was added to source or `dist` files or public product APIs.

| Candidate internal stage p95 | small (1k×3) | large (10k×20) |
| --- | --- | --- |
| path check (assertInside) | 1.17 ms | 0.84 ms |
| UTF-8 file read | 0.90 ms | 1.43 ms |
| catalog parsing (parseCatalog call and argument construction) | 4.60 ms | 46.82 ms |
| remaining candidate processing (per-sample residual) | 0.87 ms | 3.32 ms |
| readAndCandidate total | 6.65 ms | 49.40 ms |

Path check and read are async wall time. Parsing is synchronous elapsed call time including JSON processing, ICU, previous-message reuse, position calculation, and freezing; it is not a CPU-profile value. Residual subtracts the three stages from total candidate time in each raw sample, then aggregates. Do not add or subtract p95 values from this table to derive stage or total time. Clock and Promise-wrapper overhead and OS scheduling effects are included.

In this warm normal edit, large read p95 was 1.43 ms and parse p95 was 46.82 ms. Therefore the next optimization target is JSON processing, position calculation, and message traversal inside the parser, rather than replacing file reads. `catalog.ts` already reuses ICU ASTs for messages with unchanged copy, but `readJson` still scans all tokens and handles decoded keys, calculates positions, and builds the messages map on every save. This run did not split parser-internal stages, so JSON scanning alone is not established as the sole cause. The next small task is to split those internal costs and reduce reusable portions. Preserve strict JSON, decoded duplicate IDs, error positions, and contracts for copy whose length changes and for added or deleted keys.

| Scenario | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | control round-trip p95 |
| --- | --- | --- | --- | --- | --- |
| 1k×3 locales | 62.95 ms | 71.85 ms | 62.32 ms | 4.80 ms | 10.26 ms |
| 10k×20 locales | 151.45 ms | 180.93 ms | 125.13 ms | 40.10 ms | 7.18 ms |

The preceding normal run without instrumentation had p95 68.00 and 185.87 ms. Runtime was identical here and only instrumentation and execution time differed, so this difference is not treated as an improvement or regression. The large 100 ms target is still not met. Cold disk, locale addition and deletion, quarantine and recovery of incompatible translations, and simultaneous multi-file saves were outside this measurement.

Each scenario had 55 raw samples (50 measured), and every sample had one path check, read, and parse. The raw residual sum and total candidate time, five end-to-end timings, six server stages, four file stages, control nearest-rank summary, and recorded code hashes were checked. All 50 measurements had one patch message and zero position updates, with zero full responses. Every ack retained input nodes and values and component state, and type files were not rewritten. No temporary fixture or browser profile directories and no corresponding browser processes remained. Existing product tests were not rerun because library implementation was unchanged.

Parser-internal stages and follow-up optimizations were split into [11-parser-measurements.md](11-parser-measurements.md). The key-decoding trial was reverted because it lacked evidence of tail-latency improvement; the final change builds an LF position index with `indexOf`. Final p95 under the same server-file instrumentation was 72.66 ms for small and 165.94 ms for large, still failing the large target. Interpret single-run load differences and parser-only figures separately.
