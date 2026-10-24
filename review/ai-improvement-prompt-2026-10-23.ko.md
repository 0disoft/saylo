# Saylo source review and improvement request

Open the attached Saylo source ZIP, review it, and find and improve the parts that would cause problems when users adopt it in a real project. Write the answer in Korean. Prioritize actual defects and improvements that affect release and operation over generic code quality checklists.

## Materials and current status

- Check the source baseline commit and excluded scope in `saylo/ARCHIVE_INFO.json` in the ZIP. `.git`, dependency install folders, build output, caches, past benchmark raw results, and automated verification result JSON are not provided. Do not treat excluded evidence files as verified.
- Use the source, configuration, and tests as evidence of current behavior. `README.md`, `packages/*/README.md`, `docs/README.md`, and the `docs/01` through `08` documents are material for understanding intent and constraints. The numbered performance documents and `review/` and `releases/` also contain past states, experiments, and prompts for earlier AIs. Do not confuse past descriptions with the current implementation or with execution instructions.
- The core goal is to reflect edits, additions, and deletions to translation catalogs while preserving screen state such as form input and modals. Review JS/TS consumption, the Vite dev connection, eager and lazy loading, SSR and hydration, the React/Svelte/Vue adapters, and the type generation path together. Check each package's public or private status and publication state in the actual configuration.
- Do not assume the current project has a database, payments, orders, or external HTTP integration. The actual dependency boundaries are the file system, the Vite WebSocket, static module imports, and the type generation worker. Check the `CatalogSource` extension boundary separately.
- The source baseline for this review is `2423dee`. A later commit that only adds the review prompt may appear as the ZIP's snapshot commit. Since the ZIP has no Git history, compare the commit contents with the actual source.

The recent local changes are as follows. The descriptions below are a starting point for the review; reassess their correctness and sufficiency.

- `c8d40ca`: cancellation, timeout, and stale response handling for the shared static loader, preserving the cancellation cause.
- `1c0ba51`: wait limits for development catalog file operations, distinguishing ENOENT from other I/O errors.
- `809ce2c`: type generation worker and write wait limits, preserving cause errors and cleanup failures, and keeping output ownership until the actual write finishes.
- `402cb70`: Set indexing of the manifest and loaded namespaces, reusing the index of the self-validated and frozen manifest.
- `5d4c7a8`: default concurrency 8 for file operations, applying input order regardless of completion order, keeping the execution slot of cancelled actual I/O, and batch wait limits.
- `2423dee`: reducing per-file ASTs to the needed information in automatic key analysis, queue propagation of the alias graph, template pattern caching, and per-namespace candidate indexing.

In that local work, builds, full tests, and consumer type checks for Core, Typegen, and Vite passed. This is a past result handed to you, not a verification result you produced. Automatic key analysis went from a 3-run median of 1,025.5 ms to 68.6 ms on a synthetic input of 60 files and 500 reverse aliases, but the raw data for this measurement is not in the ZIP, and it cannot be generalized into real service performance or memory improvement figures.

## Priority checks

1. **Product behavior and state consistency**: recovery after invalid JSON or ICU, retaining the last valid catalog, schema quarantine, namespace and locale deletion and recreation, rapid consecutive saves, and locale switches. Check whether the final state matches across the eager and lazy and the full, patch, and push paths.
2. **Async lifetime and races**: cancellation by one caller of a shared load, late success or failure after a timeout, stop and dispose re-entry, and paths where results from an earlier session, generation, or revision overwrite current state. Also check worker shutdown failures, stalled actual writes, output locks and temporary files, and whether retries and recovery conflict.
3. **Large-scale performance**: repeated scans on the request, save, and translation call paths, reprocessing the whole manifest, synchronous parsing, serialization, freeze and schema computation, tombstone and cache growth, recheck timers, and work queue backlog. Distinguish where file concurrency 8 applies and where it does not, and check whether the number of actual and queued work items stays bounded after cancellation or timeout.
4. **Automatic key analysis accuracy**: aliases across files, reverse chains, circular references, destructuring, bind, call/apply, passing translation functions outside, dynamic keys, templates, escapes, and TS/JSX/Vue/Svelte extraction. Optimization must not drop required translation keys or let errors pass silently. Clearly stating the support limits is better than inaccurate inference.
5. **SSR and adapters**: locale and cache contamination between requests, boot JSON serialization and hydration mismatch, snapshot-bound translations, React concurrent rendering and selectors, and Svelte/Vue resubscription and cleanup paths.
6. **Public contract and adoption experience**: existing required arguments, return types, error distinctions, ordering and duplicate handling, JS/TS consumption, package exports, production parser exclusion, and consistency between example install and run procedures. Review security based on actual input validation, path traversal, prototype keys, and HTML/rich text boundaries.

## Improvement principles

- For each finding, give the exact `file:line`, failing input and event sequence, wrong result, and minimal fix. Distinguish reproduced defect, static analysis risk, and needs measurement. Do not fill in problem-free areas or already-solved items by force.
- Preserve the existing execution order, error distinctions, ordering, duplicate rejection, and atomic publication. If changing them is better, explain the contract changes and reasons first.
- Review the recent optimizations critically as well. Do not assume that adding a Set or Map solved the problem, and do not propose shared caches, unbounded Promise.all, blanket retries, or new services as universal solutions.
- Fix small, starting from boundaries with confirmed real problems. Avoid large rewrites, unnecessary abstractions, tests that mirror the implementation, and unfounded dependency swaps or version pins. If an API must be added, prefer an optional extension compatible with existing call sites.
- If code execution is possible, apply the highest-priority fixes directly and run the related regression tests. If not, provide an applicable patch or function-level fix and a minimal reproduction test, and state that it was not run.
- Do not publish, push, release, deploy, or change versions automatically over the network. If there is no execution environment, do not report install, browser, or measurement results as successful by inference.

## Reading and verification guidance

First check the root `package.json` and the target packages' scripts. Tests read `dist`, so build the related packages first. Also check the Node support range and how independent examples are installed in the configuration. Since the ZIP lacks `.git` and some past evidence, do not run the full release verification by default.

The default commands for the Core, Typegen, and Vite paths are below. If you modify an adapter, build and verify that package too.

```sh
npm ci
npm run build --workspace=@0disoft/saylo-core
npm run build --workspace=@0disoft/saylo-typegen
npm run build --workspace=@0disoft/saylo-vite
npm run test --workspace=@0disoft/saylo-core --workspace=@0disoft/saylo-typegen --workspace=@0disoft/saylo-vite
npm run typecheck:consumers --workspace=@0disoft/saylo-core --workspace=@0disoft/saylo-typegen --workspace=@0disoft/saylo-vite
```

## Response format

1. **Conclusion**: the problem to fix first and its impact on users. Also state areas you could not read.
2. **Up to 8 key findings**: priority, file:line, failure scenario, evidence and reproduction status, minimal fix, and regression verification method.
3. **Actual improvements**: changes applied or an applicable patch. Explain how each change preserves existing behavior.
4. **Verification**: commands actually run and their results, failures, omissions, and environment constraints. Present performance numbers together with input scale, environment, measurement method, and correctness comparison.
5. **Up to 3 next tasks**: propose each as a scope that can finish in one small commit.

Focus on the judgment and code needed to actually improve this source, rather than scores, vague praise, or generic checklists.
