# 43. React selector subscriptions and current status

This record describes `useI18nSelector` in `packages/react` and its implementation and publication status at this point. Contracts and usage follow [packages/react/README.md](../packages/react/README.md).

## Current implementation and publication status

- Secondary quarantine and build-time removal of the parser runtime (`astRuntime`): published in npm `0.1.0-alpha.2`.
- Svelte adapter: included starting with npm `0.1.0-alpha.2`.
- Vite `requireCompleteTranslations` (complete-translation check): published in npm `0.1.0-alpha.3`.
- React `useI18nSelector` (fine-grained selector subscription): published in npm `0.1.0-alpha.4`. CI and registry-consumption verification follow the [release record](../releases/0.1.0-alpha.4.md).
- Svelte `selectSvelteStore` and `getI18nSelector` (fine-grained selector subscription): published in npm `0.1.0-alpha.4`. The contract is described in [44-svelte-selectors.md](44-svelte-selectors.md).

Planned follow-up work includes fine-grained selector subscriptions in core and performance measurements and comparisons in other environments. The Vue adapter and unused-message removal have been implemented; Vue remains `private` and unpublished. Overall current status and remaining items follow [81-implementation-status.md](81-implementation-status.md). Performance targets for the latest representative conditions follow [75](75-early-disk-rechecks.md).

## React selector

In addition to `useI18n`, `createSayloReact<S>()` provides `useI18nSelector`. The selector receives that render's `SayloReactSnapshot<S>` and extracts only the values it needs.

- The signature is `useI18nSelector<T>(selector: (snapshot: SayloReactSnapshot<S>) => T): T`.
- Internally it subscribes to the selected result through `useSyncExternalStore`. Repeated reads with the same instance, selector, and raw snapshot cache the selector result, so a selector that returns a new object does not enter a repeated-read loop.
- Results are compared with `Object.is`. When the selected value or reference is equal by `Object.is`, the hook skips renders caused by store updates. Renders caused by parent or local state changes still occur.
- The hook retains snapshot-bound `t`, `setLocale`, and optional `loadNamespace` as before and uses `getServerSnapshot` during SSR.
- The existing `useI18n` remains available.

The selector may run again for every snapshot and may capture props or state from the render. It should compute values without side effects and must not depend on mutable global values that are not subscribed to. Returning the same unchanged object reference avoids rerenders; creating a new object or array every time causes a rerender whenever the snapshot changes.

## Validation record

The full `npm run check` passed with exit 0. It ran 190 tests (75 core, 14 React, 5 Svelte, 8 typegen, 83 Vite, and 5 release helpers), including five new React checks. JSDOM ReactDOM verified DOM, input, state, focus, cursor, and modal preservation, subscription release, store replacement, prop changes, `NaN` and signed zero, provider errors, and SSR boot to client early-release hydration. The JS/checkJs and TS consumer fixtures also passed checks that reject missing selector arguments, wrong types, and nonexistent keys, and verified return-type inference. `npm exec -- node scripts/pack-smoke.mjs`, reusing the build, passed with exit 0; external JS and TS apps installed the tarballs and verified the new selector SSR with `renderToString` returning `<p>Hello Selector</p>`. Existing README, CLI, runtime/React/Svelte SSR, Vite lazy-build, parser-removal, and complete-translation fixture checks also passed. I did not run a real native browser in this work. No version bump, push, or publish was performed.
