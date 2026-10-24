# 26. Sharing the deep-freeze path for transport catalogs

[25](25-core-outcome-acceptance-stages.md) established that freezing cost was duplicated in Vite and core. This record consolidates catalog freezing into core and measures the effect.

## Implementation

I added `freezeCatalogs(catalogs: readonly ParsedCatalog[]): readonly ParsedCatalog[]` to core `src/catalog-freeze.ts`. The function delegates to the existing `diagnostics.freeze` and shares fully traversed and frozen objects through a module-local WeakSet. It is exported from `core/runtime` and exposed through the core root barrel.

Vite `src/freeze.ts` retains its existing `freezeCatalogs` wrapper and public API but delegates to `freezeCatalogs` from core `runtime`. Core traversal replaces Vite's direct `Object.isFrozen` traversal. A shared catalog is traversed and frozen only once and core marks it, so subsequent core `acceptOutcome` calls copy and freeze only the outcome and key without revisiting the catalog tree.

Freezing returns the input array unchanged and preserves AST, message, schema, and position references. Externally shallow-frozen objects are traversed and their children are frozen; `Object.isFrozen` alone is not treated as trust. Freezing does not validate catalog shape or schemas, and existing decoding, acceptance, and translator validation are unchanged. No versions, dependencies, push, or deployment changed. The new runtime helper exists only locally and is not in published 0.1.0-alpha.1. A separate copy of the core module safely traverses again, so the optimization shares trust only within a single core module load.

## Validation

I added two Vite regression tests. One counts reads from nested literal getters through Vite → core freeze → `acceptOutcome` and verifies that each occurs exactly once and that the result is the same reference as the core trusted node. The other uses a shallow-frozen catalog and array with a nested ICU plural, date skeleton, and tags to verify recursive `Object.isFrozen`, core trust, exact JSON values and positions, and rejection of mutation. TypeScript and checkJs consumer cases verify helper availability and readonly lists, and TypeScript rejects passing a schema as a catalog.

The core, react, and typegen workspace tests and all 79 Vite tests passed. After fixing the new test that compared a parser's null-prototype map with an ordinary map after JSON transport, I reran `npm run test --workspace=@0disoft/saylo-vite`. `npm run build`, `npm run typecheck:consumers --workspaces`, and the five instrumentation tests also passed.

I also verified deployment metadata, dependency versions, and licenses for the four packages with `npm run release:check -- --version 0.1.0-alpha.1 --tag alpha`. I did not bump or publish a version.

`npm run verify:pack` consumed the four tarballs in separate JS/TS installations and passed checks for root/runtime identity of the function, shallow freezing, translation and argument errors, React SSR, typegen, and the Vite lazy build. The separate consumer installation used Vite 8.3.3 within the same major range, while the benchmark used Vite 8.3.2. The production AST runtime build did not include an ICU string parser.

## Measurement and interpretation

I measured on the same machine (Windows, Node 24.18.0, Ryzen 5 7430U, Vite 8.3.2, React 19.3.0, HeadlessChrome 154) on 2026-10-07 KST. The revision was a52631a; worktree changes were identified through `workingTreeStatus` and codeHashes. I ran before first and after second. Although the before worktree showed uncommitted source edits in `workingTreeStatus`, the before measurement used the older product dist. Both used `locale-add --browser-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10` with typegen on, Saylo prebundling off, React prebundling on, and CPU/server profiling off. Instrumentation function boundaries were the same; after's run.mjs additionally hashed the new catalog-freeze.js and runtime.js, without changing timing boundaries.

All times are in ms.

| Stage | before p50 | before p95 | after p50 | after p95 |
| --- | ---: | ---: | ---: | ---: |
| Vite freeze | 46.40 | 51.80 | 84.80 | 308.60 |
| Core acceptFreeze | 73.10 | 320.20 | 0.00 | 0.00 |
| Combined freeze | 119.60 | 368.10 | 84.80 | 308.60 |
| Selection commit | 247.80 | 491.70 | 237.90 | 486.70 |
| List ack | 258.39 | 462.08 | 364.71 | 556.27 |
| Selection other (reference) | 92.40 | 135.70 | 112.70 | 138.20 |

Before used the product dist from before the change, and after used the newly built dist.

```sh
node benchmarks/live-update/run.mjs --mode locale-add --browser-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-shared-freeze-before.json
node benchmarks/live-update/run.mjs --mode locale-add --browser-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-shared-freeze-after.json
```

Each run had 12 raw iterations with 10 measured, unique tokens, one call to each of the eight stages per sample, zero target responses before selection, one `saylo-catalog-v1` full response after selection with p95 1,241,401 B, and an added JSON file of 387,783 B. The fixture had 10,000 messages across 20 initial locales in one namespace. Input node, value, and React state were preserved; generated declarations retained mtime and size; and reset/removal completed without reload. Small edit runs (2 measured plus 1 warmup) and locale-add with instrumentation disabled (1 plus 0) verified the features. I do not use timing from the smoke run during external pack installation as representative performance. I reconciled raw counts, summaries, remainders, calls, wire data, and hashes, and confirmed that no temporary fixture or browser remained.

The after p50 and p95 of 0.00 ms for core acceptFreeze are below clock resolution. Some cost moved into the initial Vite freeze (median 46.40 → 84.80 ms). After calculating per-sample `freezeMs + acceptFreezeMs` and applying nearest rank, the combined p50 went from 119.60 to 84.80 ms (29.10% reduction) and p95 from 368.10 to 308.60 ms (16.16% reduction). I do not add p95 values.

Selection → DOM commit was observed lower, with p50 247.80 → 237.90 ms and p95 491.70 → 486.70 ms. List ack was observed higher, with p50 258.39 → 364.71 ms and p95 462.08 → 556.27 ms, and missed the 250 ms list target. I did not change the server or parser and could not separate the cause of the list difference. Because this was not a repeated comparison in randomized order, I do not attribute the entire timing difference to the code change.

The 10-run nearest-rank p95 is the maximum. Function elapsed time includes runtime pauses, GC, and instrumentation overhead without deducting them. Process clocks are not subtracted from each other. I do not add p95 values from nested intervals or directly compare instrumented and regular runs with different prebundle settings.

The measurements confirm elimination of duplicate traversal, but broader remeasurement is needed for end-to-end performance. Limitations include one machine, one namespace, development mode, headless execution, and one DOM probe, with paint and cold start excluded.

Raw data is in [before summary](../benchmarks/results/locale-add-shared-freeze-before.json), [before samples](../benchmarks/results/locale-add-shared-freeze-before.10k-20-locales.samples.json), [after summary](../benchmarks/results/locale-add-shared-freeze-after.json), [after samples](../benchmarks/results/locale-add-shared-freeze-after.10k-20-locales.samples.json), and [per-sample combined freezing](../benchmarks/results/locale-add-shared-freeze-comparison.json). I also preserved the [edit smoke](../benchmarks/results/shared-freeze-edit-smoke.json) and [disabled-instrumentation smoke](../benchmarks/results/shared-freeze-disabled-smoke.json). I verified local document links, code blocks, the under-40 KB size limit, and `git diff --check`.

## Next work

Next, remeasure small and large end-to-end times under the normal prebundle configuration with detailed instrumentation disabled. This will establish current list-render and first-translation rendering times without further optimization. Selection remainder includes transport, server work, WS parsing, other client work, and React; divide those stages later if needed.
