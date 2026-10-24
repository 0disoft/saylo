# 69. Thin-layer typegen consumer contracts

## Scope

This records validation after [68](68-thin-layer-lazy-browser.md) of a benchmark-only hand-written `.d.mts` facade, real TypeScript and checkJs consumers, and typegen worker and watch updates in a real Vite development server. It is benchmark-only; product packages, public APIs, dependencies, versions, and remote state are unchanged.

It verifies reuse of public types in a hand-written declaration, nine stages of strict type checking, an any-return control showing that `@ts-expect-error` catches bad calls, and watch updates from the development server's typegen worker. It does not verify browser editor or LSP type services, automatic browser type updates, typegen for native i18next alone, checkJs on the implementation source itself, performance and memory, full API equivalence, or async and sync parity.

The observations were made on 2026-10-11 (KST) with Node v24.18.0 and TypeScript 7.0.2.

## Code

- Executed code: [typegen-probe.mjs](../benchmarks/thin-layer/typegen-probe.mjs) · [type-consumer.ts](../benchmarks/thin-layer/type-consumer.ts) · [type-consumer-js.js](../benchmarks/thin-layer/type-consumer-js.js) · [lazy-layer.d.mts](../benchmarks/thin-layer/lazy-layer.d.mts)
- [lazy-layer.d.mts](../benchmarks/thin-layer/lazy-layer.d.mts) is a private hand-written experimental declaration. It imports `I18n`, `Schema`, `CreateI18nOptions`, and `BootSnapshot` directly from public `@0disoft/saylo-core/runtime`; `LazyLayer<S>` extends `I18n<S>`, and `createLazyLayer` returns `Promise<LazyLayer<S>>`.
- Options are either public `CreateI18nOptions` unchanged or that type with `initialSnapshot` changed from a `BootSnapshot` object to a string. The public core constructor is synchronous and accepts a `BootSnapshot`; this experiment is asynchronous and accepts both object boot data and serialized JSON boot strings.
- There are two consumers: TypeScript (`type-consumer.ts`) and checkJs (`type-consumer-js.js`). `tsconfig` enables `strict`, `checkJs`, `allowJs`, `skipLibCheck: false`, and `types: ['node','vite/client']`. React, Svelte, and `connectDev` are checked only for structural type compatibility; no runtime compatibility execution is performed.
- The probe receives the public `virtual:saylo/server` live `catalogSource` from a real Vite development server through `ssrLoadModule`. It is not a browser, and each stage explicitly calls `instance.refresh()` on both runtimes.
- The base schema is `AppSchema` generated in `generated.d.ts` by that typegen worker. Core (`createI18n`) and layer (`createLazyLayer`) use the same `AppSchema`.

## Observed results

The consumer set was compiled nine times, with both runtimes' `instance.refresh()` results observed at each stage. Compiler status was 0 at all nine stages, and core and layer produced the same values.

| Stage | compiler | `.d.ts` sha | Runtime |
| --- | ---: | --- | --- |
| startup | 0 | 3e58f77b | core and layer match |
| translation-text-only | 0 | 3e58f77b (same) | ja greeting updated |
| base-text-only | 0 | 3e58f77b (same) | en plain message updated |
| invalid-base-last-good | 0 | 3e58f77b (same) | Previous good value retained |
| recover-and-add-key | 0 | 0b5b8078 | New key added |
| add-required-argument | 0 | 5b4a4199 | role added to greeting |
| remove-key | 0 | 31fc248d | added key removed |
| add-namespace | 0 | 1d8c0a10 | late namespace added |
| remove-namespace | 0 | 31fc248d | late namespace removed |

- For translation-text-only, base-text-only, and invalid-base-last-good, `.d.ts` sha and mtime are identical to startup. The generated file's bytes did not change at the observation point.
- recover-and-add-key adds a key and a required argument, changing the sha. add-required-argument adds `role` to base `demo:greeting`, requiring `{name, role}`. Even when the Japanese translation omits role, both types and runtime require it, and omission causes `InvalidArgumentError`.
- After remove-key or remove-namespace, the runtime throws `UnknownMessageError` for the removed key or namespace and the item disappears from the generated schema. add-namespace shows `late:status` entering the generated schema.
- A reference holding `getSnapshot()` from before a change retains that earlier value, and removed entries remain readable from the previous snapshot.
- Setting the control declaration `loose.d.mts` to return `any` exits 1 as expected. Its output includes 17 unused `@ts-expect-error` errors (`TS2578`) and 2 failed `IsAny` assignments, confirming that consumer checks catch types collapsing to `any`.
- The contracts verified with both valid and invalid calls are required arguments, numeric plural counts, rejection of date strings, required arguments in select branches, mixed-union reduction, dotted literal keys, reserved `lng` and `ns`, `__proto__` keys, union-key narrowing, readonly snapshots, preservation of subscriber snapshot arguments, unknown keys, and extra arguments.
- When restoring boot data, core receives a boot object and layer receives a `JSON.stringify(boot)` string. Both variants have equal data according to `JSON.parse(JSON.stringify(...))` (`serializedDataEqual: true`), with greeting `JA-updated Ada` and `InvalidArgumentError` when role is missing. This compares serialized JSON, not prototype-chain identity.

## Interpretation and limitations

- Generated declarations and runtime passed within this observation scope. This is not a completion determination for the overall product goal, and the limitations below remain.
- Validation covers a hand-written declaration, compilation with real TypeScript and checkJs consumers, and selected runtime checks. It does not check the implementation source itself with checkJs.
- Typegen for native i18next alone, browser editor or LSP type services, automatic browser type updates, performance and memory, full API equivalence, and async-sync parity were not verified.
- `layer` is a benchmark-only prototype and not a product entry path.
- Product packages, public APIs, dependencies, versions, and remote state are unchanged.

## Source data and reproduction

The source data is [thin-layer-typegen-2026-10-11.json](../benchmarks/results/thin-layer-typegen-2026-10-11.json). All 16 `codeHashes` in the raw result match the current source, and temp files were cleaned up inside the owned directory.

```sh
node benchmarks/thin-layer/typegen-probe.mjs --out benchmarks/results/thin-layer-typegen-2026-10-11.json
```

## Status

The typegen code and raw results are in local commit `26e9df0` and have not been pushed. No product package or version changed, and nothing was published or deployed.

## Follow-up: lazy production browser (`225a0fa`)

The 12-stage record of lazy partial loading in two real Vite HTML production builds is in [70-thin-layer-lazy-production-browser.md](70-thin-layer-lazy-production-browser.md).
