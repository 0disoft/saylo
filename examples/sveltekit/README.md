# SvelteKit 3 example

An independent `private` example that prepares Saylo translations for SSR on each request and initializes the browser with the same boot snapshot. It installs local Saylo packages as `file:` dependencies. `install-links=true` in `.npmrc` copies package contents, so the example does not depend on workspace links or another Svelte runtime. It is not an example that uses a new Svelte adapter published to npm.

## Run

Node 24.x and npm are required. Run from the repository root.

```sh
npm run setup:sveltekit
npm run dev:sveltekit
```

The development address is `http://127.0.0.1:5191/?locale=en`. `?locale=ko` is Korean, and an invalid or unsupported locale falls through to the next input source. The request locale is chosen in this order: URL query, the `saylo-locale` cookie, `Accept-Language`, then the manifest base locale. If you changed Saylo package source, run `setup:sveltekit` again to update the build and the example's copied installation.

The example only reads the cookie. To remember a language with a cookie, the app must set the `saylo-locale` value itself. An explicitly specified supported locale in the query or cookie takes precedence over `q=0` exclusions in `Accept-Language`. If neither is present or usable, it uses the header resolution result, and if the header also cannot choose, it returns to the manifest base locale.

The example uses SvelteKit 3, Svelte 5, Vite 8, adapter-node 6, TypeScript 6, and svelte-check 4. To match the current peer conditions of SvelteKit and the checker, only the example uses TypeScript 6; Saylo itself remains on TypeScript 7. It follows the [official SvelteKit 3 migration guide](https://svelte.dev/docs/kit/migrating-to-sveltekit-3).

## SSR and hydration

- `hooks.server.ts` resolves the locale in the order query, cookie, `Accept-Language`, then the manifest base value, and stores it in that request's `locals`. It also sets the HTML `lang` from this value.
- `(saylo)/+layout.server.ts` prepares translations with `createRequestI18n` from `virtual:saylo/server`. It returns boot as a JSON string and disposes the prepared instance in `finally`. The response uses `no-store`. The load reads the query locale directly so a query change during page navigation is processed again.
- `(saylo)/+layout.svelte` creates a new instance from boot and passes it through context. The server and first browser render use the same locale, catalogs, and time zone. Shared modules contain only the context factory.
- In `onMount`, development mode creates a new `createDevCatalogSource` from that request's boot. The layout owns and disposes this source. In production mode, it dynamically imports `virtual:saylo/lazy` and attaches the generated static source. It does not run browser-only sources during SSR. The first snapshot is fixed from boot before connection, and the latest manifest is refreshed after connection.
- Layout teardown cleans up the development connection and instance. If a lazy import finishes after cleanup, it does not create a new connection.

Following the official [server state and context guidance](https://svelte.dev/docs/kit/state-management), it does not share the user locale in a server-global instance.

## Rich text preview

The `demo:rich` message is turned into parts with `snapshot.tParts('demo:rich', { name })` and rendered by `@0disoft/saylo-svelte/RichText.svelte`. Part tags are matched against renderer names supplied by the app, and the example provides two snippets, `strong` and `link`. `link` is an anchor with `href="#order-form"` that points to the form, so the app decides the link address and the catalog decides only the text and tags.

The name is owned by the `(saylo)` layout. The layout passes it to `Workbench` with `bind:name`, and `projectDemoMessages(snapshot, previous, name || 'Saylo')` computes the title, body, form, and rich parts together. The entered name therefore changes both the form value and the `{name}` slot in the rich message. The `{name}` argument enters as text only, so the entered name is not parsed as a tag. SSR and initial hydration have an empty name, so both produce the same `Saylo` output.

If a translation cannot be displayed, it recomputes with the current name on the last good snapshot and keeps only snapshots without errors as the next baseline. Saving a mismatched marker keeps the input and the last good rich output and shows only a diagnostic. The `rich` value in `ko/demo.json` is `<strong>{name}</strong>님, <link>입력한 주문</link>을 확인해 주세요.`.

Rich output goes inside `#rich-preview` in the same layout as the form and modal. Redrawing the text keeps the open modal's input value and focus.

`/` and `/about` use the same layout node, so rich text, input, and modal state are preserved. Navigating to `/plain` and back creates a new instance, resets the name, and returns rich output to the SSR default `Saylo`.

## Verification commands

```sh
npm run build:sveltekit
npm run verify:sveltekit
npm run verify:demo:sveltekit:recovery
npm run verify:pack:sveltekit
npm run verify:registry:sveltekit
```

`build` runs typegen, SvelteKit sync, template and TypeScript checks, client and SSR builds, and Node adapter generation. `verify:ssr` starts a temporary development server itself and verifies SSR and boot consistency for concurrent Korean and English requests, locale normalization, and base-language fallback. In SSR HTML it also checks the first rich output when the name is empty (`<strong>Saylo</strong>`) and the app-owned link (`href="#order-form"`). It provides a hot context to the real client connection function and checks listener cleanup, duplicate stop, and cancellation of a late connection after cleanup, then closes the server. To check an already running server, pass the address with `npm --prefix examples/sveltekit run verify:ssr -- http://127.0.0.1:5191`. A run with an address performs HTTP validation only.

`verify:pack:sveltekit` creates tarballs for all five Saylo packages and installs them into a temporary app outside the repository. It copies only the example's source, configuration, and catalogs; it does not bring the existing lockfile, node_modules, or build output. It checks type checking, client and SSR builds, development connection lifetime, Node production HTTP, hydration in actual Chromium, rich hydration and rich input, ko/en/ko switching, input and open modal preservation, and layout teardown and re-entry. The browser probe is added only to the temporary app, and cleanup removes the browser, server, and temporary folder. It requires an installed Chrome or Edge; if they are not found automatically, specify one with `npm run verify:pack:sveltekit -- --browser <executable>`. The run before rich checks were added passed on 2026-10-08 on Windows, Node 24.18.0, and HeadlessChrome 154. This check is not automatically added to CI.

`verify:demo:sveltekit:recovery` copies the example to a temporary folder and checks recovery in headless Chromium. The warm run checks four rich cases (rich live edit, invalid rich marker, fallback input preservation, and rich recovery) plus seven cases for locale removal and restoration, an empty base catalog, navigation during an error, base restoration, and namespace removal and restoration. The cold run checks three cases: hydration, interaction, and recovery from an empty catalog. For each normal, empty, and recovered state, SSR checks the HTML and rendered language at `/?locale=ko`, `/?locale=en`, `/about?locale=ko`, and `/about?locale=en`. On Windows it uses the path `C:/Program Files/Google/Chrome/Application/chrome.exe` as is; if Chrome is installed elsewhere, update the executable path in the script as well.

`verify:registry:sveltekit` downloads the five files from the [approved alpha.2 manifest](../../releases/0.1.0-alpha.2.json) from the npm registry, compares their SHA-512, and then performs the same app validation. It does not build local packages or install a `file:` directory. To keep validation aligned with the approved published build, rich checks are not enabled for this run. The full validation passed against actual published builds on 2026-10-09. The existing `verify:pack:sveltekit` remains the check for local candidate tarballs.

## Page navigation and live updates

`/` and `/about` share the `(saylo)` layout. The name, request note, and modal note live in this layout's `Workbench`, so they are preserved between the two pages. The connection explanation link inside the modal allows page navigation while keeping the window open. Locale selection updates the URL query and displays the pending value until the locale load completes.

`/plain` is outside this layout, so navigating there cleans up the development connection, source, and instance. Returning creates a new instance from the latest SSR boot and resets the form. Focus and scroll policy for ordinary page navigation follows SvelteKit defaults, and locale switching uses `goto(..., { reset: false })`.

During development, edit `locales/en/demo.json` or `ko/demo.json`. Saving valid messages applies them without reloading the page. Invalid JSON keeps the last good translation and shows a diagnostic. Fixing the error clears the diagnostic. Production builds use static catalogs and the lazy loader.

On 2026-10-08, HTTP SSR and boot consistency and browser hydration were confirmed in the development server and an actual Node adapter build. In the development browser, the check confirmed navigation with an open modal, input, focus, and cursor preservation after saving, the last good state and recovery for invalid JSON, URL locale switching, layout teardown, latest boot re-entry, and live reconnection. In the production browser it confirmed locale switching and input preservation after navigation, with no console errors or warnings. This record predates the rich preview. Full scope is in [39-sveltekit-example.md](../../docs/39-sveltekit-example.md).

After RichText integration, on Node 24.18.0, Vite 8.3.4, and HeadlessChrome 155, template and type checks passed with 0 errors and 0 warnings; 11 recovery browser steps and 3 empty first-run steps passed; and 12 SSR cases across normal, empty, and recovered states passed. Client and SSR builds and development connection cleanup for five independently installed tarballs also passed, as did 8 Node production browser steps. The check confirmed emphasis and link DOM, input, open modal, and focus preservation, and reset on layout re-entry, with no browser errors or warnings. The logs are `.release/sveltekit-rich-check.log`, `.release/sveltekit-rich-recovery.log`, and `.release/sveltekit-rich-pack.log`. No publication or remote CI was run.
