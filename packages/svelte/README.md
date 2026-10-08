# @0disoft/saylo-svelte

Svelte 5에서 Saylo의 불변 스냅샷을 `$i18n`으로 구독한다. ESM JavaScript와 TypeScript 선언 파일을 제공한다. 이 패키지는 로컬 구현이며 아직 npm에 게시하지 않았다.

## 직접 구독

```js
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSvelteStore } from '@0disoft/saylo-svelte';

const catalog = parseCatalog('{"title":"Cart"}', { locale: 'en', namespace: 'cart' });
const instance = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
const i18n = createSvelteStore(instance);
const unsubscribe = i18n.subscribe(snapshot => console.log(snapshot.t('cart:title')));
unsubscribe();
instance.dispose();
```

컴포넌트에서는 `const i18n = createSvelteStore(instance)`를 선언하고 `{$i18n.t('cart:title')}`을 사용한다. `createStore<AppSchema>` 또는 `createI18n<AppSchema>`의 키·인자 타입이 어댑터까지 유지된다. `setLocale`의 동기·비동기 반환과 lazy instance의 `loadNamespace`도 그대로 전달한다.

## Context로 전달

애플리케이션 모듈에서 타입별 factory를 한 번 생성한다.

```ts
import { createSayloSvelte } from '@0disoft/saylo-svelte';
import type { AppSchema } from './generated';

export const { setSayloContext, getI18n } = createSayloSvelte<AppSchema>();
```

부모 컴포넌트의 초기화 중 `setSayloContext(instance)`를 호출한다. 자식 컴포넌트는 같은 factory의 `const i18n = getI18n()`으로 받아 `{$i18n.t('cart:items', { count: 3 })}`을 렌더링한다. 부모의 instance는 마운트 동안 안정적으로 유지한다. 다른 factory의 context를 읽으면 명확한 오류를 던진다.

## 스냅샷과 소유권

- 첫 구독은 현재 값을 동기 전달한다. 구독자가 있는 동안 하나의 core 구독을 공유하고, 마지막 구독이 끝나면 core 구독과 disposal listener를 해제한다.
- 구독이 없는 동안 바뀐 카탈로그도 다음 구독에서 읽는다. 이전 스냅샷의 `t`는 이전 번역을 유지한다.
- 컴포넌트의 `$i18n` 구독은 Svelte가 해제한다. instance를 만든 호출자가 `dispose()`를 책임진다. 어댑터는 instance를 폐기하지 않는다.
- SSR에서는 요청별 instance를 생성해 부모 context에 전달한다. factory는 공유할 수 있지만 instance를 서버 전역에 공유하지 않는다. 서버와 클라이언트의 최초 instance는 같은 core boot snapshot으로 생성하고, 라이브 연결은 마운트 뒤에 시작한다.

검증은 `npm run test --workspace=@0disoft/saylo-svelte`와 `npm run typecheck:consumers --workspace=@0disoft/saylo-svelte`로 실행한다. SSR 요청·중첩 context 분리, 구독 해제, snapshot-bound 번역, JS/TS 소비, 컴파일한 컴포넌트의 입력·포커스·커서·dialog·state 유지가 검증 범위이다.

라이선스는 Apache-2.0이며 tarball에 `LICENSE`와 `NOTICE`를 포함한다.
