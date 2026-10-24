# 39. Real SvelteKit app integration

## Scope

I implemented a local SSR, hydration, and page-navigation example for SvelteKit 3 in [examples/sveltekit](../examples/sveltekit/README.md). It does not add a new public package or Saylo API. Nothing was published to npm or deployed externally.

The example is a standalone `private` package and installs Saylo core, svelte, typegen, and vite as local `file:` dependencies. It copies contents with `install-links=true`, and I confirmed that the installed core, svelte, and vite are not workspace symlinks. The main project remains on TypeScript 7, while the example uses TypeScript 6 to match the peer requirements of SvelteKit and its checker. Third-party dependencies specify major-version ranges.

The validation environment on 2026-10-08 was Node 24.18.0, SvelteKit 3.0.1, Svelte 5.57.2, Vite 8.3.4, and adapter-node 6.0.0. The example uses `#lib` subpath imports, Vite's `sveltekit({ adapter })` configuration, and `$app/tsconfig`. This scope does not include SvelteKit 2 or other adapters.

## Requests and ownership

1. A server hook normalizes the URL query locale and stores it in per-request `locals`. A locale that is missing or invalid falls back to the base locale, and the HTML `lang` attribute is aligned with it.
2. `(saylo)/+layout.server.ts` prepares the request scope with `createRequestI18n`. It returns boot as a JSON string and disposes the prepared instance in `finally`. It reads the query directly so locale-query changes are also tracked during client navigation.
3. `(saylo)/+layout.svelte` decodes boot and creates a new instance. Server rendering and the first hydration use the same snapshot. Module scope contains only a typed context factory, with no global instance holding a user's locale.
4. `onMount` creates the development source from the request boot and the layout owns it. Every layout re-entry starts from a fresh boot so it does not pick up a stale manifest from the previous source. Production dynamically imports the generated static source.
5. The layout's instance and subscription persist between `/` and `/about`. Leaving to `/plain` releases the connection, owned source, and instance. A delayed connection that completes after release does not reconnect. Re-entering creates a new instance and form.

The source proxy initially reads the prepared boot scope and uses the browser source after mount. It does not run the WebSocket source during SSR. It leaves the Vite socket shared by development sources open and cleans up only the listeners it registered. The UI uses `t` from the snapshot.

## Validation

| Check | Result |
| --- | --- |
| Svelte typecheck | 0 errors and 0 warnings across the example's TypeScript, templates, and Vite config |
| Build | Client and SSR builds succeeded, and adapter-node output was generated |
| External tarball app | Installed all five packages outside the repository and confirmed no symlinks, installation paths inside the temporary app, and matching versions. Type diagnostics reported 0 errors and 0 warnings; client/SSR builds, development-connection lifetime, and production HTTP checks passed |
| Tarball production browser | In HeadlessChrome 154, hydration, ko/en/ko switching, preservation of shared-layout input and an open modal, and layout exit/re-entry passed. No reported runtime errors or warnings |
| Development HTTP | Four concurrent ko/en requests, matching SSR language, boot, UTC, and namespace, normalization of `EN`, and fallback to base for malformed or unregistered locales |
| Production HTTP | The same SSR and boot checks passed against the actual `node build/index.js` |
| Connection lifetime | With the actual client connection function and hot context, listeners were registered and then reduced to zero after shutdown; duplicate stop and cancellation of a delayed connection when stopped before attach were also verified |
| Development browser | After English boot hydration, name, request text, modal note, and the open window were preserved during navigation to `/about` |
| Valid copy save | The about title and dialog title updated while input, the open window, focus, and cursor position 8 were preserved |
| Errors and recovery | Invalid JSON retained the previous valid translation and revision and showed diagnostics. After restoration, valid translation resumed and diagnostics cleared |
| Language switching | URL query, HTML lang, and copy switched to ko while input was preserved |
| Exit and re-entry | The translated layout was removed at `/plain`. ko copy edited while away was reflected in the fresh SSR boot when returning, and later saves were live again |
| Production browser | English hydration, switch to ko, and preservation of input after page navigation. No browser console errors or warnings in the inspection |

I restored validation en/ko copy and the malformed JSON. I did not use HMR reloads caused by changing route structure or components during implementation as evidence of catalog-state preservation. I did not run builds concurrently during catalog validation.

The example was verified through a local Node production build. External hosting and performance p95 measurements were not performed.

## Run

```sh
npm run setup:sveltekit
npm run dev:sveltekit
npm run build:sveltekit
npm run verify:sveltekit
npm run verify:pack:sveltekit
npm run verify:registry:sveltekit
```

The development port is 5191 and the preview port is 5192. `verify:sveltekit` starts its own temporary development server and shuts it down in `finally`. A running Node build can also be checked over HTTP with `npm --prefix examples/sveltekit run verify:ssr -- http://127.0.0.1:5192`.

`verify:pack:sveltekit` runs in a temporary app where the existing local `file:` directory dependencies are replaced by tarballs. Third-party tools and peers use the example's major ranges. A browser probe is injected only into the temporary app, and the browser, server, and temporary directory are cleaned up after the check. It discovers Chrome and Edge automatically and also accepts `--browser <executable>`. This is a manual check command and does not change the number of existing CI or release validations. The source is in [pack-sveltekit.mjs](../scripts/pack-sveltekit.mjs).

## References

On 2026-10-09, `npm run verify:registry:sveltekit` checked the five approved files for actual npm `alpha.2`. Downloaded files matched the SHA-512 values in the [CI manifest](../releases/0.1.0-alpha.2.json). Installing them in a temporary app passed type diagnostics with 0 errors and 0 warnings, client/SSR builds, development-connection lifetime, production HTTP, and HeadlessChrome 154 hydration, ko/en/ko switching, shared-layout input/modal preservation, and exit/re-entry. There were no runtime errors or warnings, and temporary resources were cleaned up. The app source and harness reuse the earlier example but use registry tarballs instead of local directory dependencies.

- [SvelteKit 3 migration guide](https://svelte.dev/docs/kit/migrating-to-sveltekit-3)
- [Server state and context](https://svelte.dev/docs/kit/state-management)
- [load and navigation reruns](https://svelte.dev/docs/kit/load)
