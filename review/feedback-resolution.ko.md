# Saylo design review resolution record

This document records how the findings from the first design review were addressed or deferred. Because there is no executable code or benchmark, whether they were addressed is a judgment at the document contract level.

## Addressed

| Review item | Addressed in | Details |
| --- | --- | --- |
| New namespace path | 03, 05 | Development handles it with a general `loadCatalog(locale, namespace)` and a mutable manifest handle. The static loader map is production-only |
| `t` union keys | 03 | Keeps key and argument correlation with a `TypedCall` tuple. There is no broad `string` overload on the typed path |
| Incomplete snapshot metadata | 02, 03, 08 | Split into 4 kinds: transport state (internal), catalog record (immutable), UiSnapshot (public), and BootSnapshot (wire). `UiSnapshot.catalogs` is a CatalogRecord map |
| resync scope | 08 | The snapshot request includes the current desired locale, namespace, requestId, and generation. The response returns outcome, schema, and tombstone |
| conflicting meaning of locales | 08 | `availableLocales` and `availableNamespaces` are the full list every time (replacement) |
| base changes and existing call sites | 04, 05 | schema-compatible guarantees DOM preservation; schema-breaking applies immediately with a diagnostic; server restart reload is excluded |
| React types and read snapshot | 02, 03 | `createSayloReact<AppSchema>()` factory; the hook t is bound to the selected immutable UI snapshot |
| JS argument validation and adding translation arguments | 03, 04 | Argument names are a subset of base; translations that omit an argument also validate the base required arguments on call (including JS); `InvalidArgumentError` |
| locale switch and namespace race | 04, 08 | Coordinated by desired-state generation. Normal concurrent calls do not reject each other |
| transport state forcing UI identity | 02 | Moves registryRevision, session, and dirty into internal transport |
| full base deletion and per-file commits | 02 | Decides the candidate registry from a stabilized file set and publishes or rejects in batches |
| `[]` and the scope of `.d.ts` guarantees | 02, 05 | `[]` is only a way to limit hook processing, not a guarantee over the whole graph. Generated and temporary files are excluded from the watch scope |
| Vite reconnect reload | 05 | Separates bulk loading for normal translation changes from recovery after a server restart. Server restart reload is outside the DOM preservation scope |
| connection and cleanup ownership | 02, 03, 05 | Vite owns the watcher and socket. Saylo owns only its listener, route, and channel binding. `connectDev` is a single binding with an idempotent disposer |
| undefined `fallbackLocale` | 03, 04 | Option removed. The only fallback target is baseLocale |
| warm latency scope | 03, 04, 06 | Separates the message formatter cache from the `Intl` cache, reuses unchanged messages, and states the definition of warm |

## Deferred

| Item | Basis |
| --- | --- |
| message delta transfer | Decide after the large fixture benchmark. MVP uses full replacement |
| selector fine-grained subscription | Follow-up optimization. MVP subscribes at instance level |
| removing unused messages | Conflicts with dynamic t keys. A static-usage proof path is needed |
| rich text | Expands value grammar and type contracts. Support plain text first |
| multi-level fallback | Loading, schema, and format sources must be designed together |
| additional framework adapters | The core is neutral, so add them as follow-ups |

## Type contract check

- In-memory strict checks with TS 6.0.3 reproduced the union key error in the original `t` declaration. A union-key call passed while dropping arguments.
- Extracted the revised public declarations from the documents and ran the final in-memory strict check. On TypeScript 6.0.3, 10 TS and 6 typed JS consumption cases passed with 0 diagnostics and 0 filesWritten. It allowed valid calls and union narrowing, and rejected missing required arguments, wrong types, and uncorrelated union calls.
- This result is a type check of the declarations. Actual library runtime, React hydration, update event races, and performance benchmarks will be verified after implementation.

## Document checks

- Checked 12 Markdown files, 45 local links, and 5 JSON examples. UTF-8, code block closure, and end-of-file newline checks also passed.
- All documents are 40 KiB or smaller and passed `git diff --check`.
