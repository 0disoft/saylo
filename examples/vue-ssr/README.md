# Vue 3 SSR hydration demo

An example that hydrates server-rendered HTML in the browser using Vue 3 `createSSRApp` and the `h` render function. It is not a published build; it uses `@0disoft/saylo-core`, `@0disoft/saylo-vue`, and `@0disoft/saylo-vite` directly from the root workspace. It is only a development demo server, not a production SSR deployment configuration for an actual service.

Follow the Vue official documentation for what SSR and hydration are and which assumptions they require. [Server-Side Rendering (SSR)](https://vuejs.org/guide/scaling-up/ssr.html)

Install from the repository root, then run it.

```sh
npm ci --ignore-scripts
npm run dev:vue:ssr
```

`dev:vue:ssr` builds the workspace packages first and starts `examples/vue-ssr/server.mjs`. The default address is `http://127.0.0.1:5193`, and the locale is chosen through the query.

```text
http://127.0.0.1:5193/?locale=ko
http://127.0.0.1:5193/?locale=en
```

## File structure

`examples/vue-ssr` is a separate app from `examples/vue`. Its purpose is to demonstrate render functions and the server request lifecycle, so it builds the tree with `h` instead of using `App.vue`. It uses the locale files in `examples/vue/locales` directly without copying them. The base locale is `ko`, the initial namespace is `demo`, and the time zone is `UTC`.

`app.mjs` creates the `createSayloVue()` factory once at module scope, and `createApp(instance)` installs that request's instance with `createSSRApp(Form).use(createPlugin(instance))`. Each server request creates an instance with `createRequestI18n` and disposes it in `finally` after rendering finishes. It does not reuse instances between requests or keep a shared singleton instance on the server. It sends the serialized boot snapshot (`serializeBootSnapshot`) in the HTML, and the client restores the initial snapshot with `decodeBootSnapshot` for hydration.

The name and request note inputs are uncontrolled DOM inputs. After hydration, `onMounted` reads their values into Vue refs and updates the echo message. Values entered before hydration also survive, and the framework does not redraw the inputs.

`connectDev` is attached after `app.mount` returns synchronously. If `pagehide` has `persisted`, it keeps subscriptions for BFCache restoration; on a real page shutdown it cleans up in the order `disconnectDev` → `app.unmount()` → `client.dispose()`. Vite HMR dispose runs the same cleanup.

## Hydration check

1. Open `?locale=ko` and enter a name and request note. The server-rendered HTML remains, and only the echo message updates.
2. Reload and confirm that the same screen appears without hydration errors. The locale in the boot snapshot and the client's initial snapshot must match.
3. In development mode, edit and save the text in `examples/vue/locales/ko/demo.json`. The live edit applies after hydration and preserves input values, focus, and the selected range.
4. Switch the language to `en` and confirm that `examples/vue/locales` is used for locale switching too.

## Rich text and recovery

`app.mjs` renders the `rich-preview` paragraph with `renderRichText`. It maps `strong` and `link` to emphasis and link elements, and the link's `href` points to the app-defined `#order-form`. Parts are created with `snapshot.tParts('demo:rich', { name: name || 'Saylo' })`. SSR and initial hydration have an empty name, so both produce the same markup with `Saylo`. When `onMounted` reads a value entered before hydration into the ref, the emphasis text also updates to the actual name.

Screen translations are computed in full first. If an invalid marker appears, it shows guidance in `render-error` and keeps the last good snapshot reformatted with the current `name` and `count`. Editing and saving a valid translation clears the error guidance and returns to a normal render. If it is invalid from the first server render, there is no last good snapshot, so the request fails.

## Automated check

```sh
npm run verify:demo:vue:ssr
```

After `npm run build`, it runs `scripts/verify-vue-hydration.mjs` in headless Chromium. It does not modify the original translation files; it copies `examples/vue/locales` to an isolated fixture under `.release`. It checks concurrent `ko` and `en` SSR, matching boot and initial hydration snapshots, preservation of input, focus, selected range, and DOM identity before hydration, the gap until sync after a server catalog edit, locale switching, live edits after hydration, zero listeners after cleanup, and absence of runtime errors and warnings. It also checks rich SSR string escaping and marker mapping, DOM identity preservation when inserting a rich live literal, recovery from an invalid rich marker, and tracking of the current input.

The example now installs the request instance with `app.use(createPlugin(instance))`. On 2026-10-12, this install path also passed again with concurrent SSR and 8 browser steps each for Korean and English in the same environment. There were no runtime errors or warnings, and after shutdown the component subscriptions and disposal listeners were both 0.

On 2026-10-12, on Node 24.18.0, Vite 8.3.4, and headless Chromium 154, concurrent SSR and 8 browser steps each for Korean and English passed (the install path at that time was the parent component's `provideI18n`). There were no runtime errors or warnings, and after shutdown the component subscriptions and disposal listeners were both 0. The local report is written to `.release/vue-hydration-report.json`. These results are from the development server; production deployment, Nuxt integration, and real BFCache restoration are outside the verification scope. The BFCache check verifies only the `persisted` branch of a synthetic `pagehide` event.

After connecting RichText, on Node 24.18.0, Vite 8.3.4, and HeadlessChrome 155, concurrent SSR and 12 steps each for Korean and English passed. The added 4 steps are rich text editing, an invalid marker, reflecting the current name during an error, and HTML escaping with normal recovery. The check preserved the emphasis and link DOM and input, focus, and selected range, with no errors, warnings, or remaining subscriptions after shutdown. The log is `.release/vue-rich-ssr.log` and the report is `.release/vue-hydration-report.json`.
