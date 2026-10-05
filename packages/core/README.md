# @0disoft/saylo-core

Saylo 코어 패키지다. 카탈로그 파싱과 스키마 검증, 동기 번역기, eager store, 지연 로딩 i18n, SSR boot 직렬화를 제공한다. DOM이나 특정 프레임워크에 의존하지 않는다.

## 상태

아직 npm에 게시하지 않았다. 현재는 이 저장소의 workspace에서 쓰거나 `npm pack`으로 만든 tarball을 설치해 쓴다. 아래 설치 명령은 게시 후 기준이다.

## 설치 (게시 후)

```sh
npm install @0disoft/saylo-core
```

앱 런타임 의존성(`dependencies`)으로 설치한다.

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

Node.js·TypeScript 지원 범위는 아직 확정하지 않았다. 이 패키지에는 런타임 peer 의존성이 없다.