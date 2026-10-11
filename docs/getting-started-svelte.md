# 빈 폴더에서 Svelte로 Saylo 시작하기

Saylo 저장소를 clone하지 않고 npm registry만으로 Vite 8 + Svelte 5 앱에 Saylo를 붙인다. 빈 폴더에 파일 9개를 만들고 개발 서버를 띄우면, 로케일 JSON을 고치는 즉시 문구가 바뀌고 폼·모달 상태는 그대로 남는다. 이 문서는 게시본 `0.1.0-alpha.4`의 공개 API만 쓴다. 로컬 미게시 API(`onSyncState`, 문의용 진단 보고서)는 쓰지 않는다.

## 전제

- Node.js 24.x와 npm이 필요하다. 게시 패키지의 `engines.node`는 `24.x`다.
- Saylo 저장소는 private이지만 게시 패키지는 npm public registry에 있다. clone, GitHub 로그인, `file:`·`workspace:`·alias 링크가 필요 없다.
- Saylo 패키지의 `latest`는 등록용 placeholder다. 설치할 때 `@alpha`를 붙인다.
- Svelte는 peer이고 조건은 5, Vite는 `@0disoft/saylo-vite`의 peer이며 조건은 8이다.
- 대조한 게시본은 `0.1.0-alpha.4`다. alpha는 게시마다 올라가므로 새 게시본에서는 아래 절차를 다시 확인한다.

## 파일 9개

빈 폴더에 아래 9개 파일을 만든다. `locales/ko`, `locales/en` 폴더를 먼저 만든다.

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

빌드 앞단의 `svelte-check`가 `.svelte`와 `.ts`를 함께 검사한다. 이 예제는 `svelte-check` 4의 peer 범위에 맞춰 TypeScript 6을 사용한다. TypeScript 7로 올릴 때는 검사 도구의 호환 범위를 먼저 확인한다.

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

`localesDir`는 Vite root 기준이고 카탈로그는 `locales/<locale>/<namespace>.json`이다. `baseLocale`은 기준 스키마, `initialLocale`은 첫 화면 로케일, `timeZone`은 날짜·시간 인자 포맷 기준이다.

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

`types`에 `@0disoft/saylo-vite/virtual`을 넣어야 `virtual:saylo` 선언을 본다. `include`가 `.svelte`를 포함해야 `svelte-check`가 컴포넌트 타입을 읽는다.

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

화면 요소는 Svelte가 만들고 `index.html`은 mount 지점만 제공한다.

### i18n.ts

```ts
import { createStore } from '@0disoft/saylo-core';
import { createSvelteStore } from '@0disoft/saylo-svelte';
import { baseLocale, initialCatalogs, initialLocale, timeZone } from 'virtual:saylo';

// 기준 로케일에서 만든 스키마. saylo-typegen이 같은 형태를 생성한다.
type AppSchema = {
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

`store`와 어댑터 스토어 `i18n`을 모듈에서 한 번만 만든다. `i18n`은 Svelte `Readable`이라 템플릿에서 `$i18n`으로 자동 구독한다.

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

entry가 mount와 store 수명을 소유한다. 정리할 때 `unmount`가 끝난 뒤 `store.dispose()`를 부르고, `cleanup`은 이름 붙인 `pagehide` 핸들러를 떼어 idempotent하게 둔다. `pagehide`의 `persisted`가 true면 정리하지 않고, false일 때만 정리한다.

### App.svelte

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { connectDev } from '@0disoft/saylo-vite/client';
  import type { LiveDiagnostic } from '@0disoft/saylo-vite/client';
  import { i18n, store } from './i18n';

  let name = $state('Saylo');
  let note = $state('');
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

<h1 id="heading">{$i18n.t('demo:heading')}</h1>
<select id="locale" aria-label="Locale" value={$i18n.locale}
  onchange={event => store.setLocale(event.currentTarget.value)}>
  {#each $i18n.availableLocales as locale (locale)}
    <option value={locale}>{locale}</option>
  {/each}
</select>
<p id="greeting">{$i18n.t('demo:greeting', { name })}</p>
<label for="name">{$i18n.t('demo:nameLabel')}</label>
<input id="name" autocomplete="off" bind:value={name} />
<label for="note">{$i18n.t('demo:noteLabel')}</label>
<textarea id="note" bind:value={note}></textarea>
<button id="open-dialog" type="button" onclick={() => dialog?.showModal()}>{$i18n.t('demo:openDialog')}</button>
<p id="error" role="alert">{diagnostic}</p>
<dialog id="confirmation" aria-labelledby="dialog-title" bind:this={dialog}>
  <h2 id="dialog-title">{$i18n.t('demo:dialogTitle')}</h2>
  <p id="dialog-status" role="status">{diagnostic}</p>
  <label for="dialog-note">{$i18n.t('demo:noteLabel')}</label>
  <textarea id="dialog-note" bind:value={note}></textarea>
  <button id="close-dialog" type="button" onclick={() => dialog?.close()}>{$i18n.t('demo:closeDialog')}</button>
</dialog>
```

`dialog`은 `HTMLDialogElement | undefined`로 두고 `bind:this`로 받는다. `dialog?.showModal()`·`dialog?.close()`로 native dialog를 다루면 class cast 없이 타입이 맞는다. eager store의 `setLocale`은 `void`라 Promise 처리가 필요 없다.

`name`·`note`는 `$state`다. 카탈로그가 갱신돼도 컴포넌트가 다시 mount되지 않으므로 입력값·포커스와 열어 둔 모달이 그대로 남는다. `#dialog-note`는 `#note`와 같은 state를 쓰고, 진단 문자열은 `#error`(`role="alert"`)와 모달 안 `#dialog-status`(`role="status"`)에 함께 보인다. 번역은 plain text로만 그리므로 `{@html}`을 쓰지 않는다.

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

기준 로케일 `ko`의 키와 인자가 기준 스키마가 된다. 번역 파일은 기준에 있는 키와 인자만 쓴다.

## 실행

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run dev
```

개발 서버는 `http://127.0.0.1:5195`에서 뜬다. `initialLocale: 'en'`이라 첫 화면은 `en` 문구로 뜬다. `#heading`은 `Saylo Svelte starter`, `#greeting`은 `#name` 값으로 `Hello {name}`, `#locale`에는 플러그인이 찾은 로케일 목록이 들어간다.

## 라이브 수정 확인

1. `#name`에 이름을 넣고 `#note`에 메모를 적고 `#open-dialog`로 모달을 연다.
2. `locales/en/demo.json`의 `greeting`을 `"Updated {name}"`으로 고치고 저장한다. 문구만 즉시 바뀌고 이름·메모 입력값과 열어 둔 모달은 그대로 남는다.
3. `locales/ja/demo.json`을 기준과 같은 키로 만든다.

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

`#locale` 목록에 `ja`가 나타나고, 고르면 `#heading`이 `Saylo Svelte 日本語`, `#greeting`이 `こんにちは {name}`이 된다.

4. `locales/en/demo.json`의 `greeting`을 `"{name"` 처럼 ICU가 깨진 값으로 저장하면 그 파일은 게시되지 않고 마지막 정상 문구가 유지되며 `#error`에 진단이 뜬다. 값을 되돌리면 진단이 해제된다.

정상 편집은 기준 스키마를 유지하므로 폼·모달 상태와 포커스가 보존된다. 기준에 없는 키나 인자를 넣으면 그 파일은 게시되지 않고 진단이 뜬다. 키 삭제나 필수 인자 추가처럼 기준 스키마 자체를 바꾸는 편집은 이 보존 범위 밖이고, 그런 편집의 안전 처리는 향후 범위다.

## 빌드와 미리보기

```sh
npm run build
npm run preview
```

`build`는 `svelte-check`로 타입을 검사한 뒤 Vite 생산 빌드를 만든다. 빌드는 Saylo AST 경계에서 parser 런타임을 제거하므로(`astRuntime` 기본값 `true`) 운영 번들에 ICU parser가 실리지 않는다. 미리보기는 `http://127.0.0.1:5196`이고 라이브 갱신 대신 빌드 시점 카탈로그를 쓴다.

## 타입 생성 (선택)

`i18n.ts`의 `AppSchema`를 손으로 적어도 된다. 자동 생성은 typegen을 한 번 돌린다.

```sh
npm exec --package=@0disoft/saylo-typegen@alpha -- saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts
```

`latest`가 placeholder이므로 `@alpha`를 명시한다. 생성 타입을 쓰려면 `i18n.ts`의 손으로 적은 `type AppSchema = {...}`를 지우고 첫 줄에 아래 한 줄을 넣는다.

```ts
import type { AppSchema } from './generated';
```

생성 타입은 설정이 아니라 `createStore<AppSchema>`의 제네릭에 연결한다. 새 키를 추가하거나 인자를 바꾸면 스키마와 typegen이 함께 갱신돼야 타입이 맞고, `greeting` 값만 바꾸는 편집은 스키마를 바꾸지 않으므로 타입 컴파일을 기다리지 않고 반영된다.

## 다음

- 카탈로그 형식과 `createStore` API는 [카탈로그와 API](03-catalog-and-api.md)를 따른다.
- `createSvelteStore`와 `$i18n`, selector 구독은 [@0disoft/saylo-svelte README](../packages/svelte/README.md)에 있다.
- 지연 로딩·SSR은 [@0disoft/saylo-vite README](../packages/vite/README.md)의 `virtual:saylo/lazy`와 `virtual:saylo/server`를 본다.
- React 경로는 [빈 폴더에서 React로 시작하기](getting-started-react.md)에 있다.

