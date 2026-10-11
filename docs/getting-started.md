# 빈 폴더에서 npm으로 Saylo 시작하기

Saylo 저장소를 clone하지 않고 npm registry만으로 Vite 8 앱에 Saylo를 붙인다. 빈 폴더에 파일 6개를 만들고 개발 서버를 띄우면, 로케일 JSON을 고치는 즉시 화면 문구가 바뀐다. 이 문서의 코드는 게시본 `0.1.0-alpha.4`의 공개 API를 `packages/*/src`와 README로 대조해 작성했다.

## 전제

- Node.js 24.x와 npm이 필요하다. 게시 패키지의 `engines.node`는 `24.x`다.
- Saylo 저장소는 private이지만 게시 패키지는 npm public registry에 있다. 저장소 clone, GitHub 로그인, `file:`·`workspace:`·alias 링크가 필요 없다.
- Saylo 패키지의 `latest` tag는 아직 등록용 placeholder다. 실제 게시본을 받으려면 설치할 때 `@alpha`를 붙인다.
- 이 문서를 대조한 게시본은 `0.1.0-alpha.4`다. alpha는 게시마다 버전이 올라가므로 새 게시본을 받으면 아래 실행·라이브 수정·빌드 절차를 그 버전에서 다시 확인한다.
- 앱 런타임에는 `@0disoft/saylo-core`가 필요하다. 플러그인과 dev client는 `@0disoft/saylo-vite`가 제공하고, `vite`는 peer 의존성이며 조건은 8이다.

## 파일 6개

빈 폴더에 아래 6개 파일을 그대로 만든다. `locales/ko`, `locales/en` 폴더를 먼저 만든다.

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

`localesDir`는 Vite root 기준이고 카탈로그 위치는 `locales/<locale>/<namespace>.json`이다. `baseLocale`은 기준 스키마를 만드는 로케일, `initialLocale`은 첫 화면 로케일, `timeZone`은 날짜·시간 인자 포맷 기준이다.

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

`data-i18n`에는 `demo:greeting` 같은 완전 키를 넣는다.

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

`virtual:saylo`는 기준 namespace 전체를 한 번에 싣는 eager 경로다. `connectDev`는 `import.meta.hot`이 있을 때만 호출하고, 옵션으로는 현재 앱 모듈의 `import.meta.hot`을 그대로 넘긴다. 라이브러리 기본값은 패키지 모듈 기준 hot context라서, 앱 모듈이 다시 실행될 때 개발 연결도 함께 정리되게 하려면 `hot: import.meta.hot`을 명시한다. 운영 빌드에는 hot context가 없어 `import.meta.hot`이 거짓이고, `connectDev`를 부르지 않아 번들에 실린 카탈로그를 그대로 쓴다. 이 조건문이 개발용 연결과 운영 카탈로그 경로를 나눈다.

문구는 `textContent`로만 쓰고, 파일 진단 메시지(`onDiagnostic`)와 렌더 오류는 서로 다른 변수에 보관한다. 렌더가 성공하면 렌더 오류만 지우고, 두 메시지가 모두 비었을 때 연결 상태 문구를 보여준다. 그래서 앞에서 고친 파일 진단이 다른 파일 저장이나 성공 렌더 때문에 사라지지 않는다. `render`는 문구를 전부 계산한 뒤에 `textContent`를 갱신하므로, 계산 중 예외가 나면 화면에는 마지막 정상 문구가 그대로 남고 상태에는 그 오류와 수정 안내가 뜬다. 초기 렌더에서 예외가 나도 이벤트 등록은 계속 진행한다.

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

기준 로케일 `ko`의 키와 인자가 기준 스키마가 된다. 번역 파일은 기준에 있는 키와 인자만 쓴다.

## 실행

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run dev
```

`npm install`은 registry에서 `@0disoft/saylo-core`, `@0disoft/saylo-vite`, `vite`를 받고 `--ignore-scripts`로 설치 스크립트를 실행하지 않는다. 개발 서버는 `http://127.0.0.1:5188`에서 뜬다.

설치하면 `package-lock.json`이 생긴다. 같은 버전을 재현하려면 그 lockfile로 `npm ci --ignore-scripts --no-audit --no-fund`를 쓴다. `alpha` tag는 다음 게시로 이동하므로, 받은 버전을 올릴 때는 `npm update @0disoft/saylo-core @0disoft/saylo-vite`를 실행하고 `npm ls @0disoft/saylo-core @0disoft/saylo-vite`로 설치 버전을 확인한 뒤 실행·라이브 수정·빌드를 다시 확인한다.

첫 화면은 `initialLocale: 'en'`이라 `en` 문구로 뜬다. `#name` 입력값은 문구의 `{name}`에 들어가고, `#locale`에는 플러그인이 찾은 로케일 목록이 들어간다.

## 라이브 수정 확인

1. `#name`에 이름을 넣는다. `{name}`을 쓰는 문구가 그 값으로 바뀐다.
2. `locales/en/demo.json`의 `greeting`을 고치고 저장한다. 개발 서버가 파일을 감시하므로 문구만 즉시 바뀌고 `#name` 입력값과 로케일 선택은 그대로 남는다. 앱 모듈은 다시 실행되지 않는다.
3. `locales/ja/demo.json`을 만들고 기준과 같은 키를 넣는다. `#locale` 목록에 `ja`가 나타나고, 고르면 그 파일의 문구로 바뀐다.

정상 편집은 기준 스키마를 유지하므로 폼 상태가 보존된다. 기준에 없는 키를 넣거나 기준 문구에 없는 인자를 추가하면 그 파일은 게시되지 않고 마지막 정상 문구가 유지되며, 진단이 `#status`에 뜬다. 키 삭제나 필수 인자 추가처럼 기준 스키마 자체를 바꾸는 편집은 이 보존 범위 밖이다.

## 빌드와 미리보기

```sh
npm run build
npm run preview
```

빌드는 Saylo AST 경계에서 parser 런타임을 제거하므로(`astRuntime` 기본값 `true`) 운영 번들에 ICU parser가 실리지 않는다. 앱이 `parseCatalog`를 직접 호출하면 parser가 포함되는 것이 정상이다. 미리보기는 `http://127.0.0.1:5189`이고, 여기서는 라이브 갱신 대신 빌드 시점의 카탈로그가 쓰인다.

## 타입 생성 (선택)

JS로만 쓰면 필요 없다. TypeScript나 checkJs에서 키와 인자 타입을 묶으려면 기준 로케일에서 `AppSchema` 선언을 만든다.

```sh
npm exec --package=@0disoft/saylo-typegen@alpha -- saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts
```

CLI를 설치하지 않고 한 번만 돌릴 때 쓰는 형태다. `latest`가 placeholder이므로 `@alpha`를 명시한다. 반복 실행한다면 `npm install -D @0disoft/saylo-typegen@alpha`로 설치한 뒤 `npx saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts`를 쓴다. 플러그인 옵션에 `typegen: { outFile: 'generated.d.ts' }`를 넣으면 dev 중 배경에서도 생성된다. 빌드 순서는 typegen → tsc → vite이고, Vite build는 소비자 타입 검사를 하지 않으므로 tsc를 앞에 둔다.

생성 타입은 설정 객체가 아니라 `createStore`의 제네릭에 연결한다. TS는 호출에 제네릭을 준다.

```ts
import { createStore } from '@0disoft/saylo-core';
import { baseLocale, initialCatalogs, initialLocale, timeZone } from 'virtual:saylo';
import type { AppSchema } from './generated.js';

const store = createStore<AppSchema>({ catalogs: initialCatalogs, baseLocale, locale: initialLocale, timeZone });
```

JS는 변수 선언에 JSDoc 타입을 붙인다.

```js
/** @type {import('@0disoft/saylo-core').Store<import('./generated.js').AppSchema>} */
const store = createStore({ catalogs: initialCatalogs, baseLocale, locale: initialLocale, timeZone });
```

TS/checkJs 소비자는 `compilerOptions.types`에 `["vite/client", "@0disoft/saylo-vite/virtual"]`을 넣어야 `virtual:saylo` 선언을 본다.

## 다음

- 카탈로그 형식과 `createStore` API는 [카탈로그와 API](03-catalog-and-api.md)를 따른다.
- 지연 로딩·SSR은 [@0disoft/saylo-vite README](../packages/vite/README.md)의 `virtual:saylo/lazy`와 `virtual:saylo/server`를 본다.
- 전체를 한 번에 싣는 eager 경로와 파일 단위 실패 격리는 [갱신 프로토콜](08-update-protocol.md)에 정리돼 있다.
