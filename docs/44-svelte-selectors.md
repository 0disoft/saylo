# 44. Svelte selector subscriptions and current status

This record describes `selectSvelteStore` and `getI18nSelector` in `packages/svelte` and their implementation and publication status at this point. Contracts and usage follow [packages/svelte/README.md](../packages/svelte/README.md).

## Current implementation and publication status

- Secondary quarantine and build-time removal of the parser runtime (`astRuntime`): published in npm `0.1.0-alpha.2`.
- Svelte adapter: included starting with npm `0.1.0-alpha.2`.
- Vite `requireCompleteTranslations` (complete-translation check): published in npm `0.1.0-alpha.3`.
- React `useI18nSelector` and Svelte `selectSvelteStore`/`getI18nSelector` (fine-grained selector subscriptions): published in npm `0.1.0-alpha.4`. CI and registry-consumption verification follow the [release record](../releases/0.1.0-alpha.4.md).

Planned follow-up work includes fine-grained selector subscriptions in core, the Vue adapter, unused-message removal, and performance measurements and comparisons in other environments. Performance targets for the latest representative conditions follow [75](75-early-disk-rechecks.md).

## Svelte selector

`selectSvelteStore` creates a `Readable` containing only the values selected from the store, and `getI18nSelector` in `createSayloSvelte<S>()` passes the same selector through context.

- The signature is `selectSvelteStore<S, T>(source: SayloSvelteStore<S>, selector: (snapshot: SayloSvelteSnapshot<S>) => T, options?: SayloSelectorOptions): Readable<T>`.
- `createSayloSvelte<S>()` provides `getI18nSelector<T>(selector, options?: SayloSelectorOptions): Readable<T>`, which is called during initialization in the same factory context.
- `SayloSelectorOptions` has one member: `readonly onError?: (error: unknown) => void`.
- Results are compared with `Object.is`, and a value box `{ value }` forwards Svelte `derived` notifications. The same object reference and `NaN` suppress notifications, while `+0` and `-0` are delivered as different values.
- The source and shared context retain the existing single core subscription and final release; core subscriptions are zero after the SSR render completes.
- First subscription and resubscription deliver the latest value synchronously and retain snapshot-bound `t`, `setLocale`, and `loadNamespace`.
- The existing `createSvelteStore` and `getI18n` remain available.

The selector must be a pure calculation. If a selector captures props, changing only a prop does not trigger a source notification and therefore does not automatically reselect. If a selector returns a new object or array every time, `Object.is` sees a different value and a notification occurs for every snapshot. Dynamic component arguments are composed with the existing `$i18n` and Svelte `$derived`.

Selector exception handling differs by timing. If initial subscription or resubscription fails, the adapter releases the new subscription and synchronously rethrows the exact value thrown by the selector (including non-Error values and `undefined`); it does not call `onError` and does not substitute the previous successful value. If an active-subscription update fails, it keeps the last successful value, retries on the next snapshot without invalidation or notification, and reports through `onError` (`console.error('[saylo:svelte] selector failed', error)` when omitted). If `onError` itself throws, it reports through `console.error('[saylo:svelte] selector error reporter failed', reportingError)` and continues Svelte notifications. `options` is also included in the alpha.4 release.

## Validation record

The 195-test full `check` record in this section is historical, from the first implementation of the selector at `98bd3f7`, and is distinct from the follow-up exception-handling validation below.

The full `npm run check` passed with exit 0. It ran 195 tests (75 core, 14 React, 10 Svelte, 8 typegen, 83 Vite, and 5 release helpers). Svelte added four new unit tests and one SSR-compiled selector test, including one new selector hydration test among the three JSDOM client tests run by existing component tests.

The verified behavior was: zero notifications from unrelated active edits, while related title and language changes retained the latest value; shared sources maintained one core subscription and zero after shutdown and cleaned up after a dormant get and restart; value comparison with `Object.is` distinguished objects, functions, undefined, `NaN`, `+0`, and `-0`; composed Svelte `derived` values converged when locale and text changed together; SSR isolated requests and nested contexts and handled errors with zero subscriptions; and a compiled client selector kept the same hydration markup and preserved DOM, input, focus, cursor, dialog, and state. JS/checkJs/TS type contracts also passed.

I split selector type fixtures into the new `selector-consumer.ts` and `.js` files; after the split, `npm run typecheck:consumers --workspace=@0disoft/saylo-svelte` also passed with exit 0.

`npm exec -- node scripts/pack-smoke.mjs`, reusing the build, passed with exit 0. I installed the five newly created local tarballs in JS/checkJs/TS apps and checked `selectSvelteStore` and `getI18nSelector` type fixtures with imported declarations; the new compiled Svelte selector rendered `<h1>Packed Svelte</h1>` during SSR. React selector SSR and existing CLI, runtime/SSR, Vite lazy-build, parser-removal, and complete-translation checks also passed. `npm run verify:registry:alpha3` passed with exit 0 and checked integrity, external JS, TS, README, and compiled Svelte SSR for the five actually published `alpha.3` packages. In releases that do not have the selector API, a declared feature gate excludes the new fixture while preserving existing verification. Temporary apps and servers were cleaned up in the scripts' finally blocks.

No native-browser validation, version bump, push, or publish is scheduled.

### Follow-up validation of selector exception handling

The follow-up validation on 2026-10-10 PASSED 108 related tests (9 typegen, 85 Vite, 14 Svelte), typegen/Vite/Svelte consumer typechecks, and JSDOM hydration of the compiled Svelte client. I did not rerun the full `npm run check`, new benchmarks, native browsers, or registry verification in this work.
