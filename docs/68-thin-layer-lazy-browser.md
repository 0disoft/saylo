# 68. Thin-layer lazy browser wire transport

## Scope

This records wire transport through the public `virtual:saylo/lazy` source and the `connectDev` bridge in a real Chromium and Vite development server after [67](67-thin-layer-lazy-contracts.md). It is benchmark-only; product packages, public APIs, and versions did not change.

It verifies requests for six catalog pairs, compact and patch frames, partial requests, last-good retention and recovery for invalid JSON, `connectDev` detach and rebind handshakes, and the default reload after a physical Vite socket close. It does not verify transparent physical reconnection, server restart or session replacement, pending reply races, typegen, production browser lazy loading, or performance.

The observations were made on 2026-10-11 (KST).

## Code

- Executed code: [lazy-browser-probe.mjs](../benchmarks/thin-layer/lazy-browser-probe.mjs) · [lazy-browser-app.jsx](../benchmarks/thin-layer/lazy-browser-app.jsx) · [lazy-layer.mjs](../benchmarks/thin-layer/lazy-layer.mjs) · [lazy-source-cache.mjs](../benchmarks/thin-layer/lazy-source-cache.mjs) · [chrome-protocol.mjs](../benchmarks/thin-layer/chrome-protocol.mjs)
- There are two variants, `core` and `layer`. `core` uses `createI18n` from product `@0disoft/saylo-core/runtime`; `layer` uses `createLazyLayer` from the benchmark-only [lazy-layer.mjs](../benchmarks/thin-layer/lazy-layer.mjs).
- Both variants use `catalogSource`, `initialCatalogs`, `initialLocale`, `initialNamespaces`, and `timeZone` from public `virtual:saylo/lazy`, plus `connectDev` from `@0disoft/saylo-vite/client`. The development virtual module creates a real `createDevCatalogSource`; it does not use `createStaticCatalogSource`.
- The app injects no synthetic manifest, catalog reply, or socket events. Requests and responses come from the real plugin transport. The React UI subscribes to runtime snapshots through `useSyncExternalStore`.
- Each variant has an independent temp directory, Vite development server, and Chromium user-data directory. Locales en, fr, and ja by namespaces demo and help produce six pairs, with baseLocale en, initialLocale fr, empty initialNamespaces (empty boot), and UTC. The `layer` source directly imports the benchmark file through an absolute `/@fs/` path.
- A second Vite plugin observes wire traffic. Its `configureServer` records requests received through `server.ws.on('saylo:request-catalog')`, wraps `socket.send` for each connection, and records the event, manifest `registryRevision`, request, `result.status`, and diagnostic for outgoing `saylo:` messages.
- The environment uses Node v24.18.0, Vite 8.3.2, React 19.3.0, react-dom 19.3.0, i18next 26.4.3, and intl-messageformat 12.1.3; the browser is HeadlessChrome/154.0.0.0. Values come from `packages`, `node`, and `userAgent` in the raw data.

## Observed results

Each variant has 12 stages, for 24 observations in total. Both variants have the same catalog-pair request order, response types, and stage values. Request identity and session IDs are generated separately for each fixture. Each variant makes 9 catalog requests and produces 21 wire frames.

Frame composition is 6 catalog compacts, 3 catalog patches, 3 manifest snapshots, 4 manifest updates, and 5 eager diagnostics, for 21 total. Two of the three snapshots cover the initial connection and rebind; one covers the reloaded page's connection after socket close. The five diagnostics also include one from after reload.

The nine requests are, in order: en/demo compact, fr/demo compact, ja/demo compact, en/help compact, ja/help compact, ja/demo patch (`catalogVersion` 1), ja/demo patch (`catalogVersion` 2), fr/help compact, and fr/demo patch (generation 2, `catalogVersion` 1). Loading demo requests the base-locale en and selected-locale fr pairs; loading help requests the en and ja pairs. All three patches place `sessionId` and `catalogVersion` under `known`.

| id | locale | request | cache | revision | demo | help | Preserved |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| cold | fr | 0 | 0 | 0 | unloaded | unloaded | true |
| load-demo | fr | 2 | 2 | 0 | fr Ada | unloaded | true |
| select-ja | ja | 3 | 3 | 0 | ja Ada | unloaded | true |
| load-help | ja | 5 | 5 | 0 | ja Ada | ja-help Ada | true |
| live-edit | ja | 6 | 5 | 1 | Updated Ada | ja-help Ada | true |
| invalid-json-last-good | ja | 6 | 5 | 1 | Updated Ada | ja-help Ada | true |
| recover-json | ja | 7 | 5 | 2 | Recovered Ada | ja-help Ada | true |
| unselected-pair-edit | ja | 7 | 5 | 3 | Recovered Ada | ja-help Ada | true |
| select-fr-fresh-help | fr | 8 | 6 | 3 | fr Ada | Fresh-help Ada | true |
| detached-last-good | fr | 8 | 6 | 3 | fr Ada | Fresh-help Ada | true |
| rebind-catch-up | fr | 9 | 6 | 4 | Rebound Ada | Fresh-help Ada | true |
| physical-socket-loss-vite-reload | fr | — | 0 | 0 | unloaded | unloaded | false |

`cache` is the length returned by `catalogSource.getCatalogs()`; `request` is the cumulative catalog-request count through that stage. The final stage did not record a separate cumulative request count. Cold starts from an empty boot with request and cache both 0; cache grows from 0 to 2 to 3 to 5 during load-help. Revision 0 immediately after reload is the source observation at that instant, not the state after all new manifest handshakes complete.

### State preservation

CDP observations for stages 1 through 11 verified `input` DOM identity and value (`typed draft`), focus, caret positions 2 through 7, the open `dialog`, React counter `8`, `boots` 1, and `errors` `[]`. The retained previous snapshot from the initial demo load kept `fr Ada` from stages 3 through 11. The document did not reload through stage 11.

### Invalid JSON and recovery

Saving `{` to `ja/demo.json` records one diagnostic (`ja/demo.json: Invalid JSON: Expected property name or '}' in JSON at position 1 (line 1 column 2)`) while the display retains the previous valid message, `Updated Ada`. This save does not increase catalog requests (it remains 6).

Saving valid content commits `Recovered Ada`, raises revision to 2, and sends one additional patch request (7).

### Partial requests and fresh help

Editing an unselected pair (fr/help) broadcasts only a manifest update (revision 3), with zero catalog requests (request remains 7 and there is no `fr/help` request). The display stays `Recovered Ada`.

Switching the locale to fr then fetches fr/help as a fresh compact and applies the edited value `Fresh-help Ada` (request 8, cache 6).

### Detach and rebind

After `connectDev` cleanup (`stop()`), editing fr/demo delivers a server broadcast frame (revision 4), but the app snapshot retains last-good `fr Ada` and makes zero requests.

Calling `bind()` again performs a real manifest-snapshot handshake, then receives a patch, catches up to `Rebound Ada`, and advances revision to 4 (request 9). Before socket close, there are two `saylo:manifest` snapshot handshakes.

### Physical socket close

After verifying that `vite.ws.clients` contains one client, calling `client.socket.terminate()` closes the actual connection. The default Vite 8 client succeeds at a reconnect ping and then calls `location.reload()`. The reloaded page returns to `boots` 2, `loadedNamespaces` `[]`, greeting `unloaded`, input `initial draft`, counter `7`, and a closed dialog; preservation is false. Both variants behave the same way.

This is the default Vite client's reload path. It is not a transparent physical reconnection, and this experiment does not cause a server restart or session replacement.

## Interpretation and limitations

- This verifies feature behavior and wire order. The observation that both variants produce the same values across 12 stages means both follow the same public wire contract; it is not a performance comparison. No timing was measured.
- `layer` is a benchmark-only prototype and not a product entry path. These results do not justify adopting the independent runtime for the product.
- Remaining items are pending-reply races, a fresh session in a real browser, production browser lazy loading, typegen, the full layer comparison, performance, and memory.
- Product packages, public APIs, versions, and remote state are unchanged.

## Source data and reproduction

The source data is [thin-layer-lazy-browser-2026-10-11.json](../benchmarks/results/thin-layer-lazy-browser-2026-10-11.json). All 20 `codeHashes` in the raw result match the current source, and each fixture was cleaned up inside its owned temp directory.

```sh
node benchmarks/thin-layer/lazy-browser-probe.mjs --out benchmarks/results/thin-layer-lazy-browser-2026-10-11.json
```

## Status

The probe, app, raw data, and package script are in local commit `51f1393` and have not been pushed. No product package API, dependency, or version changed, and nothing was published or deployed.

## Follow-up: typegen consumer contracts (`26e9df0`)

This covers the browser lazy wire. [69](69-thin-layer-typegen.md) records a benchmark-only hand-written `.d.mts` facade, real TypeScript and checkJs consumers, and typegen worker and watch updates in a real Vite development server. The 12 stages and determination above remain valid.
