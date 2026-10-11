# @0disoft/saylo-vite

Saylo의 Vite 8 플러그인과 개발 클라이언트다. 카탈로그 파일 변경을 감지해 앱 모듈 교체 없이 화면에 반영한다.

## 상태

마지막으로 게시를 확인한 버전은 2026-10-11의 `0.1.0-alpha.4`(dist-tag `alpha`)다. 첫 게시 버전은 2026-10-06의 `0.1.0-alpha.1`이다. 이 저장소의 workspace에서도 쓸 수 있다.

lazy 개발 경로는 full present 응답을 compact로 보내고 브라우저에서 기존 카탈로그 형태로 복원한다. 복잡한 ICU AST와 오류 위치를 유지하며 브라우저 ICU 재파싱은 없다. 이 변경은 `0.1.0-alpha.2` 게시본에 포함된다. 범위·검증·성능 측정은 [compact 전송 기록](https://github.com/0disoft/saylo/blob/main/docs/16-compact-catalog-transport.md)을 따른다.

## 설치

앱 런타임에는 `@0disoft/saylo-core`를 설치하고, 플러그인과 dev client는 개발 의존성으로 넣는다. `vite`는 peer 의존성이며 현재 조건은 Vite 8이다.

운영 SSR 빌드가 `@0disoft/saylo-vite/client`를 앱 번들에 포함하도록, 플러그인은 `@0disoft/saylo-vite` 패키지를 번들 대상(`ssr.noExternal`)으로 잡는다. 그래서 이 패키지를 운영 런타임 의존성으로 설치할 필요가 없다. 이 처리는 `0.1.0-alpha.4` 게시본에 포함된다.

```sh
npm install @0disoft/saylo-core@alpha
npm install -D @0disoft/saylo-vite@alpha vite@8
```

Saylo 패키지의 `latest`는 아직 등록용 placeholder를 가리키므로 `@alpha`를 지정한다.

## 설정

```js
// vite.config.mjs
import { defineConfig } from 'vite';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({
  plugins: [saylo({
    localesDir: 'locales',                   // Vite root 기준
    baseLocale: 'ko',
    initialNamespaces: ['demo'],             // 생략하면 기준 namespace 전체
    timeZone: 'UTC',                         // 생략하면 UTC
    typegen: { outFile: 'generated.d.ts' },  // 선택, Vite root 기준
  })],
});
```

`astRuntime`(기본 `true`)은 production build에서만 동작한다. Saylo `core/dist/formatters.js`가 `intl-messageformat`을 import할 때 그 모듈을 별도 virtual 모듈로 해석하고 의존성을 `@formatjs/icu-messageformat-parser/no-parser.js`로 바꾼다. 앱 전체 alias는 하지 않으며 외부 `IntlMessageFormat(string)`과 SSR external 의존성은 그대로다. 앱이 직접 `parseCatalog`를 호출하면 parser가 포함되는 것이 정상이고, `false`로 이 경로를 끌 수 있다. 이 옵션은 `0.1.0-alpha.2` 게시본에 포함된다.

카탈로그 파일 구조는 `locales/<locale>/<namespace>.json`이다. 예를 들어 `locales/ko/demo.json`, `locales/en/demo.json`이다.

## 빌드 완역 검사

`requireCompleteTranslations`(기본 `false`)를 켜면 Vite 운영 빌드에서 번역 키와 namespace 누락을 검사한다. `0.1.0-alpha.3`부터 제공하며 기존 `0.1.0-alpha.2` 게시본에는 포함되지 않는다.

```js
import saylo from '@0disoft/saylo-vite';

saylo({ localesDir: 'locales', baseLocale: 'ko', requireCompleteTranslations: true });
```

숨김 폴더를 제외한 로케일 폴더(빈 폴더 포함)와 `initialLocale`를 대상으로, 모든 기준 namespace·키의 존재를 확인한다. `initialNamespaces`로 초기 로딩 범위를 줄여도 검사 범위는 줄지 않는다. 폴더와 `initialLocale` 어디에도 없는 언어는 검사 대상이 아니다. 빈 번역 문자열은 존재하는 키로 인정하고 번역 문구의 언어나 인자 생략 여부는 완역 조건에 넣지 않는다. 기존 인자 타입·스키마 검사는 그대로 수행한다.

누락은 `CatalogError.diagnostics`의 `MISSING_MESSAGE`·`MISSING_NAMESPACE`로 모아 빌드를 실패시킨다. 진단에 로케일·namespace·대상 파일과 누락 키를 넣고, 없는 파일은 만들어야 할 상대 경로로 안내한다. 생성 타입 파일을 갱신하기 전에 검사하므로 실패 시 기존 파일을 유지한다. 개발 서버와 라이브 수정은 옵션을 켜도 기존 부분 번역·fallback 동작을 유지한다. 상세 범위와 검증은 [완역 검사 기록](https://github.com/0disoft/saylo/blob/main/docs/42-complete-translations.md)에 있다.

## 지연 로딩 클라이언트

`virtual:saylo/lazy`가 초기 pair와 `catalogSource`를 제공한다. 앱은 코어 `createI18n`으로 instance를 만들고 `connectDev`로 개발 서버에 연결한다. `typegen.outFile`은 Vite root 기준이라 아래 `src/i18n.ts`에서는 `../generated.js`를 import한다.

```ts
// src/i18n.ts
import { createI18n } from '@0disoft/saylo-core';
import { connectDev } from '@0disoft/saylo-vite/client';
import type { AppSchema } from '../generated.js';
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces, timeZone } from 'virtual:saylo/lazy';

export const i18n = createI18n<AppSchema>({
  catalogSource, locale: initialLocale, initialNamespaces, initialCatalogs, timeZone,
});
export const disconnect = connectDev(i18n, { catalogSource });
// 정리: disconnect(); i18n.dispose();
```

TS/checkJs 소비자는 `compilerOptions.types`에 `["vite/client", "@0disoft/saylo-vite/virtual"]`을 넣는다.

`virtual:saylo`는 전체 카탈로그를 한 번에 싣는 eager 경로다. eager store는 `virtual:saylo`의 `initialCatalogs`·`baseLocale`·`initialLocale`·`timeZone`으로 만든다.

## 동작 범위

플러그인은 파일을 감시해 정상 카탈로그만 게시하고, 클라이언트는 snapshot을 받아 앱에 전달한다. 기준 schema가 바뀌어 기존 번역이 부적합해지면 plugin이 그 파일의 last-good 번역에서 부적합 메시지만 제거해 게시하고, 빠진 메시지는 기준 로케일 값으로 fallback한다. 잘못된 번역 편집은 그 파일의 last-good을 유지하고 다른 파일 변경은 계속 반영한다. last-good이 없는 새 번역 파일은 게시하지 않고, 파일을 삭제하면 그 last-good도 지운다. 기준이나 번역이 복구되면 자동 재검증해 복원한다. 코어 `createStore`·`replaceCatalogs`는 자동 격리를 하지 않고, startup·build는 전체 카탈로그를 엄격 검증한다. 격리는 이 plugin에서만 한다. production에서는 `astRuntime`이 켜져 있으면 Saylo AST 경계의 parser 런타임이 빠지고, 앱이 직접 `parseCatalog`를 쓰면 parser가 그대로 포함된다. 코어와 store는 DOM을 직접 다루지 않으므로 화면 갱신은 앱이 snapshot을 렌더해 처리한다. Vite는 앱 모듈을 교체하지 않는다.

SSR은 `@0disoft/saylo-vite/server`와 `virtual:saylo/server`를 쓴다. 예제는 저장소의 [SSR 예제](https://github.com/0disoft/saylo/tree/main/examples/ssr)에 있다.

## 관련 패키지

- [@0disoft/saylo-core](https://github.com/0disoft/saylo/tree/main/packages/core#readme) — `createI18n`
- [@0disoft/saylo-react](https://github.com/0disoft/saylo/tree/main/packages/react#readme) — React 바인딩
- [@0disoft/saylo-typegen](https://github.com/0disoft/saylo/tree/main/packages/typegen#readme) — dev 타입 생성

## 문서

- [운영 빌드와 SSR](https://github.com/0disoft/saylo/blob/main/docs/05-build-and-ssr.md)
- [갱신 프로토콜](https://github.com/0disoft/saylo/blob/main/docs/08-update-protocol.md)
- 저장소 [README](https://github.com/0disoft/saylo#readme)

## 버전

Node.js 24.x를 지원한다. `engines.node`는 `24.x`이고 로컬 검증 환경은 Node 24.18.0이다. TypeScript 7을 기준으로 검증하며 `typescript`를 peer로 강제하지 않는다.

런타임 target은 ES2022이고 Vite 개발 서버·빌드에서 실행한다. peer 조건은 Vite 8이다.

## 라이선스

Apache-2.0이다. 배포 tarball에 저장소 루트의 `LICENSE`와 `NOTICE`를 함께 싣는다.
