# Development sync state (`onSyncState`)

## Scope

`connectDev` in [`@0disoft/saylo-vite/client`](../packages/vite/README.md) reports handshake state with the development server through `onSyncState(state)`. The eager path (`ConnectDevOptions`) and lazy path (`ConnectLazyDevOptions`) use the same `DevSyncState`.

This API is included in alpha.5 and is absent from alpha.4.

## Types

```ts
interface DevSyncState {
  readonly status: 'idle' | 'connecting' | 'retrying' | 'connected' | 'disconnected' | 'failed' | 'stopped';
  readonly attempt: number;   // 현재 handshake 시도, 또는 마지막 실패 시도
  readonly maxAttempts: 3;
}
```

Each state is a new `Object.freeze`d object. `attempt` is 1 in `connecting`, 2 or 3 in `retrying`, and the last attempt value in `failed`; it is 0 in `idle`, `connected`, `disconnected`, and `stopped`.

## Example

```ts
import { connectDev } from '@0disoft/saylo-vite/client';
import type { DevSyncState } from '@0disoft/saylo-vite/client';

const disconnect = connectDev(store, {
  hot: import.meta.hot,
  onSyncState: (state: DevSyncState) => {
    if (state.status === 'failed') {
      console.warn(`동기화 ${state.attempt}/${state.maxAttempts}회 실패, 마지막 정상 상태 유지`);
    }
  },
});
```

## States

| status | When | attempt |
| --- | --- | --- |
| `idle` | Before the first request | 0 |
| `connecting` | First attempt in progress | 1 |
| `retrying` | Retry in progress | 2 or 3 |
| `connected` | Client accepted the server snapshot (manifest) | 0 |
| `disconnected` | Development server socket closed | 0 |
| `failed` | Attempts exhausted or the initial send failed | Last attempt |
| `stopped` | After stop or dispose | 0 |

## Meaning and responsibility boundaries

`DevSyncState` describes handshake state, not app render state. `connected` means the client accepted the server's eager snapshot or lazy manifest; it does not mean that an individual lazy catalog `loadCatalog` succeeded or that translations were painted on screen. Locale file diagnostics remain the responsibility of `onDiagnostic` and are separate from `onSyncState`.

The eager path returns a noop from `connectDev` when there is no hot context in production and does not call the state callback. On the lazy path, the source created by `createDevCatalogSource` provides `getSyncState()` and `subscribeSyncState()`. Both are optional methods on the `DevCatalogSource` interface, preserving type compatibility with external sources written before this API. The bridge accesses them through `source.getSyncState?.()` and `source.subscribeSyncState?.()`, so it works with sources that lack both methods.

`subscribeSyncState` does not replay the current state at subscription time. The lazy bridge in `connectDev` subscribes, passes the current state once from `getSyncState()`, and then forwards only changes. After `stop()` or `dispose()`, the bridge does not call the callback again. Consumers that subscribe directly to the source's `subscribeSyncState` may receive `stopped`.

Exceptions thrown by a state observer are reported through `onDiagnostic`; the handshake, timer cleanup, and other observers continue. If the observer throws on the initial send, the state becomes `failed` (attempt 1), `connectDev` rethrows the exception as before, and the binding is released.

`LiveDiagnostic` has `operation?: 'handshake' | 'observer'`. `handshake` covers synchronization processing errors; `observer` covers errors in state observation callbacks, eager update subscribers, and eager/lazy `onUpdate` callbacks. The lazy bridge reads `source.getCatalogs()` outside callback protection and wraps only `onUpdate`, so a throwing initial `onUpdate` keeps the binding and does not reject a completed locale switch. If `onDiagnostic`, which reports that error, also throws, the update still continues. Errors from other direct subscribers of the lazy instance (`I18n.subscribe`) go through the existing core path. The bridge classifies an `AggregateError` from an eager store update subscriber as `observer`. Catalog diagnostics sent by the server do not have this field. The example UI clears only the `handshake` text on `connected` and keeps catalog diagnostics separate.

In the current checkout, synchronous exceptions from `onDiagnostic` are isolated so they do not stop synchronization. If the diagnostic callback throws while reporting an eager initial update or store subscriber error, the committed revision and binding are preserved. Other eager stores on the same socket and other subscribers of `DevCatalogSource.subscribeDiagnostic` still receive the original diagnostic. When an external source on the lazy bridge invokes an already scheduled diagnostic callback after stop, it is ignored on the released binding. Errors from the diagnostic callback itself are not reported back through the same callback or printed automatically to the console. Rejected Promises from async callbacks are outside this synchronous exception protection and must be handled by the consumer. This isolation is a change after the alpha.4 published build and is included in alpha.5.

A synchronous exception from `DevCatalogSource.subscribeManifest` is also reported as an `observer` diagnostic. It does not cancel acceptance of a valid manifest or trigger a new request; other subscriber notifications and the initially awaited catalog request continue. If a subscription is removed or the source is disposed during notification, that subscriber is skipped if it has not been called yet. Validation failures in the manifest contents themselves remain under the existing `handshake` error handling.

The retry policy is unchanged. The default per-request timeout is 5000 ms (`requestTimeoutMs`), with up to 3 attempts; retries happen on a new socket connection or a response gap. There is no manual retry API.
