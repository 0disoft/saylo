# @0disoft/saylo-vite

Saylo의 Vite 8 플러그인과 개발 클라이언트다. 카탈로그 파일 변경을 감지해 앱 모듈 교체 없이 화면에 반영한다.

## 상태

마지막으로 게시를 확인한 버전은 2026-10-11의 `0.1.0-alpha.4`(dist-tag `alpha`)다. 첫 게시 버전은 2026-10-06의 `0.1.0-alpha.1`이다. 이 저장소의 workspace에서도 쓸 수 있다.

lazy 개발 경로는 full present 응답을 compact로 보내고 브라우저에서 기존 카탈로그 형태로 복원한다. 복잡한 ICU AST와 오류 위치를 유지하며 브라우저 ICU 재파싱은 없다. 이 변경은 `0.1.0-alpha.2` 게시본에 포함된다. 범위·검증·성능 측정은 [compact 전송 기록](https://github.com/0disoft/saylo/blob/main/docs/16-compact-catalog-transport.md)을 따른다.

## 설치 폴더의 시작 안내

다음 릴리스의 tarball에는 [문서 목차](docs/README.md), JavaScript/TypeScript·React·Svelte·SvelteKit 시작 안내와 패키지 API 문서를 함께 싣는다. GitHub 로그인 없이 앱의 `node_modules/@0disoft/saylo-vite/docs/`에서 읽는다. 현재 공개 alpha.4에는 이 문서 묶음이 없고, 로컬 빌드·pack으로 준비하는 변경이다.

```sh
node -e "console.log(require('node:fs').readFileSync('node_modules/@0disoft/saylo-vite/docs/README.md', 'utf8'))"
```

묶음 안의 링크는 같이 설치한 문서를 가리킨다. `manifest.json`은 원본과 묶음의 SHA-256을 기록하며, 시작 안내의 실행 코드 블록은 원본 그대로다. 포함하지 않은 설계·측정 기록은 제목만 남긴다.

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

## 선택 빌드(includeKeys)

`includeKeys`는 빌드에서 내보낼 메시지를 정확한 `namespace:messageId` 목록으로 지정하는 옵션이다. 와일드카드는 없고, 소스 코드를 스캔해 필요한 키를 자동으로 찾아주지도 않는다. 이 옵션은 현재 로컬 checkout에만 있고, 게시본 `0.1.0-alpha.4`와 동결된 `0.1.0-alpha.5` 후보 tarball 어디에도 들어가지 않았다.

```js
// vite.config.mjs
saylo({
  localesDir: 'locales',
  baseLocale: 'ko',
  includeKeys: ['demo:heading', 'demo:greeting'],
});
```

옵션을 비우면 원본 카탈로그 전체를 그대로 내보낸다. `[]`를 주면 로케일·namespace는 그대로 두고 메시지가 0개인 카탈로그를 내보낸다. 문자열이 아니거나 콜론이 정확히 하나가 아닌 항목, 같은 목록의 중복 항목은 `saylo()`를 부를 때 바로 던진다. 기준 카탈로그에 없는 키는 빌드할 때만 확인하고, 개발 중에는 존재 여부를 검사하지 않는다. 목록은 plugin을 만들 때 복사해 동결하므로, 그 뒤 호출자가 배열을 바꿔도 빌드 설정은 바뀌지 않는다.

개발 서버 제공과 hot 갱신은 이 목록으로 거르지 않는다. 빌드에서는 원본 소스의 schema 검사(깨진 JSON·ICU, 알 수 없는 인자)와, 켜져 있으면 `requireCompleteTranslations` 완역 검사를 pruning보다 먼저 끝낸다. 그래서 키를 빼도 깨진 번역이나 빠진 번역을 숨길 수 없다. pruning은 eager `virtual:saylo`, lazy boot·chunks, `virtual:saylo/server`(SSR)에 똑같이 적용하고, 선택한 메시지가 0개인 namespace라도 로케일·namespace 목록과 누락 pair fallback 메타데이터는 유지한다. schema fingerprint는 선택한 키 기준으로 다시 계산한다.

`typegen`이 만드는 `generated.d.ts`는 의도적으로 원본 base schema 전체를 그대로 담는다. production에서 목록에서 뺀 키를 `t('omitted:key')`로 부르면 core가 `UnknownMessageError`를 던진다. `menuKey`나 데이터에서 만들어지는 키처럼 동적으로 정해지는 키는 목록에 넣거나 옵션 자체를 비워야 한다. 앱마다 자동 tree-shaking이나 성능 이득을 보장하지는 않는다.

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

## 동기화 상태

`connectDev`는 eager·lazy 두 경로 모두 `onSyncState(state)`로 개발 서버 handshake 상태를 알린다. `state`는 `{ status, attempt, maxAttempts: 3 }`인 frozen 객체이고 `status`는 `idle`·`connecting`·`retrying`·`connected`·`disconnected`·`failed`·`stopped` 중 하나다. `attempt`는 `connecting`에서 1, `retrying`에서 2·3, `failed`에서 마지막 시도값이고 나머지 상태는 0이다.

```ts
connectDev(i18n, {
  catalogSource,
  onSyncState: state => console.log(state.status, state.attempt),
});
```

이 상태는 snapshot·manifest handshake의 결과이지 개별 lazy 카탈로그 로딩이나 화면 렌더 성공 여부가 아니다. 로케일 파일 진단은 `onDiagnostic`이 계속 맡는다. lazy 경로에서 `DevCatalogSource`의 `getSyncState`·`subscribeSyncState`는 선택 메서드라서 이 API 이전에 만든 외부 source와 타입 호환이 유지된다. production에는 hot context가 없으므로 eager `connectDev`는 noop을 돌려주고 상태 콜백을 부르지 않는다. 재시도 정책은 그대로이고 요청당 기본 타임아웃은 5000ms다.

이 API는 현재 checkout과 `0.1.0-alpha.5` 후보 tarball에서 제공한다. 현재 npm 게시본 `0.1.0-alpha.4`에는 없고 후보는 아직 게시하지 않았다. 계약 상세는 [개발 동기화 상태](https://github.com/0disoft/saylo/blob/main/docs/dev-sync-state.md)에 있다.

## 동작 범위

현재 checkout에서는 `onDiagnostic`의 동기 예외가 번역 갱신·binding이나 다른 진단 구독자를 중단하지 않는다. `DevCatalogSource.subscribeManifest`의 동기 예외는 `observer`로 보고하고, 정상 manifest 수락·다른 구독자 갱신·대기 카탈로그 요청을 유지한다. lazy bridge는 stop 뒤 예약된 진단도 무시한다. 진단 콜백 자신의 오류는 같은 콜백으로 다시 보고하지 않으며, async 콜백의 rejected Promise는 소비자가 처리한다. 이 격리는 게시본 alpha.4 이후 변경으로 최종 후보 검증 대상이다.

문의용 자료는 `createSupportRecorder()`의 `onDiagnostic`·`onSyncState`를 연결하고 `getReport()`를 JSON으로 만들어 검토한다. 보고서는 최근 32개 진단 이벤트의 오류 코드·숫자 위치·연결 상태와 허용한 환경 버전만 담으며, 오류 문구·파일 이름·번역 키·요청 ID는 제외한다. 자동 수집·전송은 하지 않는다. `clear()`로 기록과 상태를 비운다. 이 API도 현재 checkout과 `0.1.0-alpha.5` 후보 tarball에서 제공하며 현재 npm 게시본 alpha.4에는 없다. 자세한 계약과 사용법은 [문의용 진단 자료](https://github.com/0disoft/saylo/blob/main/docs/support-report.md)에 있다.

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

## 문의와 보안 제보

일반 문의·기능 제안·버그는 [rodisoft1@gmail.com](mailto:rodisoft1@gmail.com)으로 보낸다. 패키지·버전, 환경, 기대한 동작과 실제 동작, 합성 데이터로 만든 최소 재현을 적는다. 보안 문제도 같은 이메일에 `Saylo security` 제목으로 비공개 제보한다. 토큰·키·쿠키·실제 사용자 데이터는 보내지 않는다.

Vite 패키지를 설치했다면 `node_modules/@0disoft/saylo-vite/docs/support.md`와 `security.md`에서 자세한 안내를 읽을 수 있다. 이 안내와 연락처 변경은 현재 checkout과 `0.1.0-alpha.5` 후보 tarball에 포함하며 기존 alpha.4 tarball에는 없다. 후보는 아직 npm에 게시하지 않았다.

## 라이선스

Apache-2.0이다. 배포 tarball에 저장소 루트의 `LICENSE`와 `NOTICE`를 함께 싣는다.
