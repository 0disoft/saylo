# 66. Thin-layer SSR and production hydration

## Scope

This records validation of a real production browser and SSR hydration after [65](65-thin-layer-ast-production.md). It is benchmark-only; product source, public APIs, and versions did not change. Current coverage includes SSR hydration of a real production client and a tested CDP host-time-zone matrix (12 cases, including a missing pair).

Lazy loading, sessions, reconnection, memory, large scale, the full contract, performance, and the release are not covered, nor is every browser and OS combination.

## Code

- `hydration-layer.mjs` validates boot data with the public core `decodeBootSnapshot`, then builds an i18next layer on top of it.
- The hydration barrier attached through React `useSyncExternalStore` is implemented specifically for this experiment. It is not an i18next feature.
- The barrier initially binds to the boot snapshot. Early replacements remain queued with zero notifications; `finishHydration` publishes only the latest state once and is idempotent on repeat calls. Replacements after hydration publish normally, and dispose clears listeners and rejects later updates and subscriptions.
- `ssr-fixture.mjs` uses core `parseCatalog`, `createBootSnapshot`, and `serializeBootSnapshot`. The wire contains `</script><script>`, U+2028, and U+2029 strings; server literals are made HTML-safe and boot and pending payloads are escaped through encoding.
- `ssr-view.mjs` shares the same React components between server and client.

## Initial validation (`49c21e2`, 3 cases)

- All five hydration unit tests pass: rejecting a malformed wire, schema mismatch, and time-zone conflict; releasing once after an early replace; preventing an invalid queued translation from overwriting the last valid candidate; isolated barriers and time zones for concurrent requests; and cleanup and rejection after dispose.
- After rendering three concurrent React SSR requests in Node (ru/UTC, en/Asia/Seoul, and ru/America/Los_Angeles), one Vite production build was hydrated in real headless Chromium.
- All three requests pass. Initial SSR node identity and title match boot, with zero recoverable errors.
- Middle and Latest are queued before hydration with zero notifications while the barrier is active. The button count of 1 and open dialog work during the barrier; after finish, only Latest produces one notification, and a second finish also produces one. A post-hydration replacement produces notification 2.
- The input draft, focus, caret position 3, and the identity of the h1, input, and dialog are preserved, along with component counter 1 and the open dialog. The old bound `t` retains its server string.
- Boot's time zone matches, and the fallback source plural is `0 rows`. There are no injection flags.
- In these three initial cases, the browser host was fixed to Asia/Seoul and the three time zones were explicit settings. The host matrix is covered below.
- The production client asset has a false parser marker. Its 718297 unminified and 146136 gzip bytes include React, DOM, and bootstrap validation, so they are not comparable with translator-only small-fixture size.
- React reads its mode from process, so `process.env.NODE_ENV` was explicitly defined as production. The initial harness failure came from the missing define, not a product defect.

## Costs and remaining goals

- The custom layer and barrier are private experiment code and must be maintained. They are not built-in i18next features.
- Boot carries both loaded pair data and the full manifest list. Retention of declared locales is verified, but manifest refresh, empty-load scope, and namespace contracts remain incomplete.
- Remaining goals are lazy loading, sessions, reconnection, memory, large scale, the full contract, performance, and the release. Product source is unchanged, so the full root check was not run.
- The [raw results](../benchmarks/results/thin-layer-ssr-production-2026-10-11.json) contain the three requests and production-client details.

## Reproduction

```sh
npm --prefix benchmarks/thin-layer run test:hydration
node benchmarks/thin-layer/ssr-production-probe.mjs --out benchmarks/results/thin-layer-ssr-production-2026-10-11.json
```

## Browser host-time-zone matrix (`e208980`)

- `chrome-protocol.mjs` reads only `DevToolsActivePort` from its owned headless profile and connects locally. It does not alter another browser or the OS time zone.
- After checking `/json/protocol` for `Target.createTarget`, `Target.attachToTarget`, `Emulation.setTimezoneOverride`, and `Page.navigate`, it overrides the target session's time zone and navigates the page.
- `--host-matrix` builds one production asset, prerenders nine Node SSR responses, and visits nine pages through CDP: host UTC, Asia/Seoul, and America/Los_Angeles crossed with config UTC (ru), Asia/Seoul (en), and America/Los_Angeles (ru).
- The browser reports the actual `Intl` host values, and the HTTP server verifies them against expectations. The Node SSR time zone is a config value independent of the host. Snapshots follow the configured time zone, while fallback dates vary by config rather than host: `1/1/2026 / 00:30`, `09:30`, and `12/31/2025 / 16:30`.
- All nine pages have zero recoverable errors and preserve input focus, caret, h1/input/dialog identity, count, and dialog state. Notifications follow early 0 → release 1 → Post 2.
- The old `t` retains the server's unsafe literal string, and there are no injection flags.
- Raising the plural argument to 21 makes both server and client exercise English `other` (`21 rows`), distinguishing locale and source selection more clearly than the `0 rows` in v1.
- The production asset has a false parser marker and is 718532 bytes unminified and 146191 gzip. These values come from a new file and must not be combined with the v1 figures above.
- Coverage extends to a real Chromium host-time-zone matrix using emulation. It does not cover every browser and OS combination, lazy loading, sessions, reconnection, the full contract, performance, memory, or the release.

### v1 record and current source

- The v1 raw result above (`thin-layer-ssr-production-2026-10-11.json`, `49c21e2`) remains unchanged with format v1, three cases, and plural `0 rows`.
- Current source uses format v2 with plural 21. The default three-case mode remains, but rerunning it now produces v2 rather than the v1 raw result. Reproducing v1 requires the source at `49c21e2`.
- Reproduce with `node benchmarks/thin-layer/ssr-production-probe.mjs --host-matrix --out benchmarks/results/thin-layer-ssr-production-host-matrix-2026-10-11.json`. [Raw results](../benchmarks/results/thin-layer-ssr-production-host-matrix-2026-10-11.json).

## Missing-pair bug fix (`9312a2a`)

- The observed bug occurred when the boot locale was ru and the manifest availableLocales were en and ru, but the ru/demo outcome was missing. The restored layer changed to locale en and availableLocales en only.
- When `catalog-layer` receives `options.availableLocales`, it validates canonical names, uniqueness, and inclusion of the base locale, and rejects a loaded catalog locale outside the declaration. `snapshot.availableLocales` uses the declared list and preserves the selected locale even when its target is unloaded. The hydration layer and the SSR server constructor both pass the boot manifest list.
- An ordinary eager factory without options keeps the existing derived-list behavior.
- The unit tests pass 11 cases: 6 hydration plus 5 timezone. The added case is "explicit missing target pairs preserve the selected boot locale and manifest availability".
- Adding `--missing-target` to the host matrix produced 12 pages. The base en/demo is present and the target ru/demo is missing; real ru/help and en/help catalogs were added under other namespaces to justify ru availability. Boot's loadedNamespaces is demo and the help catalog is not in boot.
- While Middle and Latest are queued before hydration, the real ru/demo arrives and the help resource also arrives through an eager update. The locale is ru with an English greeting fallback until release; after release, Latest publishes in ru. The retained old binding stays in English.
- The 12 pages are three CDP hosts times (three standard configs plus the missing-ru UTC config), and all pass. They retain zero errors, preserved state, and the source plural distinction `21 rows`.
- The production asset has a false parser marker. [Raw results](../benchmarks/results/thin-layer-ssr-production-missing-pair-fix-2026-10-11.json).
- Remaining limitations are that the snapshot API has no fresh-manifest refresh and lacks handling for an empty loaded boot and full namespace semantics. These are lazy/full-contract items; this does not claim every manifest case is covered.
- The earlier 3-page v1 (`49c21e2`) and 9-page v2 (`e208980`) raw results are retained. Differences in metadata and runtime harness mean they cannot be reproduced byte-for-byte into the same file.
- Reproduce with `node benchmarks/thin-layer/ssr-production-probe.mjs --host-matrix --missing-target --out benchmarks/results/thin-layer-ssr-production-missing-pair-fix-2026-10-11.json`.
- `b809e08` replaced the hardcoded case count in metadata with observed values. The current file records `caseCount` 12 and `missingTargetCases` 3, and reruns pass all the same 12 cases. The code fingerprint was updated as well.

## Follow-up (`c8f883e`, `4623203`)

Empty boot handling, namespace scope, and the independent lazy coordinator are covered next in [67](67-thin-layer-lazy-contracts.md). The 12-case SSR and hydration results and determination above remain valid.
