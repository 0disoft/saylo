# Vue 3 demo

An example that verifies the Vue 3 adapter's live catalog behavior in a browser. It is not a published build; it uses `@0disoft/saylo-vue` and `@0disoft/saylo-vite` directly from the root workspace. It is browser-only and has no SSR routes.

Install from the repository root, then run it.

```sh
npm ci --ignore-scripts
npm run dev:vue
```

`dev:vue` builds the workspace packages first and starts the development server with `examples/vue/vite.config.mjs`. The default address is `http://127.0.0.1:5192`; `strictPort` makes it fail if the port is in use.

## File structure

`i18n.ts` creates the store with `createI18n` and exposes `createPlugin` and `useI18n` from `createSayloVue`. `main.ts` installs the plugin with `createApp(App).use(createPlugin(store))` and owns this store. `App.vue` subscribes to the `useI18n` snapshot and the `connectDev` development connection. The base locale is `ko`, the initial namespace is `demo`, and the time zone is `UTC`.

## Verify live edits

1. Enter a name, request note, and item count, then open the dialog with the open confirmation button. A native `<dialog>` opens.
2. With the dialog open and focus in the confirmation note, edit `heading` and `dialogTitle` in `examples/vue/locales/ko/demo.json` and save.
3. The screen title and open dialog text change immediately, while input values, dialog open state, and focus stay as they are.

## Locales

Locales use only `examples/vue/locales`. They are not shared with `examples/vanilla/locales`, which the React demo uses.

- Adding `examples/vue/locales/<locale>/demo.json` with the same keys as the base locale adds it to the language selector and lazy-loads it when selected.
- Match the key structure and ICU arguments to the base schema. Keep the `count` argument in `summary` and change only the translation. `heading` and `dialogTitle` are strings without arguments.
- Deleting the currently selected locale file returns the screen to the base language `ko`.
- If JSON becomes invalid, keep the last good screen and show a diagnostic.
- If a key is missing, keep the last translated screen and show fix guidance.

## Rich text preview

`App.vue` adds a `rich-preview` paragraph. It defines a `RichPreview` wrapper around `renderRichText` in the same file and places `<RichPreview />` in the template's `rich-preview` paragraph. It maps `strong` to `<strong>` and `link` to a link to the order form on the same screen (`#order-form`), and uses `Saylo` when the name input is empty.

```ts
const richRenderers: RichTextRenderers = {
  strong: children => h('strong', children),
  link: children => h('a', { href: '#order-form' }, children),
};
const RichPreview = () => renderRichText(text.value.rich, richRenderers);
```

The helper renders sibling tags as keyed `Fragment` nodes, so editing the text or inserting a literal preserves the identity and state of the mapped elements.

Add rich keys to `examples/vue/locales/ko/demo.json` and `en/demo.json`. Korean is `<strong>{name}</strong>님, <link>입력한 주문</link>을 확인해 주세요.`, and English is `<strong>{name}</strong>, review <link>your order</link>.`, the same as the React and Svelte demos. `demo:rich` is added to the generated types as well.

`projectDemoMessages` includes rich parts in the last good full translation projection. After rich markup becomes invalid, changes to name, count, or input reformat the last good snapshot with the current arguments.

Local validation confirmed the demo template check, production build, and HeadlessChrome 155 recovery warm 16 and cold 3 (no errors). This preview is a local change not present in published builds, and the contract follows the [Vue package guide](../../packages/vue/README.md).

## Support diagnostics

The support panel collects observations only with `createSupportRecorder`. The `진단 자료 만들기` button generates JSON for direct review, and `오류 기록 지우기` clears the records and state. It does not send anything automatically. The report contains only error codes, numeric positions, connection state, and allowlisted environment versions; raw translation text, file paths, and input values are excluded.

## Build

```sh
npm run setup:vue
npm run build:vue
```

Install the independent template checking tools with `setup:vue` before the first build. After the workspace package build, it generates base catalog types, checks Vue templates, and runs the Vite production build in that order. `tools/vue` uses TypeScript 6 and vue-tsc 3 and is separate from the repository's TypeScript 7 compiler. If tool dependencies have not changed, you do not need to repeat setup on the next build.

## Recovery validation

```sh
npm run verify:demo:vue:recovery
```

It copies the fixture under `.release` to create a temporary app, checks it in headless Chromium, then removes the folder. It checks 12 steps for normal live editing, broken JSON, locale add/select/delete, an empty catalog, and missing namespace recovery, plus 4 rich steps (rich edit, invalid markup, fallback input, and recovery), for a warm total of 16; and 3 cold steps for empty first run, input, and recovery on a new server. It preserves input values, an open modal, focus, and generated diagnostic data, and on valid saves it also checks the selected range in the confirmation note. It does not modify the original translation files.

## Cleanup

`main.ts` owns the instance. A plugin installed with `app.use(createPlugin(store))` does not create subscriptions and does not dispose the instance, so `main.ts` performs cleanup. If `pagehide` has `persisted`, it keeps subscriptions for BFCache restoration; on a real page shutdown it calls `app.unmount()` and then `store.dispose()`. Vite HMR dispose runs the same cleanup. `App.vue` disconnects development in `onScopeDispose` and increments a generation number to discard late replies.
