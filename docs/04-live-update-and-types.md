# 04. Live Updates and Types

This document defines the policy for accepting updates during development, state reconciliation, failure recovery, deletion and batching, and type generation. [08-update-protocol.md](08-update-protocol.md) is the single source for wire types and application rules.

## Revisions and patches

Follow [08-update-protocol.md](08-update-protocol.md) for wire types (sessionId, baseRevision, revision, envelope) and receive order. This document defines the decision to accept those updates.

- Revisions increase monotonically within a server session (sessionId). When the server restarts, sessionId changes.
- Apply the envelope (sessionId, revision, list, schema) atomically first. Apply the payload only to pairs already in the cache. For uncached pairs, retain only the manifest version update, track the inconsistency as a cache mismatch, and discard the AST payload.
- Discard patches from the same session whose revision is less than or equal to one already applied.
- When baseRevision equals the currently applied revision and revision is greater, apply the patch as one transaction.
- Treat a future baseRevision or an overlap that cannot be applied as a gap and resync. Do not discard a patch solely because revisions are out of order.
- Reconnection does not trust previous session state. Invalidate every in-progress load and request generation, then realign with a full snapshot.
- Apply metadata and payload in the same commit, and notify once when that commit finishes.

Follow the startup handshake in [02-architecture.md](02-architecture.md) for the order of listener registration followed by snapshot request. `EagerSync` does not accumulate an array of patches; it keeps only one latest session/revision hint and requests a new snapshot when it sees a gap.

## Desired-state reconciliation

The current core implementation is in `packages/core/src/i18n.ts` and `catalog-loader.ts`. It combines preparation of the desired locale and namespaces and shares requests by pair and version. It loads unloaded namespaces explicitly and publishes once after all present/missing results are ready. It looks up stale responses up to three times and retains the previous UI if they fail. Vite sends the complete manifest separately from the bodies of requested parsed pairs, and re-queries only changes in the loaded scope. A pair response matching the immediately preceding baseline becomes a request-scoped delta containing only changed messages; otherwise, it falls back to a full present/missing response (step 13, locally implemented). The lazy development source registers a scope with `{ push: true }`, and the server pushes only changed pairs among its cached pairs. The client validates the payload and revision, applies the manifest and cache together, then publishes once to core. Gap and malformed payloads recover through the existing snapshot and lookup path. Secondary-schema quarantine is implemented in the Vite plugin (see below).

Locale changes and namespace loads are reconciled into one desired state (locale plus the desired namespace set). Generation is a value used to block stale completions in transport; it does not mean every caller gets canceled whenever generation changes.

- Publish once when every base+target pair is resolved as present or missing. Retain the previous UI while any pair is incomplete.
- When a namespace addition finishes in an interleaved order, reconcile again against the fixed set from the new generation.
- Keep an in-progress intent in a pending waiter. While that intent remains in the latest desired state, its waiter resolves when preparation completes.
- Example: If `loadNamespace("cart")` is added while `setLocale("en")` is in progress, the desired locale becomes en and desiredNamespaces grows to include cart. Both calls remain part of the latest desired state, so both resolve when the new locale and base load are ready.
- Reject an earlier `setLocale` call with `SupersededRequestError` only when its earlier locale intent is actually replaced (for example, switching from `en` back to `ko`). `dispose` rejects with a separate reason.
- `loadNamespace` expresses an intent to keep using that namespace after a locale change, so it resolves when the new locale and base load are ready.
- On timeout or network failure, reject the current intent and retain the previous UI.
- Compare stale load results with that key's known catalogVersion, sessionId, and namespaceSchemaFingerprint. Do not make a simple comparison against the global registry counter. An unchanged namespace's schema hash is independent of changes in another namespace.
- If a result is valid, the cache may be reused. An obsolete network response from an earlier generation must not be published directly to the UI.
- Preserve tombstone versions for deletions so loads started before the deletion cannot revive them.
- Two concurrent API calls with normal purposes do not reject each other. Rejection due to intent replacement is limited to cases where the earlier intent was actually replaced. Dispose and lookup failures are separate failure reasons.

## Commit transactions

- The commit unit is one locale+namespace catalog.
- The server validates a candidate, then atomically swaps the map and metadata. If validation fails, it retains the valid revision unchanged.
- When a burst of edits builds up a dirty queue, commit serially. Run schema and catalog dependency validation, with the latest generation as the final target state.
- Publish the UI from one atomic candidate computation. Do not expose an intermediate state to subscribers in which the schema is new but the catalog is old.

## Failure and recovery

- A file with broken JSON or ICU retains the last-known-good value for that catalog. Developer diagnostics (`LiveDiagnostic`) contain the file name, key, and when possible a line number. Support reports do not expose these values directly; they project them through an allowlist ([support-report.md](support-report.md)).
- Distinguish a server-determined missing result (file absent) from a failed lookup. On failure, retain the previous UI and reject that call's Promise with `CatalogLoadError`.
- Show the first error encountered through an explicit diagnostic. Do not create a fake catalog that exposes values as valid.
- If a base-locale catalog becomes invalid, reject the change in development and retain the base's last-known-good value and its schema at that time. If the base catalog is invalid from the start, stop with an explicit fatal error.
- If a new secondary file has syntax or schema errors, retain that file's last-known-good value, using only entries compatible with the base schema.
- If a secondary catalog lookup result is missing, fall back to the baseline catalog. A normal present result uses the translation. If the baseline namespace itself is not loaded, throw `NamespaceNotLoadedError`.
- If the queue floods, clear it with a bounded buffer and resync. Follow [08-update-protocol.md](08-update-protocol.md).

## Development server handshake state and diagnostic display

`DevSyncState` (`onSyncState`), `LiveDiagnostic.operation`, and the support diagnostic report API are unpublished changes in the local worktree. They are absent from the current published `0.1.0-alpha.4`. Follow [dev-sync-state.md](dev-sync-state.md) for types and meanings and [support-report.md](support-report.md) for the report contract; they are not repeated here.

The handshake makes up to three attempts per snapshot request, with a default timeout of 5000 ms (`requestTimeoutMs`). `connecting` means the first attempt (attempt 1), `retrying` means an attempt after a failure (attempts 2 and 3), and `failed` means all attempts were exhausted or the first send threw. `connected` means the client accepted the server snapshot (manifest); it does not guarantee that translations have been painted on screen. `disconnected` means the socket is disconnected.

Locale-file diagnostics (`LiveDiagnostic`) are maintained separately from `onSyncState`. They clear when the source file becomes valid again and are not overwritten by saves to other valid files. `LiveDiagnostic.operation` exists only on diagnostics emitted by the development client (`handshake` for synchronization-processing errors, `observer` for state-observer callback, eager update subscriber, and eager/lazy `onUpdate` callback errors); server-sent catalog diagnostics do not have it. A lazy `onUpdate` exception, or an exception in the diagnostic callback that reports it, does not disconnect the connection or reject a completed locale change. Regression checks also cover subsequent manifest edits and callback recovery. Follow [dev-sync-state.md](dev-sync-state.md) for the detailed scope.

The example UIs (vanilla, React, Svelte, and SvelteKit) expose connection copy through `role="status"`, error copy through `role="alert"`, and the same status announcement inside an open dialog. Only the `handshake` copy clears on `connected`; catalog diagnostics remain until their file recovers. Verification that the last valid screen remains after a render error was performed in the npm and vanilla examples.

## Deletion and batching

Follow the candidate-registry and batch-publish rules in [02-architecture.md](02-architecture.md) when batching file deletions, renames, and additions. This document summarizes only the results of those decisions.

- Allow namespace deletion and reject deletion of the entire base locale. Distinguish the two.
- Publish accepted base changes and quarantine of incompatible secondary catalogs in the same batch.
- Preserve tombstone versions so loads started before deletion cannot revive them.

## Base schema changes and DOM preservation scope

When a key or placeholder in the base locale changes, secondary translations that use that key may become incompatible. Blocking the entire screen update would defeat the purpose of live updates, so the behavior is as follows.

- Commit valid base changes. Do not postpone the commit.
- Quarantine existing secondary messages made incompatible during development and emit diagnostics. Fall back to the base value for those messages so the screen does not break.
- Validate the base change and locale catalogs together in the candidate transaction. Commit only combinations whose base schema and each locale schema match.
- The quarantine is implemented in the Vite plugin's `LiveRegistry`. The plugin retains both the raw desired state and each file's last-good translations. When the base schema changes, it publishes an immutable catalog containing only messages from the previous good translation that match the new schema, retains the remaining translations and locales, and falls back to the base value for missing messages.
- An invalid secondary edit retains that file's last-good translation and still publishes valid edits to other files. A new secondary with no last-good value is not published. Deleting its file also deletes that last-good value. When the base or translation becomes valid again, the plugin automatically revalidates the raw translation, restores it, and clears that diagnostic. Saving another file successfully does not overwrite the diagnostic.
- Startup and build still validate the entire catalog strictly. `createStore.replaceCatalogs` in the core public API does not add automatic quarantine; when a custom `CatalogSource` supplies an incompatible payload, core rejects it as-is. Quarantine exists only at the plugin layer.
- Quarantine behavior was verified in a browser on 2026-10-07 (KST) through actual watcher and WS automatic updates (see [06-validation-and-roadmap.md](06-validation-and-roadmap.md) for details). Only the narrower translation key was quarantined while other keys and locales remained. Editing that file restored it automatically and cleared the diagnostic; when it became incompatible again, the last-good value remained; edits to other files were not blocked. This edit was schema-breaking, so preserving input and dialog state is an observed case, not a general guarantee.

DOM state preservation scope depends on the type of edit.

| Edit | Schema | DOM state |
| --- | --- | --- |
| Copy value edit, locale addition | Unchanged | Guaranteed. No remount |
| Schema-compatible key edit | Unchanged | Guaranteed |
| Key deletion, required argument addition | Changed | Not guaranteed. The new schema is applied immediately and diagnostics and typegen are emitted together |

A schema-breaking edit can cause existing call sites to throw `InvalidArgumentError`. Quarantine does not protect call sites.

## Error and fallback rules

| Situation | Behavior |
| --- | --- |
| Key with no translation | Fall back to the baseline (baseLocale) value |
| Empty-string value | Treat it as a valid value (not a fallback) |
| Unknown key | `UnknownMessageError` in every environment. Do not expose the key string as-is |
| Access to an unloaded namespace | `NamespaceNotLoadedError`. Load it explicitly with `loadNamespace` before use |
| Missing required argument or wrong type | `InvalidArgumentError` according to the accepted base schema |
| Catalog lookup failure (failed) | Retain the previous UI and reject the Promise with `CatalogLoadError` |
| Earlier intent superseded | `SupersededRequestError` |
| Secondary namespace file deleted | Access to keys in that namespace falls back to baseline values |
| Baseline namespace deleted | Remove its keys and update the schema. Subsequent access is an unknown key |
| All catalogs for the current locale deleted | Switch to baseLocale and publish atomically |
| Entire baseline locale deleted | Reject in development and retain last-known-good (not the same as deleting a file-level namespace) |
| Rename | The final catalog must be consistent |
| Duplicate ID in JSON | Reject (detected during parser preprocessing) |

## Type generation (typegen)

Whether typegen is needed depends on what changed.

| Change | Key and argument schema | typegen |
| --- | --- | --- |
| Copy value only | Unchanged | Not needed. Applied immediately |
| Add or edit a secondary translation | Unchanged | Not needed. Applied immediately |
| Add a locale | Unchanged | Not needed. Applied immediately |
| Change a baseline key or placeholder | Changed | Needed. pending → ready or error |

Adding a locale does not invoke typegen because types come only from base messages (the argument contract in [03-catalog-and-api.md](03-catalog-and-api.md)).

- Typegen input is the accepted schema accepted by the server.
- After the registry commit, client publishing and typegen run independently in parallel. Neither waits for the other.
- There is no guarantee that typegen always lags the browser. It may finish first depending on the network and processing order.
- The UI path does not await typegen. Runtime updates apply independently of typegen.
- Strict generated types do not guarantee autocomplete for a new key at the moment it is saved. Types update only after typegen finishes.
- Run typegen as a background task and use a generation token to prevent older work from overwriting the latest output. Write results atomically only when the content actually changed.
- The build waits for typegen to finish. Initial schema readiness runs typegen to completion when dev serve starts so it stays ahead of consumers.

The current implementation consists of the declaration renderer, CLI, and worker in `@0disoft/saylo-typegen` and the `typegen.outFile` option in `@0disoft/saylo-vite`. Vite passes the accepted baseline schema, sends the live snapshot, then requests background generation. Pending work is merged into the latest generation, and stale results are rechecked before an atomic file replacement. Initial generation failure stops startup; live generation failure is written to the server log. The CLI generates declarations after strict validation of all disk catalogs completes. The React demo's build order is generate → consumer tsc → Vite build. Only `.d.ts` files and this generator's temporary files are excluded from watch/HMR; unrelated type files remain watched.

## Support diagnostic reports

`createSupportReport` and `createSupportRecorder` are local unpublished APIs and are absent from published `0.1.0-alpha.4`. The contract and example UI flow are in [support-report.md](support-report.md), so they are not repeated here.

In brief, collection is memory-only. It retains the latest 32 events and the first 64 diagnostic rows per event, and reports discarded amounts through `omittedEvents` and `omittedDiagnostics`. It does not include human-readable copy, file names, locales, keys, arguments, request IDs, URLs, stacks, or environment variables. Diagnostic codes use an allowlist (unknown codes become `UNKNOWN`), sources use numeric aliases within an event, and positions contain only numeric coordinates. The library does not store or transmit reports; the user reviews `getReport()` and copies or sends it manually. `clear()` empties accumulated history, and history remains after recovery. Because the report does not contain raw text, reproduction is provided separately through synthetic translations.

## Example app lifecycle and BFCache

The npm, vanilla, React, and Svelte examples do not clean up when `persisted` is true in a `pagehide` event; they release the root and dispose only when it is false. This keeps the live connection and screen state alive when the browser returns from the back-forward cache. The React example verified that, in the production ESM bundle model, leaving into the cache and returning preserves inputs, modals, and diagnostic data and that the root is released only on final exit (model verification commit `f58f5f3`, `npm run verify:demo:react`).

This verification is based on model DOM events; it is not an observation that a real in-app browser places this page in BFCache. If the real browser does not use the cache, the page loads anew, and the examples do not guarantee persistent storage of input drafts or open modals across a refresh.

## Caches

- Keep message formatter caches separate from `Intl` caches. Follow the format-cache table in [03-catalog-and-api.md](03-catalog-and-api.md) for keys and invalidation rules.
- If copy content is unchanged when the catalog revision changes, do not clear every `Intl` cache.
- Even during a full replacement, reuse formatters for messages whose AST fingerprint is unchanged. Bound and evict old entries, for example with an LRU policy.
- Decide together how unchanged messages are reused and how superseded entries are removed. Decide whether to introduce message deltas after benchmarking expensive full replacements with large fixtures.

## Locale list types

Making the locale list a TypeScript literal union would require waiting for codegen whenever a locale is added. Runtime locale lists are therefore exposed as `readonly string[]`, and the dynamic locale setter validates against an allowlist. Key names and argument types remain strict. Schema and value strictness remain; only the locale set is loosened to a runtime value.
