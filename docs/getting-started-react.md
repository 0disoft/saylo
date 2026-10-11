# 빈 폴더에서 React로 Saylo 시작하기

Saylo 저장소를 clone하지 않고 npm registry만으로 Vite 8 + React 19 앱에 Saylo를 붙인다. 빈 폴더에 파일 8개를 만들고 개발 서버를 띄우면, 로케일 JSON을 고치는 즉시 문구가 바뀌고 폼·모달 상태는 그대로 남는다. 이 문서는 게시본 `0.1.0-alpha.4`의 공개 API만 쓴다. 로컬 미게시 API(`onSyncState`, 문의용 진단 보고서)는 쓰지 않는다.

## 전제

- Node.js 24.x와 npm이 필요하다. 게시 패키지의 `engines.node`는 `24.x`다.
- Saylo 저장소는 private이지만 게시 패키지는 npm public registry에 있다. clone, GitHub 로그인, `file:`·`workspace:`·alias 링크가 필요 없다.
- Saylo 패키지의 `latest`는 등록용 placeholder다. 설치할 때 `@alpha`를 붙인다.
- React는 peer이고 조건은 19, Vite는 `@0disoft/saylo-vite`의 peer이며 조건은 8이다.
- 대조한 게시본은 `0.1.0-alpha.4`다. alpha는 게시마다 올라가므로 새 게시본에서는 아래 절차를 다시 확인한다.

## 파일 8개

빈 폴더에 아래 8개 파일을 만든다. `locales/ko`, `locales/en` 폴더를 먼저 만든다.

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

React 플러그인은 넣지 않는다. Vite가 TSX를 변환하고 JSX 런타임은 아래 tsconfig의 `react-jsx`를 따른다.

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

`localesDir`는 Vite root 기준이고 카탈로그는 `locales/<locale>/<namespace>.json`이다. `baseLocale`은 기준 스키마, `initialLocale`은 첫 화면 로케일, `timeZone`은 날짜·시간 인자 포맷 기준이다.

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

`types`에 `@0disoft/saylo-vite/virtual`을 넣어야 `virtual:saylo` 선언을 본다. `jsx: react-jsx`가 자동 런타임을 켜므로 React를 import하지 않아도 된다.

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

화면 요소는 React가 만들고 `index.html`은 mount 지점만 제공한다.

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
    <>
      <h1 id="heading">{text.heading}</h1>
      <select id="locale" aria-label="Locale" value={snapshot.locale}
        onChange={event => snapshot.setLocale(event.target.value)}>
        {snapshot.availableLocales.map(locale => <option key={locale} value={locale}>{locale}</option>)}
      </select>
      <p id="greeting">{text.greeting}</p>
      <label htmlFor="name">{text.nameLabel}</label>
      <input id="name" value={name} autoComplete="off" onChange={event => setName(event.target.value)} />
      <label htmlFor="note">{text.noteLabel}</label>
      <textarea id="note" value={note} onChange={event => setNote(event.target.value)} />
      <button id="open-dialog" type="button" onClick={openDialog}>{text.openDialog}</button>
      <p id="error" role="alert">{diagnostic}</p>
      <p id="render-error" role="alert">{presentation.error}</p>
      <dialog ref={dialogRef} id="confirmation" aria-labelledby="dialog-title">
        <h2 id="dialog-title">{text.dialogTitle}</h2>
        <p id="dialog-status" role="status">{diagnostic}</p>
        <p id="dialog-render-error" role="alert">{presentation.error}</p>
        <label htmlFor="dialog-note">{text.noteLabel}</label>
        <textarea id="dialog-note" value={note} onChange={event => setNote(event.target.value)} />
        <button id="close-dialog" type="button" onClick={closeDialog}>{text.closeDialog}</button>
      </dialog>
    </>
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

`createStore`는 `virtual:saylo`가 넘긴 eager 카탈로그로 만든다. `useI18n`은 그 렌더의 불변 snapshot과 `setLocale`을 돌려주고, eager store의 `setLocale`은 `void`라 Promise 처리가 필요 없다. store 구독은 react 패키지가 맡으므로 앱은 `store.subscribe`를 직접 걸지 않는다.

`name`·`note`는 React state다. 카탈로그가 갱신돼도 컴포넌트가 다시 mount되지 않으므로 입력값과 열어 둔 모달이 남는다. `#dialog-note`는 `#note`와 같은 state를 쓰고, 진단 문자열은 `#error`(`role="alert"`)와 모달 안 `#dialog-status`(`role="status"`)에 함께 보인다.

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
  try { return { messages: read(snapshot, name), accepted: snapshot, error: '' }; }
  catch (error) {
    let messages = {
      heading: '번역을 준비하세요.', greeting: `이름: ${name}`,
      nameLabel: '이름', noteLabel: '메모', openDialog: '확인 창 열기', closeDialog: '닫기', dialogTitle: '메모 확인',
    };
    // Snapshot translators are immutable. Reformat the previous translation
    // with the current input instead of freezing the previous greeting.
    if (previous) { try { messages = read(previous, name); } catch { /* Keep the setup view. */ } }
    const message = error instanceof Error ? error.message : String(error);
    return { messages, accepted: undefined,
      error: `${message}\nlocales/ko/demo.json의 키·인자를 확인하고 저장하세요. 입력은 유지됩니다.` };
  }
}
```

컴포넌트에 번역을 넘기기 전에 필요한 문구를 전부 계산한다. 키가 삭제되거나 기준 카탈로그가 비면 마지막 정상 snapshot으로 현재 이름을 다시 보간하고, 처음부터 번역이 없으면 수정 안내와 입력 화면을 표시한다. snapshot은 컴포넌트별로 보관하므로 다른 화면의 번역을 공유하지 않는다.

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

기준 로케일 `ko`의 키와 인자가 기준 스키마가 된다. 번역 파일은 기준에 있는 키와 인자만 쓴다.

## 실행

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run dev
```

개발 서버는 `http://127.0.0.1:5193`에서 뜬다. `initialLocale: 'en'`이라 첫 화면은 `en` 문구로 뜬다. `#heading`은 `Saylo React starter`, `#greeting`은 `#name` 값으로 `Hello {name}`, `#locale`에는 플러그인이 찾은 로케일 목록이 들어간다.

## 라이브 수정 확인

1. `#name`에 이름을 넣고 `#note`에 메모를 적고 `#open-dialog`로 모달을 연다.
2. `locales/en/demo.json`의 `greeting`을 `"Updated {name}"`으로 고치고 저장한다. 문구만 즉시 바뀌고 이름·메모 입력값과 열어 둔 모달은 그대로 남는다.
3. `locales/ja/demo.json`을 기준과 같은 키로 만든다.

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

`#locale` 목록에 `ja`가 나타나고, 고르면 `#heading`이 `Saylo React 日本語`, `#greeting`이 `こんにちは {name}`이 된다.

4. `locales/en/demo.json`의 `greeting`을 `"{name"` 처럼 ICU가 깨진 값으로 저장하면 그 파일은 게시되지 않고 마지막 정상 문구가 유지되며 `#error`에 진단이 뜬다. 값을 되돌리면 진단이 해제된다.

5. `locales/ko/demo.json`에서 `greeting` 키를 지우거나 파일 내용을 `{}`로 바꾸면 `#render-error`와 열린 모달에 수정 안내가 뜬다. 입력값과 마지막 정상 번역은 유지되고, 이름을 고치면 이전 번역으로 새 이름을 보간한다. 키를 복원하면 안내가 해제된다.
6. ko/en 파일이 처음부터 `{}`인 상태로 개발 서버를 켜면 번역 준비 안내와 입력 화면이 나온다. 파일을 채워 저장하면 입력을 유지한 채 번역 화면으로 복구된다.

기준에 없는 키나 인자는 기존 카탈로그 진단으로 처리하고, 기준 키 삭제·빈 카탈로그로 생긴 렌더 실패는 `projectMessages`가 처리한다. 새로운 키·인자를 쓰려면 앱 호출부와 타입도 함께 갱신한다.

## 빌드와 미리보기

```sh
npm run build
npm run preview
```

`build`는 `tsc --noEmit`으로 타입을 검사한 뒤 Vite 생산 빌드를 만든다. 빌드는 Saylo AST 경계에서 parser 런타임을 제거하므로(`astRuntime` 기본값 `true`) 운영 번들에 ICU parser가 실리지 않는다. 미리보기는 `http://127.0.0.1:5194`이고 라이브 갱신 대신 빌드 시점 카탈로그를 쓴다.

## 타입 생성 (선택)

`AppSchema`를 손으로 적어도 된다. 자동 생성은 typegen을 한 번 돌린다.

```sh
npm exec --package=@0disoft/saylo-typegen@alpha -- saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts
```

`latest`가 placeholder이므로 `@alpha`를 명시한다. 생성 타입은 `createStore<AppSchema>`의 제네릭에 연결한다. 새 키를 추가하거나 인자를 바꾸면 스키마와 typegen이 함께 갱신돼야 타입이 맞고, `greeting` 값만 바꾸는 편집은 스키마를 바꾸지 않으므로 타입 컴파일을 기다리지 않고 반영된다.

## 다음

- 카탈로그 형식과 `createStore` API는 [카탈로그와 API](03-catalog-and-api.md)를 따른다.
- `useI18n`·`useI18nSelector`와 Provider 계약은 [@0disoft/saylo-react README](../packages/react/README.md)에 있다.
- 지연 로딩·SSR은 [@0disoft/saylo-vite README](../packages/vite/README.md)의 `virtual:saylo/lazy`와 `virtual:saylo/server`를 본다.

