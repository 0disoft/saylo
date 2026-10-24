# 38. Svelte adapter

## Implementation scope

I implemented `@0disoft/saylo-svelte` locally. It accepts Svelte 5 as a peer, provides ESM JavaScript and `.d.ts` files, and has not yet been published to npm or registered as a new package with Trusted Publisher. Existing publication records for the other four packages remain unchanged.

- `createSvelteStore(instance)` connects an eager store or a lazy `createI18n` instance to a Svelte readable.
- `createSayloSvelte<AppSchema>()` creates `setSayloContext(instance)` and `getI18n()` functions that share one context. They are called during component initialization, and the parent instance remains stable for the duration of the mount.
- Components use `$i18n.t`. `t` is bound to the current snapshot, and older snapshots keep their older translations. The adapter exposes key and argument types plus `setLocale` and optional `loadNamespace`.
- The first value is delivered synchronously. The adapter shares one core subscription while it has subscribers. When the last subscription ends or the caller disposes the instance, it releases the subscriptions and disposal listener it registered. Disposing the instance remains the caller's responsibility.
- Create a separate instance for each SSR request. A context factory can be shared. The initial core boot for hydration must match the server, and the development connection starts after mount.

The [package README](../packages/svelte/README.md) and [demo README](../examples/svelte/README.md) describe the current API and execution. The adapter uses Vite 8 and `@sveltejs/vite-plugin-svelte` 7 and supports Svelte 5. This scope does not include SvelteKit-specific server-route examples, server-global instances, or replacing an instance during mount.

## Validation

I performed the local build and adapter validation on 2026-10-08 under Node 24.18.0, Svelte 5.57.2, Vite 8.3.2, and TypeScript 7.

| Check | What was verified |
| --- | --- |
| Adapter tests | Synchronous first value, shared subscription, last-subscriber and disposal cleanup, updates while there are no subscribers, snapshot translation, and forwarding of asynchronous methods |
| Compiled Svelte component | DOM, input value, focus, cursor, dialog, and state preservation after catalog/locale changes, plus subscription release after unmount |
| SSR and hydration | Per-request and nested-context isolation, errors from using a different factory, SSR subscription release, reuse of matching markup, and subsequent translation updates |
| JS/TS consumption | Typecheck rejection of invalid keys and arguments, invalid union calls, and another schema context |
| External tarball | Installation of all five packages outside the repository to check JS checkJs and TS consumption, execution of the Svelte README, and compiled Svelte SSR |
| Production demo | Type generation, `.ts` bridge checks, and Svelte component build. English lazy chunks remain |
| Actual browser | Input, modal, focus, and cursor preserved after saving valid copy; locale-file addition, selection, deletion, and return to the baseline language |

During browser validation, Vite reloaded the page in the first attempt because I ran a package build concurrently and it changed workspace `dist`; I excluded that attempt as evidence of state preservation. After the build finished, I changed only catalogs, and the name, request text, and modal note stayed intact while the modal remained open with focus and cursor position 7 preserved. I added a temporary `fr` catalog as an English copy, selected and deleted it, and removed it afterward. I also restored the copy.

This validation does not include TypeScript diagnostics across the entire template or an actual SvelteKit deployment. I also did not measure new performance p95 targets.

During the integrated check, a `rename` in an existing Vite typegen test that replaces a temporary declaration file failed twice with Windows `EPERM`. The isolated test passed, but the failure also occurred on an integrated rerun, so I improved the writer. It retries only Windows `EPERM`, `EACCES`, and `EBUSY` up to five times with a total wait of at most 620 ms, and cancels before the next replacement if there is a new generation or interruption. If failures persist, it propagates the original error and cleans up the temporary file through the existing writer's `finally`. It does not delete the existing declaration file first. Separate tests cover retries, cancellation, limits, and non-Windows errors.

After that change, the full `npm run check` passed with exit 0. The final tarball validation under Node 24.18.0 also passed external JS/TS consumption of all five packages, README execution, and Svelte SSR, and I stored the validated tarballs and manifest in `.release/npm/`. I stopped the temporary development server.

## Release integration

`scripts/release-check.mjs` uses `packageIds` from its shared list so local pack, publication planning, and OIDC validation target all five packages. `verify:registry` checks only packages recorded in an existing release manifest, so the unpublished Svelte package is not mixed into publication verification for the existing four.

The current version is `0.1.0-alpha.1`, the same as the existing workspace, and it was not promoted automatically. The publication step must pass byte-equality checks for already published versions and Trusted Publisher setup for the new package. Existing-package tarballs built from current source may differ from published alpha.1, so version selection and registry registration for the next release are separate work.

## References

- [Svelte store contract](https://svelte.dev/docs/svelte/stores#Store-contract)
- [Svelte context](https://svelte.dev/docs/svelte/context)
