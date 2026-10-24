# Start Saylo with Vue from an empty folder

Export the Vue 3 + Vite 8 starter from the Saylo repository into an empty folder outside the repository, then install and run it. The Vue binding (`@0disoft/saylo-vue`) is a local private package and cannot be installed from the npm registry. The exporter therefore places workspace tarballs in `vendor/` inside the starter folder, and the consuming app installs only those tarballs through `file:`. The exported folder does not depend on the Saylo workspace, directory links, or root scripts.

## Prerequisites

- Node.js 24.x and npm are required. `engines.node` in the Saylo packages is `24.x`.
- Run the export from a Saylo repository checkout. `prepare:starter:vue` runs `npm run build` first, so repository dependencies must be installed beforehand.
- The target folder must be outside the repository and empty. If it contains even one file, the export refuses it instead of overwriting it.
- The tools list only major ranges. They are Vue 3, Vite 8, `@vitejs/plugin-vue` 6, TypeScript 6, and `vue-tsc` 3. The starter's TypeScript 6 and vue-tsc 3 are tools separate from the repository's TypeScript 7, and the root TypeScript 7 remains as it is.
- The Vue binding and starter are not published. `@0disoft/saylo-vue` has `private` set to `true` and `version` set to `0.1.0-alpha.4`, but this version is not on the registry and is not included in any of the five published packages (`alpha`) or the `0.1.0-alpha.5` candidate. It is on publish hold.

## Export

Run this from the Saylo repository root.

```sh
npm run prepare:starter:vue -- --out-dir C:/Users/cherr/Downloads/saylo-vue-starter
```

`prepare:starter:vue` builds the workspace with `npm run build` and then runs `scripts/prepare-vue-starter.mjs`. This script:

- Verifies that the target path is outside the repository and empty. If not, it exits without writing anything.
- Copies `examples/vue-starter` to the target.
- Creates `vendor/` and produces tarballs for the four packages (`core`, `vue`, `vite`, `typegen`) with `npm pack`.
- Renames the tarballs to `saylo-<name>.tgz` and writes `vendor/manifest.json`.

The terminal prints the target path and the same content as `manifest.json` in JSON.

## Exported folder layout

| File | Content |
| --- | --- |
| [package.json](../examples/vue-starter/package.json) | Scripts and dependencies. Saylo packages use `file:./vendor/*.tgz` |
| [vite.config.mjs](../examples/vue-starter/vite.config.mjs) | Vue plugin and `saylo()` plugin; dev 5195, preview 5196 |
| [tsconfig.json](../examples/vue-starter/tsconfig.json) | TypeScript config, including `virtual:saylo` types |
| [index.html](../examples/vue-starter/index.html) | Mount point `#root` |
| [main.ts](../examples/vue-starter/main.ts) | App creation, plugin installation, and shutdown cleanup |
| [i18n.ts](../examples/vue-starter/i18n.ts) | `createI18n` lazy store and `createSayloVue` factory |
| [App.vue](../examples/vue-starter/App.vue) | Screen and rich preview, plus development connection |
| [demo-messages.ts](../examples/vue-starter/demo-messages.ts) | Projection of messages from the last good snapshot |
| [locales/ko/demo.json](../examples/vue-starter/locales/ko/demo.json) | Base locale |
| [locales/en/demo.json](../examples/vue-starter/locales/en/demo.json) | Initial screen locale |
| `vendor/saylo-core.tgz` etc. | Four local unpublished tarballs and `vendor/manifest.json` |

`generated.d.ts` is not included in the starter. The installed `saylo-typegen` CLI creates it.

## vendor/ and versions

`vendor/` contains four tarballs created from the repository (`saylo-core.tgz`, `saylo-vue.tgz`, `saylo-vite.tgz`, `saylo-typegen.tgz`). Their filenames are changed from the `npm pack` output names to `saylo-<name>.tgz`.

- The source is a local unpublished workspace. `source` in `vendor/manifest.json` is `local-unpublished`, and each package records `name`, `version`, `integrity`, and `file`.
- The version string may point to `0.1.0-alpha.4`, as the published build does, but the bytes differ from the `alpha.4` published to the registry. These are local build artifacts, so they are local source snapshots, not published builds.
- The consuming app uses `file:./vendor/saylo-core.tgz` and `file:./vendor/saylo-vue.tgz` in `dependencies`, and `file:./vendor/saylo-vite.tgz` and `file:./vendor/saylo-typegen.tgz` in `devDependencies`. It does not use `workspace:`, `file:` directories, symbolic links, or root script links.

## Install and run

```sh
cd <exported folder>
npm install --ignore-scripts --no-audit --no-fund
npm run dev
```

- `npm install` installs the tarballs in `vendor/` as they are. It does not fetch Saylo packages from the registry, and `--ignore-scripts` prevents install scripts from running.
- `npm run dev` generates `generated.d.ts` with `typegen` and starts Vite. The address is `http://127.0.0.1:5195`; `strictPort` makes it fail if the port is in use.
- `npm run build` runs `typegen` → `vue-tsc --noEmit` → `vite build`. Vite build does not type-check consumer code, so `vue-tsc` comes first.
- `npm run preview` shows the build output at `http://127.0.0.1:5196`. It uses build-time catalogs instead of live updates.

`npm install` creates `package-lock.json`. To reproduce the same installation, use `npm ci --ignore-scripts --no-audit --no-fund`.

## Code connections

The full source is in the starter files, so it is not repeated here.

- [i18n.ts](../examples/vue-starter/i18n.ts) creates a lazy store with `createI18n` and exposes `createPlugin` and `useI18n` from `createSayloVue`. Catalogs come from `virtual:saylo/lazy`.
- [main.ts](../examples/vue-starter/main.ts) installs the plugin with `createApp(App).use(createPlugin(store))`. The plugin does not create subscriptions and does not dispose the instance, so the app owns the store lifetime. If `pagehide` has `persisted`, keep subscriptions for BFCache restoration; on a real shutdown, call `app.unmount()` and then `store.dispose()`. The Vite HMR dispose path runs the same cleanup.
- [App.vue](../examples/vue-starter/App.vue) subscribes to a `useI18n` snapshot and connects development in `onMounted` with `connectDev(store, { catalogSource, onDiagnostic })`. `onScopeDispose` disconnects and increments a generation number to discard late locale-switch replies.
- The screen elements are the `#name` input, which defaults to `Saylo`; the `#note` textarea; the `#confirmation` dialog opened by `#open-dialog`; and the `#locale` selector.
- `#rich-preview` renders the result of `snapshot.tParts('demo:rich', { name: name || 'Saylo' })` with `renderRichText`. The app supplies the `strong` and `link` tags, and the `link` `href` is `#order-form`.
- `#selected-locale` is rendered by a child component that uses `useI18nSelector(snapshot => snapshot.locale)` from the same factory.

## Verify live edits

1. Enter a name in `#name`. Messages that use `{name}` change to that value.
2. Change `greeting` in `locales/en/demo.json` from `Hello {name}` to `Updated {name}` and save. The page initially loads in `en`, so the text changes in place, and input values and an open dialog stay as they are.
3. If you create `locales/ja/demo.json` with the same keys as the base, `ja` appears in the `#locale` list, and selecting it lazy-loads and shows that file.
4. If you add a key to the base locale `ko`, the Vite plugin option `typegen: { outFile: 'generated.d.ts' }` regenerates `generated.d.ts`. Update the app call site and the generated type together for the types to match.
5. If you edit the `rich` message in `locales/en/demo.json`, `#rich-preview` changes in place, and `strong` nodes and an open dialog stay as they are.
6. If you save a mismatched `rich` marker such as `<strong>{name}</strong></link>`, a diagnostic appears in `#render-error` and the last good rich message remains. Changing `#name` re-interpolates it with that value, and restoring the file clears the diagnostic.

## Form and dialog preservation

`projectMessages` changes the screen only after computing all messages, including rich text. If locale JSON is broken or the key schema does not match, it keeps input values, an open dialog, and focus, shows the last good text, and displays a diagnostic. If a rich marker is mismatched, the whole screen stays on the last good snapshot and the rich message is recalculated with the current input values. Restoring the file clears the diagnostic and re-interpolates with the saved input. Edits that change the base schema itself, such as deleting a base key or adding a required argument, also require updating the app call site and types.

## Type generation

```sh
npm run typegen
```

It runs `saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts`. Because dev and build run typegen first, you rarely need to call it separately. Connect generated types to the `createI18n<AppSchema>` generic, not to the config. Changing base keys or arguments requires regenerating `generated.d.ts`; editing only messages does not change the schema, so it is applied without waiting for type regeneration.

## Same-major updates

- The four tarballs are local source snapshots, so rebuilding the packages requires new tarballs. To export again, use a new empty folder.
- For updates within the same major, run the exporter again to get new tarballs and reproduce installation with `package-lock.json` and `npm ci`. If the repository publishes new builds, recheck the same procedure against those versions.
- The starter lists tool versions by major range only (`vue: "3"`, `vite: "8"`, `@vitejs/plugin-vue: "6"`, `typescript: "6"`, `vue-tsc: "3"`), so stable updates within the same major follow through lockfile updates, and new majors are promoted after compatibility checks.

This document does not cover publication, login, or private registry installation procedures. The Vue package is on publish hold, and the starter does not change that publication state.

## Repository validation

`npm run verify:starter:vue` at the repository root combines export through browser verification. It builds the repository, exports the starter to a temporary folder outside the repository, and installs the actual tarballs without links to verify them.

- Installing actual tar files, absence of symlinks, and comparing the SHA-512 of the four tarballs with the lockfile integrity from the installation
- Generating `generated.d.ts` with the installed CLI typegen (including the `demo:rich` schema), running `vue-tsc` on the starter template, and building the starter itself
- 15 browser steps on a new Vite dev server: first render, rich render (`strong` and the `#order-form` link), selected locale display, locale switch, live edit, rich live edit, mismatched rich marker, current input value in rich fallback output, rich recovery, last good text for broken JSON, recovery, locale addition, schema extension, form and dialog preservation, and cleanup
- 6 production preview browser steps: first render, rich render, selected locale display, locale switch, form and dialog preservation, and cleanup

Development's 15 steps and production's 6 steps passed on Node 24.18.0, Vite 8.3.4, and HeadlessChrome 155. Rich nodes, `#selected-locale`, input values, an open dialog, focus, and the selected range were preserved, and there were no browser errors or warnings. The report is written to `.release/vue-starter-report.json` and the log to `.release/vue-starter-rich.log`. This is not the result of publishing the library or running remote CI.
