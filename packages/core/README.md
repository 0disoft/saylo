# @0disoft/saylo-core

Saylo 코어 패키지다. 카탈로그 파싱과 스키마 검증, 동기 번역기, eager store, 지연 로딩 i18n, SSR boot 직렬화를 제공한다. DOM이나 특정 프레임워크에 의존하지 않는다.

## 상태

마지막으로 게시를 확인한 버전은 2026-10-09의 `0.1.0-alpha.3`(dist-tag `alpha`)다. 첫 게시 버전은 2026-10-06의 `0.1.0-alpha.1`이다. 이 저장소의 workspace에서 쓰거나 `npm pack`으로 만든 tarball을 설치할 수도 있다.

React·Svelte selector 미세구독(`useI18nSelector`, `selectSvelteStore`·`getI18nSelector`)은 저장소 checkout에만 있고 아직 게시본에는 없다.

## 설치

```sh
npm install @0disoft/saylo-core@alpha
```

`latest`는 아직 등록용 placeholder를 가리키므로 `@alpha`를 지정한다. 앱 런타임 의존성(`dependencies`)으로 설치한다.

## 사용

`parseCatalog`로 로케일별 카탈로그를 파싱하고 `createStore`로 즉시 쓸 수 있는 store를 만든다.

```js
import { parseCatalog, createStore } from '@0disoft/saylo-core';

const base = parseCatalog('{"items":"{count, number}개"}', {
  locale: 'ko', namespace: 'cart', sourceName: 'locales/ko/cart.json',
});
const translation = parseCatalog('{"items":"{count, plural, one {# item} other {# items}}"}', {
  locale: 'en', namespace: 'cart', sourceName: 'locales/en/cart.json',
});

const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs: [base, translation] });

store.t('cart:items', { count: 3 });                 // "3 items"
store.getSnapshot().t('cart:items', { count: 1 });   // snapshot에 고정된 읽기
store.setLocale('ko');
store.dispose();
```

메시지는 ICU MessageFormat이다. `{count, number}` 같은 변수는 호출 인자로 채운다. 기준 스키마에 없는 키는 `UnknownMessageError`, 인자 누락이나 타입 오류는 `InvalidArgumentError`다. 없는 번역은 기준 로케일 문구로 폴백한다. `createStore`는 카탈로그를 게시 전에 검증하고, 표시 상태가 같으면 `getSnapshot()`이 같은 객체를 돌려준다.

`store.subscribe(snapshot => ...)`로 변경을 구독하고 `onDispose(cleanup)`으로 소유 자원 정리를 등록한다. 더 이상 쓰지 않으면 `store.dispose()`를 호출한다.

TypeScript에서는 `createStore<AppSchema>(...)`로, JS에서는 JSDoc `Store<AppSchema>`로 키와 인자 타입을 연결한다. `AppSchema`는 [@0disoft/saylo-typegen](https://github.com/0disoft/saylo/tree/main/packages/typegen#readme)으로 생성하거나 직접 작성한다. 타입을 지정하지 않아도 동작한다.

지연 로딩은 `createI18n`이 담당하고 카탈로그 전송 source는 [@0disoft/saylo-vite](https://github.com/0disoft/saylo/tree/main/packages/vite#readme)가 제공한다. 요청별 SSR은 `createServerI18n`, boot 직렬화는 `serializeBootSnapshot`·`decodeBootSnapshot`이다.

브라우저 런타임에서 `parseCatalog`를 빼려면 `@0disoft/saylo-core/runtime` 서브패스 엔트리를 쓴다. 여기에는 `parseCatalog`가 없고 나머지 API는 루트 엔트리와 같다. 루트 엔트리 `@0disoft/saylo-core`는 기존 API를 그대로 유지한다. 이 서브패스는 `0.1.0-alpha.2` 게시본에 포함된다.

## 전송 카탈로그 동결

`freezeCatalogs(catalogs)`는 JSON 전송 뒤 카탈로그 배열·AST·위치·인자 스키마를 깊게 동결하고 같은 배열을 반환한다. 루트와 `/runtime` 엔트리에서 제공한다. 같은 core 모듈이 이미 깊게 동결한 객체는 재순회하지 않으며, 외부에서 겉만 동결한 객체는 내부까지 순회한다. 유효성 검사는 기존 decoder·store·i18n에서 수행한다. 이 함수는 `0.1.0-alpha.2` 게시본에 포함되며 구현과 측정은 [동결 경로 공유 기록](../../docs/26-shared-catalog-freeze.md)과 [개발 prebundle 공유 기록](../../docs/30-prebundle-freeze-sharing.md)에 있다.

## 로컬 파싱 최적화

`parseCatalog`는 일반 텍스트와 ASCII `{name}` 보간에 내부 빠른 경로를 쓴다. AST·위치·인자 추론·불변성은 기존 계약을 유지하며, 아포스트로피·복잡한 ICU·범위 밖 인자는 FormatJS가 처리한다. 공개 API 옵션은 추가하지 않았다. 이 최적화는 `0.1.0-alpha.2` 게시본에 포함되며, 측정과 한계는 [설계 기록](../../docs/15-simple-message-parser.md)에 있다.

## 관련 패키지

- [@0disoft/saylo-react](https://github.com/0disoft/saylo/tree/main/packages/react#readme) — React 19 바인딩
- [@0disoft/saylo-typegen](https://github.com/0disoft/saylo/tree/main/packages/typegen#readme) — 기준 카탈로그 타입 선언 생성
- [@0disoft/saylo-vite](https://github.com/0disoft/saylo/tree/main/packages/vite#readme) — Vite 플러그인과 dev client

## 문서

- [카탈로그와 API](https://github.com/0disoft/saylo/blob/main/docs/03-catalog-and-api.md)
- [라이브 반영과 타입](https://github.com/0disoft/saylo/blob/main/docs/04-live-update-and-types.md)
- [운영 빌드와 SSR](https://github.com/0disoft/saylo/blob/main/docs/05-build-and-ssr.md)
- 저장소 [README](https://github.com/0disoft/saylo#readme)

## 버전

Node.js 24.x를 지원한다. `engines.node`는 `24.x`이고 로컬 검증 환경은 Node 24.18.0이다. TypeScript 7을 기준으로 검증하지만 `typescript`를 peer로 강제하지 않는다.

런타임 target은 ES2022이고 브라우저 대상이라 Node API에 의존하지 않는다. 이 패키지에는 런타임 peer 의존성이 없다.

## 라이선스

Apache-2.0이다. 배포 tarball에 저장소 루트의 `LICENSE`와 `NOTICE`를 함께 싣는다.
