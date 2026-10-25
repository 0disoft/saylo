# React initialization preset

Included in the alpha.8 CLI build.

In an existing React 19 + React DOM + Vite 8 app, preview `saylo init --framework react --json`, then apply with `--apply`. Install the packages listed in `nextSteps` using matching builds. Existing application entries, routes and providers are preserved; conflicting generated files are rejected before writing.

Open `/saylo.html` on the development server. The isolated demo creates one store outside React rendering, supplies typed `SayloProvider`/`useI18n` bindings, selects the locale from the query string, browser storage, browser language, then the configured initial locale, and cleans up on page exit or module disposal. Browser storage is optional. Translation edits and language switches preserve the input and open dialog. React StrictMode does not create extra stores or connections.

Build this demo separately with `vite build --config saylo.demo.config.mjs`. It writes `dist-saylo-demo/` and leaves the application's normal build entry and output configuration unchanged. This preset targets client apps. Framework-specific SSR and routing remain application-owned.

For application integration, create one `createAppI18n()` instance per app owner, import the bindings from `src/saylo/react.tsx`, wrap the app in `<SayloProvider instance={app.store}>`, and call `app.dispose()` when the owner ends. Never create an SSR singleton shared by requests.

From the Saylo checkout, `node scripts/verify-init-react.mjs` checks consumer types and the generated production build. An optional path to a Playwright module enables real-browser checks for locale switching, live edits, state retention, StrictMode and production rendering.
