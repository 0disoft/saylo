# Svelte 5 demo

Run `npm install` at the repository root first.

```sh
npm run dev:svelte
```

The address is `http://127.0.0.1:5190`. Enter a name and request note, open the confirmation window, and then edit the text in `locales/ko/demo.json`. Saving a valid translation preserves the input values and the open window while updating the text. Adding `locales/<locale>/demo.json` makes it appear in the language selector and lazy-loads it when selected. Deleting the selected locale returns to the base language `ko`.

`App.svelte` passes the instance through context, and `Preview.svelte` subscribes with `$i18n`. `onMount` starts the development connection, and component teardown disconnects it. The instance is owned and disposed in `main.ts`. This demo is for browsers and does not include a SvelteKit server route example.

```sh
npm run build:svelte
```

It generates types from the base catalog, checks the `.ts` connection code, and production-builds the Svelte components. TypeScript diagnostics across the entire template are a separate scope checked with Svelte tooling. The adapter's type contract is checked in JS checkJs and TypeScript strict consumer tests.

On 2026-10-08, a real browser check confirmed that saving valid messages preserves the name, request note, modal note, modal open state, focus, and cursor position; it also confirmed adding, selecting, and deleting a temporary locale and returning to the base language. Temporary locales and message edits created during validation were restored. Rebuilding the package makes Vite reload linked package modules, so do not build the package concurrently while validating file saves.

## Rich text preview

`Preview.svelte` adds a `rich-preview` paragraph. It maps `strong` to `<strong>` and `link` to a link to the order form on the same screen (`#order-form`), and uses `Saylo` when the name input is empty.

Add rich keys to `examples/svelte/locales/ko/demo.json` and `en/demo.json`. Korean is `<strong>{name}</strong>님, <link>입력한 주문</link>을 확인해 주세요.`, and English is `<strong>{name}</strong>, review <link>your order</link>.`, the same as the React demo.

`projectDemoMessages` includes rich parts in the last good full translation projection. After rich markup becomes invalid, changes to name, count, or input reformat the last good snapshot with the current arguments.

This preview is an unpublished change using the component from local commit `010a600`. See [80-svelte-rich-text.md](https://github.com/0disoft/saylo/blob/main/docs/80-svelte-rich-text.md) for validation status. Use the same procedure above for development, build, recovery commands, and locale editing.
