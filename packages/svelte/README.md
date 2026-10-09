# @0disoft/saylo-svelte

Svelte 5에서 Saylo의 불변 스냅샷을 `$i18n`으로 구독한다. ESM JavaScript와 TypeScript 선언 파일을 제공한다. 마지막으로 게시를 확인한 버전은 2026-10-09의 `0.1.0-alpha.3`(dist-tag `alpha`)이고, Svelte는 `0.1.0-alpha.2`부터 포함한다. 아래 두 selector API는 아직 이 게시본에 없고 저장소 checkout의 로컬 구현이다.

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

## 선택자 구독 (selectSvelteStore·getI18nSelector)

`selectSvelteStore`는 store에서 필요한 값만 골라 내는 `Readable`을 만든다. `createSayloSvelte<S>()`는 같은 selector를 context로 전달한다.

```ts
import { selectSvelteStore } from '@0disoft/saylo-svelte';

const title = selectSvelteStore(i18n, snapshot => snapshot.t('cart:title'));
```

```ts
export const { setSayloContext, getI18n, getI18nSelector } = createSayloSvelte<AppSchema>();

// 자식 컴포넌트 초기화 중
const title = getI18nSelector(snapshot => snapshot.t('cart:title'));
```

계약은 다음과 같다.

- 시그니처는 `selectSvelteStore<S, T>(source: SayloSvelteStore<S>, selector: (snapshot: SayloSvelteSnapshot<S>) => T, options?: SayloSelectorOptions): Readable<T>`다.
- `createSayloSvelte<S>()`는 `getI18nSelector<T>(selector, options?: SayloSelectorOptions): Readable<T>`를 제공하고, 같은 factory context에서 초기화 중에 호출한다.
- `SayloSelectorOptions`는 `readonly onError?: (error: unknown) => void` 하나를 갖는다.
- 결과는 `Object.is`로 비교하고, 값 상자 `{ value }`로 Svelte `derived` 알림을 이어 준다. 같은 객체 참조와 `NaN`은 알림을 생략하고 `+0`·`-0`은 다른 값으로 알림을 전달한다.
- source와 공유 context의 기존 core 단일 구독과 최종 해제를 유지하고, SSR render가 끝난 뒤 core 구독은 0이다.
- 첫 구독과 재구독은 동기 최신값을 전달하고, snapshot-bound `t`와 `setLocale`/`loadNamespace`를 유지한다.
- 기존 `createSvelteStore`·`getI18n`은 그대로 남아 있다.

selector가 던진 예외는 시점에 따라 다르게 처리한다. 첫 구독이나 재구독 시점의 실패는 새 구독을 해제한 뒤 selector가 throw한 값을 그대로 동기 throw하고(Error가 아니거나 `undefined`여도 그대로 전달), 이때 `onError`는 호출하지 않는다. 이전 성공값을 대신 돌려주지 않는다. 활성 구독이 snapshot을 갱신하는 중 실패하면 마지막 성공값을 유지하고 invalidate·알림 없이 다음 snapshot에서 다시 선택한다. 이 실패는 `onError`로 보고하고, 미지정이면 `console.error('[saylo:svelte] selector failed', error)`로 남긴다. `onError` 자체가 던지면 `console.error('[saylo:svelte] selector error reporter failed', reportingError)`로 보고하고 Svelte 알림은 계속한다. `options`는 저장소 checkout의 로컬 구현이고 아직 게시본에는 없다.

```ts
const title = selectSvelteStore(i18n, snapshot => snapshot.t('cart:title'), {
  onError: error => console.error('selector failed', error),
});
```

제약은 다음과 같다. selector는 순수 계산으로 둔다. selector가 props를 캡처해도 prop만 바뀌면 source 알림이 없으므로 자동으로 다시 선택하지 않는다. selector가 매번 새 객체·새 배열을 반환하면 `Object.is`가 다르므로 매 snapshot마다 알림이 발생한다. 동적 컴포넌트 인자는 기존 `$i18n`와 Svelte `$derived`로 조합한다.

```svelte
<script lang="ts">
  let { name }: { name: string } = $props();
  const i18n = getI18n();
  const greeting = $derived($i18n.t('demo:greeting', { name }));
</script>
<p>{greeting}</p>
```

## 스냅샷과 소유권

- 첫 구독은 현재 값을 동기 전달한다. 구독자가 있는 동안 하나의 core 구독을 공유하고, 마지막 구독이 끝나면 core 구독과 disposal listener를 해제한다.
- 구독이 없는 동안 바뀐 카탈로그도 다음 구독에서 읽는다. 이전 스냅샷의 `t`는 이전 번역을 유지한다.
- 컴포넌트의 `$i18n` 구독은 Svelte가 해제한다. instance를 만든 호출자가 `dispose()`를 책임진다. 어댑터는 instance를 폐기하지 않는다.
- SSR에서는 요청별 instance를 생성해 부모 context에 전달한다. factory는 공유할 수 있지만 instance를 서버 전역에 공유하지 않는다. 서버와 클라이언트의 최초 instance는 같은 core boot snapshot으로 생성하고, 라이브 연결은 마운트 뒤에 시작한다.

검증은 `npm run test --workspace=@0disoft/saylo-svelte`와 `npm run typecheck:consumers --workspace=@0disoft/saylo-svelte`로 실행한다. SSR 요청·중첩 context 분리, 일치하는 SSR 마크업의 hydration, 구독 해제, snapshot-bound 번역, JS/TS 소비, 컴파일한 컴포넌트의 입력·포커스·커서·dialog·state 유지가 검증 범위이다. [Svelte 데모](https://github.com/0disoft/saylo/tree/main/examples/svelte)와 [구현 기록](https://github.com/0disoft/saylo/blob/main/docs/38-svelte-adapter.md)에 연결 방법과 실제 브라우저 검증을 정리했다.

라이선스는 Apache-2.0이며 tarball에 `LICENSE`와 `NOTICE`를 포함한다.
