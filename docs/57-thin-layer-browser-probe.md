# 57. Thin-layer browser probe

This document records the browser feature smoke test in `benchmarks/thin-layer`. It checked whether edit, error recovery, locale addition, selection, and removal flows work and whether input and DOM state is preserved with an eager full-registry connection in a real Vite 8 development server, React 19, and headless Chrome 154. It verifies feature behavior only; it does not assess performance, memory, bundles, SSR, hydration, time zones, lazy loading, reconnection, or sessions.

The observations were made on 2026-10-11 (KST).

## Experiment scope

- Executed code: [browser-smoke.mjs](../benchmarks/thin-layer/browser-smoke.mjs) · [browser-app.jsx](../benchmarks/thin-layer/browser-app.jsx) · [catalog-layer.mjs](../benchmarks/thin-layer/catalog-layer.mjs)
- The harness starts a Vite development server with the real `@0disoft/saylo-vite` plugin in a temporary fixture and connects headless Chrome, exchanging commands, acknowledgements, and traces through the `/__thin` middleware.
- `browser-app.jsx` receives `baseLocale`, `initialCatalogs`, and `initialLocale` from `virtual:saylo`, creates the AST thin layer from `catalog-layer.mjs`, and reuses Saylo's eager transport, parser, and schema. The connection therefore receives the full registry eagerly.
- Subscriptions use a serial test-only bridge built on React `useSyncExternalStore`; it is not a product loader or session implementation. The browser app profile is excluded from the watcher target.
- Scenarios are separated by 150 ms.
- The dependencies are i18next 26.4.3, i18next-icu 2.5.0, intl-messageformat 12.1.3, Vite 8.3.2, and React 19.3.0. The browser is HeadlessChrome/154.0.0.0.

## Observed results

`npm --prefix benchmarks/thin-layer run browser` exits 0 and records eight observations. All ten `codeHashes` values matched the current source files.

| id | Displayed message | locale | locales | Diagnostics |
| --- | --- | --- | --- | ---: |
| edit | Updated Ada | fr | en, fr | 0 |
| invalid-json | Updated Ada | fr | en, fr | 1 |
| recover-json | Recovered Ada | fr | en, fr | 1 |
| invalid-schema | Recovered Ada | fr | en, fr | 2 |
| recover-schema | Ready Ada | fr | en, fr | 2 |
| locale-add | Ready Ada | fr | en, fr, ja | 2 |
| locale-select | こんにちは Ada | ja | en, fr, ja | 2 |
| locale-remove-selected | Hello Ada | en | en, fr | 2 |

All eight observations have `preserved: true`; the previous snapshot message is `Bonjour Ada`. In `invalid-json`, the last good message (`Updated Ada`) remains while one diagnostic is recorded, and `recover-json` commits `Recovered Ada`. `invalid-schema` likewise keeps the previous snapshot, and `Ready Ada` appears after `recover-schema`.

### Acknowledgement checks

Every acknowledgement preserved the `input` DOM identity, its value (`typed draft`), focus, the open `dialog`, counter value `8`, and the previous snapshot `Bonjour Ada`. `fallbackPlural` is `0 rows` in every observation, distinguishing the English base plural at count 0 from formatting in the selected locale (fr). After `locale-remove-selected`, the display returns to `Hello Ada`, falling back to the source locale when the selected locale no longer exists. The diagnostics are `fr/demo.json: Invalid JSON: Expected property name or '}' in JSON at position 1 (line 1 column 2)` for the invalid JSON case and `fr/demo.json [greeting]: Translation introduces argument "unexpected" absent from the base message.` for the schema error.

## Initial connection error

An early rerun could not pass the browser connection stage because of a fetch error. After the harness added the public runtime entry (`@0disoft/saylo-core/runtime`) and `@0disoft/saylo-vite/client` to the prebundle targets and `catalog-layer.mjs` was corrected to use public specifiers, the smoke test passed twice in succession with the final source. No product package code or dependencies changed.

## Interpretation and limitations

- This is an eager full-registry connection. Lazy loading, reconnection, session protocols, production builds, SSR and hydration, time zones, memory, and performance comparisons were not checked.
- The first attempt ran without gaps between scenarios and timed out during invalid JSON recovery. All eight cases passed after excluding the browser app profile from the watcher target and adding 150 ms gaps; the cause was not established.
- A defect remains in gap-free consecutive failure and recovery. In a separate real Vite SSR source and watcher experiment (gaps 0/60/0 ms), a valid save immediately after an invalid-JSON diagnostic did not recover in either gap-0 run: it saw one watcher change, `Initial`, and revision 0. Only the gap-60 run (actual 86.17 ms) recovered with two changes, `Recovered`, and revision 1 ([source data](../benchmarks/results/rapid-recovery-2026-10-11.json)). The issue reproduces without a browser or i18next, so it appears to be in watcher event handling. The installed Vite bundle throttles change events by 50 ms, but no control run disabled that throttle, so exact causality is not established.
- This smoke test alone does not determine whether an independent runtime is necessary or complete the thin-layer assessment.

## Source data and reproduction

The source data is [thin-layer-browser-2026-10-11.json](../benchmarks/results/thin-layer-browser-2026-10-11.json). The gap-free recovery reproduction is [rapid-recovery-2026-10-11.json](../benchmarks/results/rapid-recovery-2026-10-11.json).

```sh
npm --prefix benchmarks/thin-layer install --ignore-scripts
npm --prefix benchmarks/thin-layer run browser
node benchmarks/thin-layer/rapid-recovery.mjs
```

## Status

The browser smoke test and code split are in local commits `f3dd7a1`, `568232f`, and `57261fb` and have not been pushed. No product package API, dependency, or version changed, and nothing was published or deployed. The gap-free recovery defect was recorded without a product fix.

## Follow-up fix

`463083e` (2026-10-11) addressed the gap-free recovery defect. A trailing disk recheck that checks metadata again 60 ms after the first publish made all five fresh Vite SSR cases (`JSON 0/60/0`, `schema 0`, and `valid→valid 0`) report `recovered: true`; the `--gap-ms 0` browser smoke test also continues to pass all eight scenarios. This resolves the earlier statement that a defect remained in gap-free consecutive failure and recovery. The paragraph above is retained as the observation at that point in time; see [58](58-trailing-disk-rechecks.md) for the change, its cost, and its limitations.
