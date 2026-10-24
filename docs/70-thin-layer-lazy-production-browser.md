# 70. Thin-layer lazy production browser

## Scope

This records validating two real Vite HTML production builds with a static HTTP server and headless Chromium after [68](68-thin-layer-lazy-browser.md) and [69](69-thin-layer-typegen.md). It is benchmark-only; product packages, public APIs, and versions did not change.

It verifies partial loading of catalog chunks, input and DOM preservation, English fallback, no-op refresh, and unknown-namespace errors. It does not verify SSR, physical reconnection, a new development session, pending-request races, a time-zone matrix, latency, memory, or general bundle-size behavior.

The observations were made on 2026-10-11 (KST).

## Code

- Executed code: [lazy-production-browser-probe.mjs](../benchmarks/thin-layer/lazy-production-browser-probe.mjs) · [lazy-browser-app.jsx](../benchmarks/thin-layer/lazy-browser-app.jsx) · [ast-runtime.mjs](../benchmarks/thin-layer/ast-runtime.mjs) · [chrome-protocol.mjs](../benchmarks/thin-layer/chrome-protocol.mjs)
- There are two variants, `core` and `layer`. `core` uses `createI18n` from product `@0disoft/saylo-core/runtime`; `layer` uses `createLazyLayer` from benchmark-only [lazy-layer.mjs](../benchmarks/thin-layer/lazy-layer.mjs).
- Both variants use the same React UI template (`lazy-browser-app.jsx`). In production, public `virtual:saylo/lazy` creates a real static source. `connectDev` registers instance subscription and cleanup callbacks, but the static source's `connect` and manifest subscription are no-ops and do not open a development socket. `loadCatalog` dynamically imports catalog chunks.
- Each variant has an independent temp directory, Vite production build, static HTTP server, and Chromium user-data directory. Locales en, ru, and ja by namespaces demo and help produce six pairs, with baseLocale `en`, initialLocale `ru`, empty initialNamespaces (empty boot), and UTC.
- Builds disable minification and target `esnext`. Both variants emit seven JS chunks: one entry and six catalogs. The HTTP server serves the build's output unchanged and does not modify files.
- The environment uses Node v24.18.0, Vite 8.3.2, React 19.3.0, react-dom 19.3.0, i18next 26.4.3, and intl-messageformat 12.1.3; the browser is HeadlessChrome/154.0.0.0. CDP `Emulation.setTimezoneOverride` set the host time zone to Asia/Seoul.

## Observed results

Each variant has six stages, for 12 observations in total. `catalog` is the count of catalog-chunk Resource Timing entries through that stage; `cache` is the length returned by `catalogSource.getCatalogs()`.

| id | locale | catalog | cache | demo | help | Preserved |
| --- | --- | ---: | ---: | --- | --- | --- |
| cold | ru | 0 | 0 | unloaded | unloaded | true |
| load-demo | ru | 2 | 2 | ru Ada | unloaded | true |
| select-ja | ja | 3 | 3 | ja Ada | unloaded | true |
| load-help | ja | 5 | 5 | ja Ada | ja-help Ada | true |
| no-op-refresh | ja | 5 | 5 | ja Ada | ja-help Ada | true |
| unknown-namespace | ja | 5 | 5 | ja Ada | ja-help Ada | true |

- Server HTTP requests and browser Resource Timing entries both report catalog chunks as 0 → 2 → 3 → 5 → 5 → 5. The ru/help pair chunk exists in the build but is never requested.
- There are no `.json` or `@vite` requests. Every asset request returns 200 except the builtin favicon's 404.
- All six stages preserve input DOM identity and value `typed draft`, focus, caret positions 2 through 7, the open dialog, React counter `8`, `boots` 1, `errors` `[]`, and `diagnostics` `[]`.
- The retained snapshot from the initial demo load keeps `ru Ada` from select-ja onward. A demo translator captured at cold still throws `NamespaceNotLoadedError` later.
- While demo is loaded, the English fallback plural is `21 rows` and the UTC date is `1/1/2026 / 00:30`, both unchanged even though the host is Seoul.
- No-op refresh records `sameSnapshot: true`; the unknown namespace records `namespaceError: RangeError` and `keyError: UnknownMessageError` in the raw data.

## Parser marker

- Neither variant's emitted JS chunks contain the parser marker (`parserImplementationMarker: false`).
- Chunk `moduleIds` include both `@formatjs/icu-messageformat-parser/index.js` and `no-parser.js`. This is not a complete removal of the parser package or a full module-graph audit; it observes only the absence of the marker. No conclusion is drawn from helper or unused modules alone.

## Interpretation and limitations

- This verifies feature behavior and chunk load order. It is not evidence for latency, memory, general bundle-size behavior, SSR, a new development session, pending-request races, or the time-zone matrix.
- `layer` is a benchmark-only prototype and not a product entry path. The benchmark-only hand-written `lazy-layer.d.mts` declaration is not a product change.
- Product packages, public APIs, versions, and remote state are unchanged.

## Source data and reproduction

The source data is [thin-layer-lazy-production-browser-2026-10-11.json](../benchmarks/results/thin-layer-lazy-production-browser-2026-10-11.json). All 16 `codeHashes` in the raw result match the current source, and owned temp fixtures were cleaned up.

```sh
node benchmarks/thin-layer/lazy-production-browser-probe.mjs --out benchmarks/results/thin-layer-lazy-production-browser-2026-10-11.json
```

## Status

The probe, raw data, and package script are in local commit `225a0fa`, reusing the existing app template. They have not been pushed, and product package APIs, dependencies, and versions are unchanged. SSR, physical reconnection, a new development session, pending-request races, the time-zone matrix, latency, memory, and general bundle-size behavior are outside this probe's scope. Earlier SSR and development-socket observations remain in [66](66-thin-layer-ssr-production.md) and [68](68-thin-layer-lazy-browser.md).

## Follow-up: session replacement and late responses (`3a4251c`)

This covers the production browser lazy path. [71](71-thin-layer-lazy-session-browser.md) records holding and reordering product replies without byte changes in a real development server, locale supersession, and a new session plus replay of an old response after physically stopping and restarting the server on the same port. The six stages and determination above remain valid.
