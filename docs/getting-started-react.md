# Start Saylo with React from an empty folder

This guide adds Saylo to a Vite 8 + React 19 app using only the npm registry, without cloning the Saylo repository. Create eight files in an empty folder and start the development server; the text changes as soon as you edit the locale JSON, and form and modal state stay as they are. This document uses only the public API of the published `0.1.0-alpha.4`. It does not use unpublished local APIs (`onSyncState` or the diagnostic support report).

To export a separate React starter from a Saylo repository clone into an empty folder outside the repository using a local unpublished tarball, see [examples/react-starter/README.md](../examples/react-starter/README.md).

## Prerequisites

- Node.js 24.x and npm are required. `engines.node` in the published package is `24.x`.
- Saylo packages are available on the public npm registry. You do not need to clone the repository, sign in to GitHub, or use `file:`, `workspace:`, or alias links.
- The `latest` tag for the Saylo packages is a placeholder for registration. Add `@alpha` when installing.
- React is a peer dependency whose condition is 19, and Vite is a peer dependency of `@0disoft/saylo-vite` whose condition is 8.
- The published build checked against this document is `0.1.0-alpha.4`. Each alpha publication increases the version, so recheck the procedure below against a new build.

## Eight files

Create the following eight files in the empty folder. Create the `locales/ko` and `locales/en` folders first.

### package.json

```json
{
  "name": "saylo-react-starter",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "engines": { "node": "24.x" },
  "dependencies": {
    "@0disoft/saylo-core": "alpha",
    "@0disoft/saylo-react": "alpha",
    "react": "19",
    "react-dom": "19"
  },
  "devDependencies": {
    "@0disoft/saylo-vite": "alpha",
    "@types/node": "24",
    "@types/react": "19",
    "@types/react-dom": "19",
    "typescript": "7",
    "vite": "8"
  }
}
```

Do not add the React plugin. Vite transforms TSX, and the JSX runtime follows `react-jsx` in the tsconfig below.

### vite.config.mjs

```js
import { defineConfig } from 'vite';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({
  plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', initialLocale: 'en', timeZone: 'UTC' })],
  server: { host: '127.0.0.1', port: 5193, strictPort: true },
  preview: { host: '127.0.0.1', port: 5194, strictPort: true },
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
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "@0disoft/saylo-vite/virtual"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["main.tsx"]
}
```

You must add `@0disoft/saylo-vite/virtual` to `types` to see the `virtual:saylo` declaration. `jsx: react-jsx` enables the automatic runtime, so importing React is not required.

### index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Saylo React starter</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

React creates the screen elements, and `index.html` only provides the mount point.

### main.tsx

```tsx
import { StrictMode, useEffect, useRef, useMemo, useSyncExternalStore, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';
import { connectDev } from '@0disoft/saylo-vite/client';
import type { LiveDiagnostic } from '@0disoft/saylo-vite/client';
import { baseLocale, initialCatalogs, initialLocale, timeZone } from 'virtual:saylo';
import { projectMessages } from './demo-messages';

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

// store와 factory는 모듈 스코프에서 한 번만 만든다.
export const store = createStore<AppSchema>({ catalogs: initialCatalogs, baseLocale, locale: initialLocale, timeZone });
export const { SayloProvider, useI18n } = createSayloReact<AppSchema>();

// 진단 문자열은 store snapshot 밖에서 온다. 작은 외부 저장소로 구독한다.
let diagnosticMessage = '';
const diagnosticListeners = new Set<() => void>();
const readDiagnostic = () => diagnosticMessage;
function publishDiagnostic(message: string) {
  diagnosticMessage = message;
  for (const listener of diagnosticListeners) listener();
}
function subscribeDiagnostic(listener: () => void) {
  diagnosticListeners.add(listener);
  return () => { diagnosticListeners.delete(listener); };
}
function formatDiagnostic(diagnostic: LiveDiagnostic) {
  // 서버가 파일을 복구하면 빈 message/diagnostics를 보낸다. 그때 문자열이 비워진다.
  if (diagnostic.diagnostics.length) {
    return diagnostic.diagnostics.map(row => row.sourceName + (row.id ? ' [' + row.id + ']' : '') + ': ' + row.message).join('\n');
  }
  return diagnostic.message;
}

function App() {
  const snapshot = useI18n();
  const [name, setName] = useState('Saylo');
  const [note, setNote] = useState('');
  const lastRendered = useRef<ReturnType<typeof store.getSnapshot> | undefined>(undefined);
  const presentation = useMemo(() => projectMessages(snapshot, lastRendered.current, name), [snapshot, name]);
  const text = presentation.messages;
  // Only a successful committed render can become the fallback.
  useEffect(() => { if (presentation.accepted) lastRendered.current = presentation.accepted; }, [presentation]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const diagnostic = useSyncExternalStore(subscribeDiagnostic, readDiagnostic);

  // 문서 lang은 그 렌더의 locale을 따른다.
  useEffect(() => { document.documentElement.lang = snapshot.locale; }, [snapshot.locale]);

  const openDialog = () => dialogRef.current?.showModal();
  const closeDialog = () => dialogRef.current?.close();

  return (
    <main lang={presentation.locale}>
      <h1 id="heading">{text.heading}</h1>
      <select id="locale" aria-label="Locale" lang="en" value={snapshot.locale}
        onChange={event => snapshot.setLocale(event.target.value)}>
        {snapshot.availableLocales.map(locale => <option key={locale} value={locale} lang={locale}>{locale}</option>)}
      </select>
      <p id="greeting">{text.greeting}</p>
      <label htmlFor="name">{text.nameLabel}</label>
      <input id="name" value={name} autoComplete="off" onChange={event => setName(event.target.value)} />
      <label htmlFor="note">{text.noteLabel}</label>
      <textarea id="note" value={note} onChange={event => setNote(event.target.value)} />
      <button id="open-dialog" type="button" onClick={openDialog}>{text.openDialog}</button>
      <p id="error" role="alert" lang="en">{diagnostic}</p>
      <p id="render-error" role="alert" lang="ko">{presentation.error}</p>
      <dialog ref={dialogRef} id="confirmation" aria-labelledby="dialog-title">
        <h2 id="dialog-title">{text.dialogTitle}</h2>
        <p id="dialog-status" role="status" lang="en">{diagnostic}</p>
        <p id="dialog-render-error" role="alert" lang="ko">{presentation.error}</p>
        <label htmlFor="dialog-note">{text.noteLabel}</label>
        <textarea id="dialog-note" value={note} onChange={event => setNote(event.target.value)} />
        <button id="close-dialog" type="button" onClick={closeDialog}>{text.closeDialog}</button>
      </dialog>
    </main>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<StrictMode><SayloProvider instance={store}><App /></SayloProvider></StrictMode>);

// 개발 연결은 entry가 소유한다. 운영 빌드에는 hot context가 없어 연결하지 않는다.
const disconnect = import.meta.hot
  ? connectDev(store, { hot: import.meta.hot, onDiagnostic: diagnostic => publishDiagnostic(formatDiagnostic(diagnostic)) })
  : () => {};

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  window.removeEventListener('pagehide', pagehide);
  root.unmount();
  disconnect();
  store.dispose();
}
function pagehide(event: PageTransitionEvent) { if (!event.persisted) cleanup(); }
window.addEventListener('pagehide', pagehide);
if (import.meta.hot) import.meta.hot.dispose(cleanup);
```

`createStore` is created with the eager catalogs passed by `virtual:saylo`. `useI18n` returns the immutable snapshot for that render and `setLocale`; `setLocale` on an eager store returns `void`, so no Promise handling is needed. The React package manages the store subscription, so the app does not call `store.subscribe` directly.

`name` and `note` are React state. When the catalog updates, the component does not mount again, so input values and an open modal remain. `#dialog-note` uses the same state as `#note`, and diagnostic strings appear in both `#error` (`role="alert"`) and `#dialog-status` (`role="status"`) inside the modal.

### demo-messages.ts

```ts
import type { StoreSnapshot } from '@0disoft/saylo-core';
import type { AppSchema } from './main';

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
  "heading": "Saylo React 시작",
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
  "heading": "Saylo React starter",
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

The development server starts at `http://127.0.0.1:5193`. Because `initialLocale: 'en'`, the first screen uses `en` text. `#heading` is `Saylo React starter`, `#greeting` uses the `#name` value to produce `Hello {name}`, and `#locale` is populated with the locale list discovered by the plugin.

## Verify live edits

1. Enter a name in `#name`, write a note in `#note`, and open the modal with `#open-dialog`.
2. Change `greeting` in `locales/en/demo.json` to `"Updated {name}"` and save. Only the text changes immediately; the name and note input values and the open modal stay as they are.
3. Create `locales/ja/demo.json` with the same keys as the base.

```json
{
  "heading": "Saylo React 日本語",
  "greeting": "こんにちは {name}",
  "nameLabel": "名前",
  "noteLabel": "メモ",
  "openDialog": "確認を開く",
  "closeDialog": "閉じる",
  "dialogTitle": "メモの確認"
}
```

`ja` appears in the `#locale` list; selecting it changes `#heading` to `Saylo React 日本語` and `#greeting` to `こんにちは {name}`.

4. If you save `greeting` in `locales/en/demo.json` with an ICU-broken value such as `"{name"`, that file is not published, the last good text remains, and a diagnostic appears in `#error`. Restoring the value clears the diagnostic.

5. If you delete the `greeting` key from `locales/ko/demo.json` or replace the file contents with `{}`, fix guidance appears in `#render-error` and in the open modal. Input values and the last good translation remain, and changing the name interpolates the new name using the previous translation. Restoring the key clears the guidance.
6. If you start the development server with both ko/en files at `{}`, the translation setup guidance and input screen appear. After you fill in the files and save, the app recovers to the translated screen while preserving input.

Keys or arguments that are not in the base are handled by existing catalog diagnostics, and render failures caused by deleting a base key or by an empty catalog are handled by `projectMessages`. To use a new key or argument, update the app call site and the types together.

## Build and preview

```sh
npm run build
npm run preview
```

`build` checks types with `tsc --noEmit` and then creates a Vite production build. The build removes the parser runtime at the Saylo AST boundary (`astRuntime` defaults to `true`), so the production bundle does not include the ICU parser. The preview server is at `http://127.0.0.1:5194` and uses build-time catalogs instead of live updates.

## Type generation (optional)

You can write `AppSchema` by hand. For automatic generation, run typegen once.

```sh
npm exec --package=@0disoft/saylo-typegen@alpha -- saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts
```

`latest` is a placeholder, so specify `@alpha`. Connect generated types to the `createStore<AppSchema>` generic. Adding a new key or changing an argument requires updating both the schema and typegen; editing only the `greeting` value does not change the schema, so it is applied without waiting for a type compile.

## Next

- For the catalog format and the `createStore` API, see [catalog and API](03-catalog-and-api.md).
- For `useI18n`, `useI18nSelector`, and the Provider contract, see the [@0disoft/saylo-react README](../packages/react/README.md).
- For lazy loading and SSR, see `virtual:saylo/lazy` and `virtual:saylo/server` in the [@0disoft/saylo-vite README](../packages/vite/README.md).

