# Start Saylo with Svelte from an empty folder

This guide adds Saylo to a Vite 8 + Svelte 5 app using only the npm registry, without cloning the Saylo repository. Create ten files in an empty folder and start the development server; the text changes as soon as you edit the locale JSON, and form and modal state stay as they are. This document uses only the public API of the published `0.1.0-alpha.4`. It does not use unpublished local APIs (`onSyncState` or the diagnostic support report).

To export a separate Svelte starter from a Saylo repository clone into an empty folder outside the repository using a local unpublished tarball, see [examples/svelte-starter/README.md](../examples/svelte-starter/README.md).

## Prerequisites

- Node.js 24.x and npm are required. `engines.node` in the published package is `24.x`.
- The Saylo repository is private, but the published packages are on the npm public registry. You do not need to clone the repository, sign in to GitHub, or use `file:`, `workspace:`, or alias links.
- The `latest` tag for the Saylo packages is a placeholder for registration. Add `@alpha` when installing.
- Svelte is a peer dependency whose condition is 5, and Vite is a peer dependency of `@0disoft/saylo-vite` whose condition is 8.
- The published build checked against this document is `0.1.0-alpha.4`. Each alpha publication increases the version, so recheck the procedure below against a new build.

## Ten files

Create the following ten files in the empty folder. Create the `locales/ko` and `locales/en` folders first.

### package.json

```json
{
  "name": "saylo-svelte-starter",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "svelte-check --tsconfig ./tsconfig.json && vite build",
    "preview": "vite preview"
  },
  "engines": { "node": "24.x" },
  "dependencies": {
    "@0disoft/saylo-core": "alpha",
    "@0disoft/saylo-svelte": "alpha",
    "svelte": "5"
  },
  "devDependencies": {
    "@0disoft/saylo-vite": "alpha",
    "@sveltejs/vite-plugin-svelte": "7",
    "@types/node": "24",
    "svelte-check": "4",
    "typescript": "6",
    "vite": "8"
  }
}
```

`svelte-check` at the start of the build checks both `.svelte` and `.ts`. This example uses TypeScript 6 to match the peer range of `svelte-check` 4. Before upgrading to TypeScript 7, check the compatibility range of the checking tool.

### vite.config.mjs

```js
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({
  plugins: [svelte(), saylo({ localesDir: 'locales', baseLocale: 'ko', initialLocale: 'en', timeZone: 'UTC' })],
  server: { host: '127.0.0.1', port: 5195, strictPort: true },
  preview: { host: '127.0.0.1', port: 5196, strictPort: true },
});
```

`localesDir` is relative to the Vite root, and catalogs are at `locales/<locale>/<namespace>.json`. `baseLocale` defines the base schema, `initialLocale` is the locale shown on first load, and `timeZone` is the basis for formatting date and time arguments.

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "@0disoft/saylo-vite/virtual"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowJs": true
  },
  "include": ["*.ts", "*.svelte"]
}
```

You must add `@0disoft/saylo-vite/virtual` to `types` to see the `virtual:saylo` declaration. `include` must contain `.svelte` for `svelte-check` to read component types.

### index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Saylo Svelte starter</title>
    <style>body{font-family:system-ui,sans-serif;margin:3rem auto;max-width:40rem}#error{color:#b00020;white-space:pre-line}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.ts"></script>
  </body>
</html>
```

Svelte creates the screen elements, and `index.html` only provides the mount point.

### i18n.ts

```ts
import { createStore } from '@0disoft/saylo-core';
import { createSvelteStore } from '@0disoft/saylo-svelte';
import { baseLocale, initialCatalogs, initialLocale, timeZone } from 'virtual:saylo';

// 기준 로케일에서 만든 스키마. saylo-typegen이 같은 형태를 생성한다.
export type AppSchema = {
  'demo:heading': {};
  'demo:greeting': { name: string | number };
  'demo:nameLabel': {};
  'demo:noteLabel': {};
  'demo:openDialog': {};
  'demo:closeDialog': {};
  'demo:dialogTitle': {};
};

export const store = createStore<AppSchema>({ catalogs: initialCatalogs, baseLocale, locale: initialLocale, timeZone });
export const i18n = createSvelteStore(store);
```

Create the `store` and the adapter store `i18n` once at module scope. `i18n` is a Svelte `Readable`, so the template auto-subscribes with `$i18n`.

### main.ts

```ts
import { mount, unmount } from 'svelte';
import App from './App.svelte';
import { store } from './i18n';

const app = mount(App, { target: document.getElementById('root')! });

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  window.removeEventListener('pagehide', pagehide);
  void unmount(app).finally(() => store.dispose());
}
const pagehide = (event: PageTransitionEvent) => { if (!event.persisted) cleanup(); };
window.addEventListener('pagehide', pagehide);
if (import.meta.hot) import.meta.hot.dispose(cleanup);
```

The entry owns the mount and store lifetimes. During cleanup, call `store.dispose()` after `unmount` finishes, and keep `cleanup` idempotent by removing the named `pagehide` handler. When `persisted` is true in `pagehide`, do not clean up; clean up only when it is false.

### App.svelte

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { connectDev } from '@0disoft/saylo-vite/client';
  import type { LiveDiagnostic } from '@0disoft/saylo-vite/client';
  import { i18n, store } from './i18n';
  import { projectMessages } from './demo-messages';

  let name = $state('Saylo');
  let note = $state('');
  const lastRendered: { current: ReturnType<typeof store.getSnapshot> | undefined } = { current: undefined };
  const presentation = $derived(projectMessages($i18n, lastRendered.current, name));
  const text = $derived(presentation.messages);
  $effect(() => { if (presentation.accepted) lastRendered.current = presentation.accepted; });
  let diagnostic = $state('');
  let dialog: HTMLDialogElement | undefined;

  // 문서 lang은 그 렌더의 locale을 따른다.
  $effect(() => { document.documentElement.lang = $i18n.locale; });

  function formatDiagnostic(value: LiveDiagnostic) {
    // 서버가 파일을 복구하면 빈 message/diagnostics를 보낸다. 그때 문자열이 비워진다.
    if (value.diagnostics.length) {
      return value.diagnostics.map(row => row.sourceName + (row.id ? ' [' + row.id + ']' : '') + ': ' + row.message).join('\n');
    }
    return value.message;
  }

  onMount(() => {
    if (!import.meta.hot) return;
    return connectDev(store, {
      hot: import.meta.hot,
      onDiagnostic: value => { diagnostic = formatDiagnostic(value); },
    });
  });
</script>

<main lang={presentation.locale}>
<h1 id="heading">{text.heading}</h1>
<select id="locale" aria-label="Locale" lang="en" value={$i18n.locale}
  onchange={event => store.setLocale(event.currentTarget.value)}>
  {#each $i18n.availableLocales as locale (locale)}
    <option value={locale} lang={locale}>{locale}</option>
  {/each}
</select>
<p id="greeting">{text.greeting}</p>
<label for="name">{text.nameLabel}</label>
<input id="name" autocomplete="off" bind:value={name} />
<label for="note">{text.noteLabel}</label>
<textarea id="note" bind:value={note}></textarea>
<button id="open-dialog" type="button" onclick={() => dialog?.showModal()}>{text.openDialog}</button>
<p id="error" role="alert" lang="en">{diagnostic}</p>
<p id="render-error" role="alert" lang="ko">{presentation.error}</p>
<dialog id="confirmation" aria-labelledby="dialog-title" bind:this={dialog}>
  <h2 id="dialog-title">{text.dialogTitle}</h2>
  <p id="dialog-status" role="status" lang="en">{diagnostic}</p>
  <p id="dialog-render-error" role="alert" lang="ko">{presentation.error}</p>
  <label for="dialog-note">{text.noteLabel}</label>
  <textarea id="dialog-note" bind:value={note}></textarea>
  <button id="close-dialog" type="button" onclick={() => dialog?.close()}>{text.closeDialog}</button>
</dialog>
</main>
```

Keep `dialog` as `HTMLDialogElement | undefined` and receive it with `bind:this`. Handling the native dialog with `dialog?.showModal()` and `dialog?.close()` type-checks without a class cast. `setLocale` on an eager store returns `void`, so no Promise handling is needed.

`name` and `note` are `$state`. When the catalog updates, the component does not mount again, so input values, focus, and an open modal remain. `#dialog-note` uses the same state as `#note`, and diagnostic strings appear in both `#error` (`role="alert"`) and `#dialog-status` (`role="status"`) inside the modal. Translations are rendered as plain text only, so `{@html}` is not used.

### demo-messages.ts

```ts
import type { StoreSnapshot } from '@0disoft/saylo-core';
import type { AppSchema } from './i18n';

function read(snapshot: StoreSnapshot<AppSchema>, name: string) {
  const { t } = snapshot;
  return {
    heading: t('demo:heading'), greeting: t('demo:greeting', { name }),
    nameLabel: t('demo:nameLabel'), noteLabel: t('demo:noteLabel'),
    openDialog: t('demo:openDialog'), closeDialog: t('demo:closeDialog'), dialogTitle: t('demo:dialogTitle'),
  };
}

export function projectMessages(snapshot: StoreSnapshot<AppSchema>, previous: StoreSnapshot<AppSchema> | undefined, name: string) {
  try { return { messages: read(snapshot, name), locale: snapshot.locale, accepted: snapshot, error: '' }; }
  catch (error) {
    let messages = {
      heading: '번역을 준비하세요.', greeting: `이름: ${name}`,
      nameLabel: '이름', noteLabel: '메모', openDialog: '확인 창 열기', closeDialog: '닫기', dialogTitle: '메모 확인',
    };
    // Snapshot translators are immutable. Reformat the previous translation
    // with the current input instead of freezing the previous greeting.
    let locale = 'ko';
    if (previous) { try { messages = read(previous, name); locale = previous.locale; } catch { /* Keep the setup view. */ } }
    const message = error instanceof Error ? error.message : String(error);
    return { messages, locale, accepted: undefined,
      error: `${message}\nlocales/ko/demo.json의 키·인자를 확인하고 저장하세요. 입력은 유지됩니다.` };
  }
}
```

Compute all required messages before passing translations to components. If a key is deleted or the base catalog becomes empty, interpolate the current name into the last good snapshot again; if there was no translation from the start, show the fix guidance and the input screen. Snapshots are kept per component, so translations are not shared with another screen.

### locales/ko/demo.json

```json
{
  "heading": "Saylo Svelte 시작",
  "greeting": "{name}님 안녕하세요",
  "nameLabel": "이름",
  "noteLabel": "메모",
  "openDialog": "확인 창 열기",
  "closeDialog": "닫기",
  "dialogTitle": "메모 확인"
}
```

### locales/en/demo.json

```json
{
  "heading": "Saylo Svelte starter",
  "greeting": "Hello {name}",
  "nameLabel": "Name",
  "noteLabel": "Note",
  "openDialog": "Open dialog",
  "closeDialog": "Close",
  "dialogTitle": "Confirm your note"
}
```

The keys and arguments in the base locale `ko` form the base schema. Translation files use only keys and arguments that are present in the base.

## Run

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run dev
```

The development server starts at `http://127.0.0.1:5195`. Because `initialLocale: 'en'`, the first screen uses `en` text. `#heading` is `Saylo Svelte starter`, `#greeting` uses the `#name` value to produce `Hello {name}`, and `#locale` is populated with the locale list discovered by the plugin.

## Verify live edits

1. Enter a name in `#name`, write a note in `#note`, and open the modal with `#open-dialog`.
2. Change `greeting` in `locales/en/demo.json` to `"Updated {name}"` and save. Only the text changes immediately; the name and note input values and the open modal stay as they are.
3. Create `locales/ja/demo.json` with the same keys as the base.

```json
{
  "heading": "Saylo Svelte 日本語",
  "greeting": "こんにちは {name}",
  "nameLabel": "名前",
  "noteLabel": "メモ",
  "openDialog": "確認を開く",
  "closeDialog": "閉じる",
  "dialogTitle": "メモの確認"
}
```

`ja` appears in the `#locale` list; selecting it changes `#heading` to `Saylo Svelte 日本語` and `#greeting` to `こんにちは {name}`.

4. If you save `greeting` in `locales/en/demo.json` with an ICU-broken value such as `"{name"`, that file is not published, the last good text remains, and a diagnostic appears in `#error`. Restoring the value clears the diagnostic.

5. If you delete the `greeting` key from `locales/ko/demo.json` or replace the file contents with `{}`, fix guidance appears in `#render-error` and in the open modal. Input values and the last good translation remain, and changing the name interpolates the new name using the previous translation. Restoring the key clears the guidance.
6. If you start the development server with both ko/en files at `{}`, the translation setup guidance and input screen appear. After you fill in the files and save, the app recovers to the translated screen while preserving input.

Keys or arguments that are not in the base are handled by existing catalog diagnostics, and render failures caused by deleting a base key or by an empty catalog are handled by `projectMessages`. To use a new key or argument, update the app call site and the types together.

## Build and preview

```sh
npm run build
npm run preview
```

`build` checks types with `svelte-check` and then creates a Vite production build. The build removes the parser runtime at the Saylo AST boundary (`astRuntime` defaults to `true`), so the production bundle does not include the ICU parser. The preview server is at `http://127.0.0.1:5196` and uses build-time catalogs instead of live updates.

## Type generation (optional)

You can write `AppSchema` in `i18n.ts` by hand. For automatic generation, run typegen once.

```sh
npm exec --package=@0disoft/saylo-typegen@alpha -- saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts
```

`latest` is a placeholder, so specify `@alpha`. To use generated types, delete the hand-written `export type AppSchema = {...}` from `i18n.ts` and add the following two lines at the top. Re-export it so the helper uses the same type.

```ts
import type { AppSchema } from './generated';
export type { AppSchema } from './generated';
```

Connect generated types to the `createStore<AppSchema>` generic, not to the config. Adding a new key or changing an argument requires updating both the schema and typegen; editing only the `greeting` value does not change the schema, so it is applied without waiting for a type compile.

## Next

- For the catalog format and the `createStore` API, see [catalog and API](03-catalog-and-api.md).
- For `createSvelteStore`, `$i18n`, and selector subscriptions, see the [@0disoft/saylo-svelte README](../packages/svelte/README.md).
- For lazy loading and SSR, see `virtual:saylo/lazy` and `virtual:saylo/server` in the [@0disoft/saylo-vite README](../packages/vite/README.md).
- For the React path, see [start with React from an empty folder](getting-started-react.md).

