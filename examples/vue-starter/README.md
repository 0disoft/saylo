# Saylo Vue starter

A Vue 3 + Vite 8 starter for Saylo. The Saylo repository exports this folder to an empty folder outside the repository, and the consuming app installs and runs it from the tarballs in `vendor/` without depending on the repository workspace.

## How this folder is created

Run from the Saylo repository root.

```sh
npm run prepare:starter:vue -- --out-dir <empty folder outside the repository>
```

The target must be outside the repository and empty. If it contains files, the export refuses instead of overwriting. The export builds the repository first, copies this folder, and creates tarballs for all four packages and `vendor/manifest.json` in `vendor/`.

## vendor/ and versions

`saylo-core.tgz`, `saylo-vue.tgz`, `saylo-vite.tgz`, and `saylo-typegen.tgz` in `vendor/` are tarballs packed from the local unpublished workspace with `npm pack`.

- `source` in `vendor/manifest.json` is `local-unpublished`.
- The version string is `0.1.0-alpha.4`, like the published build, but the bytes differ from the published `alpha.4`. These are local build artifacts, not published builds.
- `@0disoft/saylo-vue` is private and is not published, so the starter uses `file:` tarballs instead of a registry installation.

## Install and run

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run dev      # typegen 뒤 개발 서버 127.0.0.1:5195 (strictPort)
npm run typegen  # saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts
npm run build    # typegen -> vue-tsc --noEmit -> vite build
npm run preview  # 빌드 결과 127.0.0.1:5196 (strictPort)
```

`--ignore-scripts` prevents install scripts from running. Once `package-lock.json` is created, reproduce the same installation with `npm ci --ignore-scripts --no-audit --no-fund`. The tools list only major ranges: Vue 3, Vite 8, `@vitejs/plugin-vue` 6, TypeScript 6, and `vue-tsc` 3.

`generated.d.ts` is not stored in the repository; `npm run typegen` creates it. Development and build also run typegen first.

## Locales

- Adding `locales/<locale>/demo.json` with the same keys as the base locale `ko` adds it to the `#locale` list and lazy-loads it when selected.
- The initial screen locale is `en`, and the base is `ko`.
- Changing `greeting` in `locales/en/demo.json` from `Hello {name}` to `Updated {name}` and saving updates the text immediately.
- Adding a key to the base locale requires regenerating `generated.d.ts` and updating the app call-site types.
- Deleting an unused locale file removes that locale from the list.

## Rich messages

`#rich-preview` in `App.vue` renders the result of `snapshot.tParts('demo:rich', { name: name || 'Saylo' })` with `renderRichText`. The app decides the `strong` and `link` tags, and `link` has `href` set to `#order-form`. `locales/en/demo.json` and `locales/ko/demo.json` contain `rich` messages, which are edited by the same rules as other keys.

`#selected-locale` is rendered by a child component that uses `useI18nSelector(snapshot => snapshot.locale)` from the same factory. If a rich marker is mismatched, a diagnostic appears in `#render-error` and the last good message is re-interpolated with the current name.

## Form and dialog preservation

`projectMessages` in `demo-messages.ts` changes the screen only after computing all messages, including rich text. If locale JSON is broken or a key does not match, it keeps input values, an open dialog, and focus, shows the last good text, and displays a diagnostic. Restoring the file re-interpolates with the saved input.

## Cleanup

`main.ts` owns the instance. A plugin installed with `app.use(createPlugin(store))` does not create subscriptions and does not dispose the instance, so `main.ts` performs cleanup. If `pagehide` has `persisted`, it keeps subscriptions for BFCache restoration; on a real shutdown it calls `app.unmount()` and then `store.dispose()`. Vite HMR dispose runs the same cleanup. `App.vue` disconnects development in `onScopeDispose` and increments a generation number to discard late replies. If you change the app structure, manage this disposal responsibility yourself.
