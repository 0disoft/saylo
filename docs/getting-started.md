# Start Saylo from an empty folder with npm

This guide adds Saylo to a Vite 8 app using only the npm registry, without cloning the Saylo repository. Create six files in an empty folder and start the development server; the on-screen text changes as soon as you edit the locale JSON. This minimal sample was written and validated against the published `0.1.0-alpha.4`; its recorded validation remains at that version.

## Prerequisites

- Node.js 24.x and npm are required. `engines.node` in the published package is `24.x`.
- Saylo packages are available on the public npm registry. You do not need to clone the repository, sign in to GitHub, or use `file:`, `workspace:`, or alias links.
- The `latest` tag is still a placeholder for registration. The `alpha` tag currently installs `0.1.0-alpha.7` for the five public packages. See the [alpha.7 release record](../releases/0.1.0-alpha.7.md).
- The sample below retains its alpha.4 validation provenance; that run was not repeated for alpha.7. Recheck the run, live-edit, and build procedure against the version you install.
- The app runtime requires `@0disoft/saylo-core`. The plugin and dev client are provided by `@0disoft/saylo-vite`; `vite` is a peer dependency whose condition is 8.

## Six files

Create the following six files in the empty folder exactly as shown. Create the `locales/ko` and `locales/en` folders first.

### package.json

```json
{
  "name": "saylo-starter",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5188 --strictPort",
    "build": "vite build",
    "preview": "vite preview --host 127.0.0.1 --port 5189 --strictPort"
  },
  "engines": { "node": "24.x" },
  "dependencies": { "@0disoft/saylo-core": "alpha" },
  "devDependencies": { "@0disoft/saylo-vite": "alpha", "vite": "8" }
}
```

### vite.config.mjs

```js
import { defineConfig } from 'vite';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({
  plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', initialLocale: 'en', timeZone: 'UTC' })],
});
```

`localesDir` is relative to the Vite root, and catalogs are located at `locales/<locale>/<namespace>.json`. `baseLocale` is the locale that defines the base schema, `initialLocale` is the locale shown on first load, and `timeZone` is the basis for formatting date and time arguments.

### index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Saylo starter</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 40rem; }
      select, input { font: inherit; padding: 0.4rem 0.6rem; }
      label { display: block; margin-top: 1rem; }
      #status { color: #555; white-space: pre-line; }
    </style>
  </head>
  <body>
    <h1 data-i18n="demo:heading"></h1>
    <select id="locale" aria-label="Locale" lang="en"></select>
    <p data-i18n="demo:greeting"></p>
    <label for="name" data-i18n="demo:nameLabel"></label>
    <input id="name" value="Saylo" autocomplete="off" />
    <p id="status" role="status" lang="ko"></p>
    <script type="module" src="/main.js"></script>
  </body>
</html>
```

Put a fully qualified key such as `demo:greeting` in `data-i18n`.

### main.js

```js
import { createStore } from '@0disoft/saylo-core';
import { connectDev } from '@0disoft/saylo-vite/client';
import { baseLocale, initialCatalogs, initialLocale, timeZone } from 'virtual:saylo';

const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale, timeZone });

const localeSelect = document.getElementById('locale');
const nameInput = document.getElementById('name');
const status = document.getElementById('status');
const nodes = [...document.querySelectorAll('[data-i18n]')];
const listeners = new AbortController();
const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: listeners.signal });

let localeList = '';
let diagnosticMessage = '';
let renderMessage = '';

function refreshStatus() {
  const message = diagnosticMessage || renderMessage;
  status.textContent = message
    ? message + '\n로케일 파일을 고치고 다시 저장한다. 마지막 정상 문구가 유지된다.'
    : import.meta.hot ? '개발 서버 연결됨' : '운영 카탈로그';
}

function render(snapshot) {
  // snapshot.t는 그 snapshot에 고정된 읽기다. 화면에는 textContent로만 쓴다.
  try {
    // 문구를 모두 계산한 뒤에 화면을 바꾼다. 계산 중 실패하면 화면은 그대로 둔다.
    const name = nameInput.value || 'Saylo';
    const translations = nodes.map(node => [node, snapshot.t(node.dataset.i18n, { name })]);
    for (const [node, text] of translations) node.textContent = text;
    const nextList = snapshot.availableLocales.join(',');
    // 로케일 목록이 실제로 바뀔 때만 options를 갈아 끼운다.
    if (nextList !== localeList) {
      localeList = nextList;
      localeSelect.replaceChildren(...snapshot.availableLocales.map(locale => {
        const option = new Option(locale, locale);
        option.lang = locale;
        return option;
      }));
    }
    localeSelect.value = snapshot.locale;
    document.documentElement.lang = snapshot.locale;
  } catch (error) {
    renderMessage = error instanceof Error ? error.message : String(error);
    refreshStatus();
    return;
  }
  const recovered = Boolean(renderMessage);
  renderMessage = '';
  if (recovered) refreshStatus();
}

// 초기 렌더가 실패해도 아래 이벤트 등록은 그대로 진행한다.
render(store.getSnapshot());
const unsubscribe = store.subscribe(render);
const disconnect = import.meta.hot ? connectDev(store, {
  hot: import.meta.hot,
  onDiagnostic: diagnostic => { diagnosticMessage = diagnostic.message || ''; refreshStatus(); },
  onUpdate: refreshStatus,
}) : () => {};

refreshStatus();
listen(localeSelect, 'change', () => store.setLocale(localeSelect.value));
listen(nameInput, 'input', () => render(store.getSnapshot()));

function cleanup() {
  disconnect();
  unsubscribe();
  listeners.abort();
  store.dispose();
}
if (import.meta.hot) import.meta.hot.dispose(cleanup);
```

`virtual:saylo` is the eager path that loads the entire base namespace at once. Call `connectDev` only when `import.meta.hot` exists, and pass the current app module's `import.meta.hot` as the option. The library default is the hot context for the package module, so specify `hot: import.meta.hot` to ensure the development connection is also cleaned up when the app module runs again. Production builds have no hot context, so `import.meta.hot` is falsy and `connectDev` is not called; the catalogs included in the bundle are used as is. This conditional separates the development connection from the production catalog path.

Write text only through `textContent`, and keep file diagnostic messages (`onDiagnostic`) and render errors in separate variables. When a render succeeds, clear only the render error; show the connection status text when both messages are empty. This keeps a file diagnostic from an earlier fix from disappearing because another file was saved or a render succeeded. `render` computes all messages before updating `textContent`, so if an exception occurs during computation, the screen keeps the last good text and the status shows the error and the fix guidance. Even if the initial render throws, event registration still proceeds.

### locales/ko/demo.json

```json
{
  "heading": "npm에서 받은 Saylo",
  "greeting": "{name}님, 로케일 JSON을 고치면 이 문구가 바로 바뀝니다.",
  "nameLabel": "이름"
}
```

### locales/en/demo.json

```json
{
  "heading": "Saylo from npm",
  "greeting": "Hi {name}, edit the locale JSON and this sentence updates.",
  "nameLabel": "Name"
}
```

The keys and arguments in the base locale `ko` form the base schema. Translation files use only keys and arguments that are present in the base.

## Run

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run dev
```

`npm install` fetches `@0disoft/saylo-core`, `@0disoft/saylo-vite`, and `vite` from the registry and uses `--ignore-scripts` so install scripts do not run. The development server starts at `http://127.0.0.1:5188`.

Installation creates `package-lock.json`. To reproduce the same versions, use `npm ci --ignore-scripts --no-audit --no-fund` with that lockfile. The `alpha` tag moves with the next publication, so when upgrading the installed version, run `npm update @0disoft/saylo-core @0disoft/saylo-vite`, confirm the installed versions with `npm ls @0disoft/saylo-core @0disoft/saylo-vite`, and recheck the run, live edit, and build steps.

The first screen uses `en` text because `initialLocale: 'en'`. The `#name` input value is substituted for `{name}` in messages, and `#locale` is populated with the locale list discovered by the plugin.

## Verify live edits

1. Enter a name in `#name`. Messages that use `{name}` change to that value.
2. Edit `greeting` in `locales/en/demo.json` and save. The development server watches the file, so only the text changes immediately; the `#name` input value and the locale selection stay as they are. The app module does not run again.
3. Create `locales/ja/demo.json` with the same keys as the base. `ja` appears in the `#locale` list, and selecting it switches to the text in that file.

A normal edit preserves the base schema, so form state is preserved. If you add a key that is not in the base or add an argument that is not in the base message, that file is not published, the last good text remains, and a diagnostic appears in `#status`. Edits that change the base schema itself, such as deleting a key or adding a required argument, are outside this preservation scope.

## Build and preview

```sh
npm run build
npm run preview
```

The build removes the parser runtime at the Saylo AST boundary (`astRuntime` defaults to `true`), so the production bundle does not include the ICU parser. It is expected for the parser to be included when the app calls `parseCatalog` directly. The preview server is at `http://127.0.0.1:5189`; it uses the catalogs from build time instead of live updates.

## Type generation (optional)

If you use only JS, this is unnecessary. To tie key and argument types together in TypeScript or checkJs, generate an `AppSchema` declaration from the base locale.

```sh
npm exec --package=@0disoft/saylo-typegen@alpha -- saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts
```

This is the form for a one-off run without installing the CLI. `latest` is a placeholder, so specify `@alpha`. For repeated runs, install with `npm install -D @0disoft/saylo-typegen@alpha` and then use `npx saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts`. Adding `typegen: { outFile: 'generated.d.ts' }` to the plugin options also generates types in the background during development. The build order is typegen → tsc → vite; because Vite build does not type-check consumer code, run tsc first.

Connect the generated types to the `createStore` generic, not to the config object. In TS, provide the generic at the call site.

```ts
import { createStore } from '@0disoft/saylo-core';
import { baseLocale, initialCatalogs, initialLocale, timeZone } from 'virtual:saylo';
import type { AppSchema } from './generated.js';

const store = createStore<AppSchema>({ catalogs: initialCatalogs, baseLocale, locale: initialLocale, timeZone });
```

JS consumers attach the JSDoc type to the variable declaration.

```js
/** @type {import('@0disoft/saylo-core').Store<import('./generated.js').AppSchema>} */
const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale, timeZone });
```

TS and checkJs consumers must add `["vite/client", "@0disoft/saylo-vite/virtual"]` to `compilerOptions.types` to see the `virtual:saylo` declaration.

## Next

- For the catalog format and the `createStore` API, see [catalog and API](03-catalog-and-api.md).
- For lazy loading and SSR, see `virtual:saylo/lazy` and `virtual:saylo/server` in the [@0disoft/saylo-vite README](../packages/vite/README.md).
- The eager path that loads everything at once and per-file failure isolation are described in [update protocol](08-update-protocol.md).
