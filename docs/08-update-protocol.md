# 08. Update Protocol

This document is the single source for Saylo's development update and boot wire protocols. It defines patch and snapshot encoding, boot encoding, application, and resync rules. The public types in [03-catalog-and-api.md](03-catalog-and-api.md) and the policies in [04-live-update-and-types.md](04-live-update-and-types.md) refer to this document.

## Current eager implementation (2026-10-05)

Current `@0disoft/saylo-vite` replaces the entire registry. The actual types are in `packages/vite/src/types.ts`, and reconciliation logic is in `dev-sync.ts`.

| Event | Content |
| --- | --- |
| `saylo:request-eager-snapshot` | `scope: 'eager'`, unique `requestId`, client `generation`, and current `locale` and `namespaces` |
| `saylo:eager-snapshot` / `kind: 'snapshot'` | Echoes the request and returns server `sessionId`, `revision`, `baseLocale`, and all `catalogs` |
| `saylo:eager-snapshot` / `kind: 'update'` | Server `baseRevision` and `revision` plus the full registry |
| `saylo:eager-diagnostic` | File errors are broadcast; request diagnostics include request identity and are returned only to that client |

Server revision and client request generation are independent. The first request is made after listener registration, and gaps, new sessions, and reconnections recover through a snapshot. Only one request is active; during recovery, updates are merged into one latest session/revision hint. Responses for stale requests or with a revision lower than the observed revision are not published. The default timeout is 5 seconds per request with up to three attempts; on failure, the last valid state remains. The next update or connection event may trigger another attempt. Disconnect, teardown, and dispose invalidate requests and timers.

A request's locale and namespaces describe the current state, while a `scope: 'eager'` response replaces everything. Per-pair outcome, version, and tombstone and request-scoped partial deltas were connected on the lazy-loading path, and opt-in push for the lazy dev source was implemented locally. The real-browser path for a Vite server restart includes a page refresh, which does not require DOM preservation.

## Wire types

The current lazy path separates manifest lookup from pair lookup. Full present responses use compact encoding, while missing and failed use the existing outcome format. If the immediately preceding baseline matches, the response becomes a request-scoped message-delta patch. Push does not replace this request path; it sends only changes to cached pairs registered in the scope as a separate event. The wire types below are the current implementation in `packages/vite/src/types.ts` and `catalog-wire.ts`.

| Event | Current lazy transport |
| --- | --- |
| `saylo:request-manifest` | Requests all metadata using the eager handshake's request ID and generation |
| `saylo:manifest` | Snapshot response or update with `baseRevision`. Contains the full list, pair versions, schema fingerprints, and missing tombstones, with no AST |
| `saylo:request-catalog` | Unique request ID and generation plus one locale and namespace pair. If a present pair was previously received, include an optional `known { sessionId, catalogVersion }` |
| `saylo:catalog` | Request echo and result. If the baseline matches, send a `status: "patch"` delta; otherwise, send a full present result with `status: "compact"` and `encoding: "saylo-catalog-v1"`. Missing and failed use the existing outcome format |

`virtual:saylo/lazy` includes only the base+target outcomes for the initial scope and exports a source handle. The development source is created with `{ push: true }` and registers owner, session, and cached-pair metadata through `saylo:catalog-scope`. The server sends only changed cached pairs through `saylo:catalog-push`; unknown pairs receive only metadata and are fetched later. After applying the manifest response, core's `refresh` prepares the current desired scope again, and `catalogSource` fetches each pair against the immediately preceding baseline. It does not receive ASTs for pairs not yet cached; cached inactive pairs may receive pushes, and the UI snapshot does not change when they do not affect the current translation or base fallback. Lookup responses validate request identity, session, pair version, and schema. Reconnection invalidates identities, registers the scope again, and re-requests against the current manifest. Multiple instances share the source and release only their own connections and subscriptions. Existing eager full updates are sent only to the Vite client that requested the eager snapshot.

The namespace schema fingerprint is the UTF-8 SHA-256 of canonical JSON containing the normalized namespace, keys, and acceptedTypes (`saylo-schema-v2:sha256:` followed by 64 hexadecimal characters). Fixed-length digests replaced repeated transmission of large schema strings per locale and pair. Existing boot and chunk data stored in the `saylo-schema-v1:` format must be regenerated.

### Current compact full catalog (2026-10-07)

The actual types are in `packages/vite/src/catalog-wire.ts`. Only full present responses on the lazy development socket use compact encoding. After decoding, the client runs the existing manifest checks and immutable processing, then passes a normal present outcome to core. Implementation and measurements are recorded in [16-compact-catalog-transport.md](16-compact-catalog-transport.md).

- The envelope contains `status: "compact"`, `encoding: "saylo-catalog-v1"`, and the current `sessionId`, `key`, `catalogVersion`, and `namespaceSchemaFingerprint`.
- The catalog payload is `{ sourceName, schemas, messages }`. A message is `[id, source, offset, line, column, ast, schemaIndex]`, and identical arguments JSON shares an entry in `schemas`.
- Top-level literal and argument AST nodes are sent as `[type, value]` without a position or `[type, value, startOffset, startLine, startColumn, endOffset, endLine, endColumn]` with one. Complex ICU nodes and their nested content retain the existing AST shape. File and AST offset, line, and column values are unchanged, and the client does not reparse ICU.
- Invalid encoding, stamps, tuples, positions, schema references, or duplicate IDs reject that request and retain the last valid UI. A later new request may recover. This is distinct from the existing rule that re-requests full data within the timeout for a broken patch.
- Missing, failed, patch, eager snapshots, initial boot, production chunks, and the SSR boot wire retain existing formats. The client also accepts normal present responses. The plugin and development client that send the new compact response must use the same package implementation.

### Current request-scoped delta patch (2026-10-06)

Actual types are in `packages/vite/src/catalog-patch.ts`; server decisions are made by `loadDelta` in `catalog-registry.ts`.

```ts
interface CatalogStamp { readonly sessionId: string; readonly catalogVersion: number; }
interface PositionShift { readonly offsetDelta: number; readonly lineDelta: number; readonly columnDelta: number; }

interface CatalogPatch extends CatalogStamp {
  readonly status: "patch";
  readonly key: CatalogKey;
  readonly namespaceSchemaFingerprint: string;
  readonly base: CatalogStamp;                                         // 적용 조건: 현재 baseline과 같아야 함
  readonly sourceName: string;
  readonly messageCount: number;                                       // 적용 후 메시지 수. 다르면 거절한다
  readonly upsert: readonly (readonly [string, ParsedMessage])[];       // [ID, ParsedMessage]
  readonly remove: readonly string[];                                   // [ID]
  readonly positions: readonly (readonly [string, SourcePosition])[];   // [ID, SourcePosition]
  readonly positionShift?: PositionShift;                              // 일괄 이동. positions가 개별 ID를 덮는다
}
```

- The server keeps only the previous present version for each pair (no deletion and recreation history). It creates a patch only when the request's `known` matches the current or immediately previous version.
- A patch contains the current `sessionId`, `key`, `catalogVersion`, `namespaceSchemaFingerprint`, `sourceName`, `messageCount`, and `base` stamp. Changed message `source` values go in upsert, missing IDs in remove, and position-only changes in positions.
- If an unchanged-source message has identical delta (offset, line, column) and at least two positions actually moved, compress the `positions` list into one `positionShift`. If some positions do not move, the deltas differ, or fewer than two moved, send the `positions` list as-is. An ID in `positions` overrides the aggregate shift for that ID.
- Application validates `messageCount` and position values (integers; offset ≥ 0; line and column ≥ 1). A message-count mismatch or invalid position rejects the patch and retains the previous valid state.
- A zero-message patch may carry a new fingerprint even when the pair version is unchanged if only the schema fingerprint changed. Reformatting formatter JSON that moves positions only increments the version and aligns the baseline precisely; core skips rendering when UI meaning is unchanged.
- The client fixes an immutable baseline per request, so responses may arrive out of order across multiple instances safely. It passes only new full `CatalogOutcome` values to core and publishes base+target in one commit. The cache keeps one stale baseline per present pair in the current session, and `getCatalogs` exposes only pairs matching current metadata.
- A past-version gap, new session, dense change set, deletion and recreation, or absent `known` falls back to full present/missing data. A broken patch is retried once within the existing timeout with a new `requestId` and a full request without `known`. If that response is also a patch, it is rejected and the previous valid UI is retained.
- Existing eager full snapshots, the production chunk loader, and the SSR boot wire remain unchanged.

Core first checks whether the ID exists in the base, then reuses a `validateTranslation` result when the deeply frozen translation argument schema and base-message argument schema are an object pair that previously passed validation. One translation schema may retain successful results for multiple base contracts; mutable inputs and new contracts are validated again. Follow [18](18-shared-argument-schemas.md) for sharing identical argument schemas within a parse call and the scope of validation records. When deciding pair versions, the server compares key, source, and position directly without sorting or stringifying.

### Current push wire (local, unpublished)

The dev source from `virtual:saylo/lazy` is created with `{ push: true }`. Manual `createDevCatalogSource` uses `push: true` as an opt-in and defaults to `false` for compatibility with existing calls. It is absent from published `0.1.0-alpha.4`.

| Event | Direction | Content |
| --- | --- | --- |
| `saylo:catalog-scope` | client → server | `{ owner, sessionId, catalogs }`. Registers owner, session, and cached pair metadata |
| `saylo:catalog-push` | server → client | `{ kind: "patch", owner, baseRevision, manifest, outcomes }` |

```ts
interface CatalogScope {
  readonly owner: string;
  readonly sessionId: string;
  readonly catalogs: readonly CatalogMetadata[];
}

interface CatalogPush {
  readonly kind: 'patch';
  readonly owner: string;
  readonly baseRevision: number;
  readonly manifest: CatalogManifest;
  readonly outcomes: readonly CatalogWireResult[];
}
```

- `outcomes` contains existing compact, full, or missing outcomes, or `status: "patch"` message deltas. The server sends only pairs registered in the scope whose version or schema changed; pairs absent from the cache receive metadata only.
- The client validates the payload and `baseRevision`, replaces the cache and applies the manifest together, and publishes one atomic UI snapshot to core. An immediately following metadata broadcast for the same revision is skipped.
- Malformed, missing, or gap data recovers through the existing snapshot and pair lookup. `stop` and `dispose` release only that owner's subscription and retain the shared Vite socket. Reconnection registers the scope again.
- Session and revision validation reuses the existing `EagerSync` contract. Push is additive and retains request deltas, compact full responses, boot, and server request paths.

## Application rules

- Apply payloads only to already-cached (locale, namespace) pairs. For uncached pairs, keep only the manifest version update to track a cache mismatch and discard the AST payload.
- Publish the UI from one atomic candidate computation. Do not expose an intermediate state in which the schema is new but the catalog is old.
- Process metadata changes and payload application in the same commit, and notify only once when the commit finishes.
- Discard patches from the same session whose revision is less than or equal to one already applied.
- Apply when `baseRevision` equals the currently applied revision and `revision` is greater.
- Treat a future `baseRevision` or an overlap that cannot be applied as a gap and resync. Do not discard solely because of reverse order.

## Snapshot requests and resync

- The lazy handshake is a metadata-only manifest snapshot. The lazy source's request scope is baseLocale with an empty namespace list. An eager request describes the current locale and namespaces, but its response is the full registry.
- After accepting the manifest, lazy reuses required base+target pairs from the cache or prepares them through `loadCatalog` when core `refresh` runs, then publishes one atomic UI snapshot after all are ready. There is no contract that a manifest response alone supplies all catalogs, schemas, and records.
- Mismatches for uncached pairs are tracked by comparing the manifest version update with the cache version, not by a separate dirty flag. If a cached inactive pair changes through push but does not affect current translation or base fallback, the UI snapshot is not changed.
- `EagerSync` does not buffer an array of patches. It keeps one latest session/revision hint and requests a new snapshot when a response revision does not connect to that hint.
- Resync reasons are initial connection, revision gap, reconnection, and the server announcing a new session. Reconnection invalidates every in-progress load and `requestGeneration`, then realigns with new requests.
- Ignore responses to stale requests. Do not send multiple simultaneous snapshot requests; use `requestId` and `generation` to identify late responses.

## Generation and intent replacement

Generation is a value that blocks stale transport completions. It does not cancel every caller whenever generation changes. Follow desired-state reconciliation in [04-live-update-and-types.md](04-live-update-and-types.md) for detailed policy.

- Keep an in-progress intent in a pending waiter. Resolve it when preparation finishes if it remains in the latest desired state.
- If `loadNamespace("cart")` is added while `setLocale("en")` is in progress, both intents remain in the latest desired state and both resolve.
- Reject with `SupersededRequestError` only when an earlier locale intent is actually replaced. `dispose` uses a separate reason.
- Timeout or network failure rejects the current intent and retains the previous UI.
- Do not publish an obsolete network response from an earlier generation directly to the UI. Reusing a cache entry with a matching version is allowed.

## Boot encoding and dev metadata

- Serialize `BootSnapshot` ([03-catalog-and-api.md](03-catalog-and-api.md)) into the wire format. Boot wire v1 currently contains `format: 'saylo-boot-v1'`, `manifest`, `locale`, `timeZone`, `stateRevision`, `loadedNamespaces`, `baseSchemas` (`CatalogSchema[]`), and `catalogOutcomes` (`CatalogOutcome[]`). `catalogOutcomes` contains each parsed catalog's sourceName, locale, AST, and arguments in arrays and explicitly lists missing outcomes. The public UI snapshot is `StoreSnapshot`, and the transport unit is `CatalogOutcome`.
- Boot contains locale, baseLocale, resolved timeZone, the available manifest, currently loaded namespaces, the version and provenance of base schemas and catalog records, and a present/missing decision and version for every base+target pair in loadedNamespaces. Do not infer missing data to mean normal absence.
- During development, initial transport information (development session and registry snapshot) is exchanged through a separate fixed opaque handle. The handle is stable and is used only for retrieving dev metadata.
- The `CatalogSource` metadata path receives the dev session and registry snapshot, decodes boot, and uses the result to construct core's `UiSnapshot`.
- Short boot example:

```ts
// virtual:saylo/server (server-only)
import { serializeBootSnapshot } from '@0disoft/saylo-core';
import { createRequestI18n } from 'virtual:saylo/server';
const request = await createRequestI18n({ locale: 'en' });         // async scope 준비 후 요청별 instance
try {
  const boot = serializeBootSnapshot(request.getBootSnapshot()); // 서버 HTML과 함께 전달한다.
} finally { request.dispose(); }
```

```ts
// client: 서버 JSON으로 초기 스냅샷을 만들고 브라우저용 source를 연결한다.
import { createI18n, decodeBootSnapshot } from '@0disoft/saylo-core';
import { createHydrationAdapter } from '@0disoft/saylo-react';
import { catalogSource } from 'virtual:saylo/lazy';
const decoded = decodeBootSnapshot(script.textContent);
const client = createI18n({ initialSnapshot: decoded, catalogSource });
const adapter = createHydrationAdapter(client);                     // boot S1 유지, finishHydration 후 1회 publish
```
