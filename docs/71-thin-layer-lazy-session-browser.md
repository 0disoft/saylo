# 71. Thin-layer lazy session browser

## Scope

This records how public `virtual:saylo/lazy` `createDevCatalogSource` and `connectDev` handle session replacement and late responses in a real Chromium and two independent Vite development servers (core and prototype), following [68](68-thin-layer-lazy-browser.md) and [70](70-thin-layer-lazy-production-browser.md). It is benchmark-only; product packages, public APIs, and versions did not change.

It verifies that the UI remains valid when product replies received by real `socket.send` are held and reordered without byte changes; late responses after locale-request supersession; and a new session plus replay of an older response after physically stopping and restarting the server on the same port. It does not verify performance, memory, the full race surface, transparent reconnection, or a new session in the same browser instance. It does not overturn earlier SSR or production observations.

The observations were made on 2026-10-11 (KST).

## Code

- Executed code: [lazy-session-browser-probe.mjs](../benchmarks/thin-layer/lazy-session-browser-probe.mjs) · [lazy-browser-app.jsx](../benchmarks/thin-layer/lazy-browser-app.jsx) · [lazy-layer.mjs](../benchmarks/thin-layer/lazy-layer.mjs) · [lazy-source-cache.mjs](../benchmarks/thin-layer/lazy-source-cache.mjs) · [chrome-protocol.mjs](../benchmarks/thin-layer/chrome-protocol.mjs)
- There are two variants, `core` and `layer`. `core` uses `createI18n` from product `@0disoft/saylo-core/runtime`; `layer` uses `createLazyLayer` from benchmark-only [lazy-layer.mjs](../benchmarks/thin-layer/lazy-layer.mjs). Both use the same React template, public development source, and `connectDev` bridge.
- Each variant has an independent temp directory, Vite development server, and Chromium user-data directory. Locales en, fr, and ja by namespaces demo and help use baseLocale en, initialLocale fr, empty initialNamespaces (empty boot), and UTC. Manifest and catalog contents and Vite connection events are not synthesized. The control barrier and replay of earlier responses are recorded separately below.
- A wire-observation plugin wraps `socket.send` on each connection. It `JSON.parse`s only `saylo:` custom string payloads and records event, generation, kind, request, `result.status`, sessionId, revision, `catalogVersion`, `held`, and `payloadSha256`. In hold mode (fr reply and ja compact), it adds the payload to the `held` array and defers the original send. `release()` asserts `readyState` 1 and `hash(payload) === frame.payloadSha256`, then sends the exact bytes over the same socket.
- After sending a held response or replaying one, it uses a custom FIFO barrier. It sends `saylo-probe:barrier` to every client, waits for that ID to appear in `read().barriers`, and then checks UI state and notification counts.
- The environment uses Node v24.18.0, Vite 8.3.2, React 19.3.0, react-dom 19.3.0, i18next 26.4.3, and intl-messageformat 12.1.3; the browser is HeadlessChrome/154.0.0.0.

## Observed results

Each variant has 12 stages, for 24 total. Both variants have the same stage values shown below. Session and request IDs are generated separately for each fixture. Each variant makes seven catalog requests; the notification vector is 0/1/1/1/2/2/2/2/2/0/1/1.

| id | locale | text | cache | revision | notifications | Preserved |
| --- | --- | --- | ---: | ---: | ---: | --- |
| cold | fr | unloaded | 0 | 0 | 0 | true |
| load-demo | fr | fr Ada | 2 | 0 | 1 | true |
| patch-held-last-good | fr | fr Ada | 1 | 1 | 1 | true |
| newer-full-held-last-good | fr | fr Ada | 1 | 2 | 1 | true |
| newer-full-first | fr | Current Ada | 2 | 2 | 2 | true |
| older-patch-late-ignored | fr | Current Ada | 2 | 2 | 2 | true |
| locale-request-held-last-good | fr | Current Ada | 2 | 2 | 2 | true |
| newer-locale-wins | fr | Current Ada | 2 | 2 | 2 | true |
| superseded-locale-reply-ignored | fr | Current Ada | 3 | 2 | 2 | true |
| new-session-vite-reload | fr | unloaded | 0 | 0 | 0 | false |
| new-session-fresh-catalog | fr | Restarted Ada | 2 | 0 | 1 | false |
| retired-document-reply-replayed | fr | Restarted Ada | 2 | 0 | 1 | false |

`cache` is the length returned by `catalogSource.getCatalogs()`. Stages 1 through 9 preserve input DOM identity and value `typed draft`, focus, caret positions 2 through 7, the open dialog, counter `8`, `boots` 1, `errors` `[]`, and `diagnostics` `[]`; preservation is true. After the default Vite reload, stages 10 through 12 have `boots` 2, input `initial draft`, counter `7`, and a closed dialog; preservation is false.

### Late patch and full compact

Editing fr/demo to `Obsolete {name}` (patch, `catalogVersion` 2) and `Current {name}` (full compact, `catalogVersion` 3) holds both responses. Server history retains only the preceding version, so a full compact is the expected response to a v3 request carrying `known` `catalogVersion` 1. The probe's first attempt assumed v3 was also a patch and timed out, but that was not a product defect; holding the whole compact fixed the probe. No raw result was kept for the failed attempt. Releasing v3 first commits `Current Ada` once and raises notifications to 2; releasing the late v2 patch afterward leaves the UI and notification count unchanged.

### Locale supersession

While the compact for the ja locale API request is held, superseding it with the fr locale API rejects the older ja request with `SupersededRequestError` and fulfills the newer fr request. After the late JA response, the UI retains fr `Current Ada` and notifications 2. The late response is not necessarily discarded from the source cache: a valid JA response can raise cache from 2 to 3, and the raw result does show 3. This experiment verifies prevention of UI publication.

### Session replacement

After the actual old `vite.close()`, fr/demo is changed to `Restarted {name}` while no watcher is running, and a new Saylo plugin (with a new UUID) and new Vite server start on the same port. The default Vite reconnect ping reloads the document without a manual navigation. The new document has `boots` 2, `initial draft`, counter `7`, a closed dialog, cache 0, and a new SID distinct from the old one. Loading namespace demo returns two compact replies for base en and fr, with no `known`, `catalogVersion` 1, the new SID, and display `Restarted Ada`. A controlled replay of the actual old v2 patch raw bytes on the new socket (explicit fault injection, not a natural occurrence) leaves the new document at `Restarted Ada` and notifications 1. This is neither SID adoption by the same i18n instance nor continuation of a pending flight across a session boundary.

## Interpretation and limitations

- This covers UI observations during late responses and session replacement. It is not evidence for performance, memory, the full race surface, transparent reconnection, or opening a new session in the same browser instance.
- The new session uses the default Vite client reload path. As stated in [01](01-product-and-scope.md), state preservation is not guaranteed across a Vite restart or reconnection reload.
- `layer` is a benchmark-only prototype and not a product entry path. Product packages, public APIs, versions, and remote state are unchanged, and earlier SSR and production results remain valid.

## Source data and reproduction

The source data is [thin-layer-lazy-session-browser-2026-10-11.json](../benchmarks/results/thin-layer-lazy-session-browser-2026-10-11.json). All 18 `codeHashes` in the raw result match the current source, and owned temp fixtures were cleaned up. Each variant has three `release-on-original-socket` deliveries and one `controlled-replay-on-new-socket` delivery.

```sh
node benchmarks/thin-layer/lazy-session-browser-probe.mjs --out benchmarks/results/thin-layer-lazy-session-browser-2026-10-11.json
```

## Status

The probe, raw data, and package script (`probe:lazy-session-browser`) are in local commit `3a4251c`, reusing the existing app template. They have not been pushed, and product package APIs, dependencies, and versions are unchanged.

## Follow-up: synchronous construction contracts (`15605cd`)

[72](72-thin-layer-sync-construction.md) records rerunning the same contracts through the synchronous construction path. The reply-hold, locale-supersession, and session-replacement observations and determination in this document remain valid.
